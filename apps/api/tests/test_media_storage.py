"""Storage abstraction — the seam that makes S3 a config change, not a rewrite."""
import logging

import pytest

from services import media_storage
from services.media_storage import (
    LocalStorage,
    S3Storage,
    StorageError,
    get_storage,
    reset_storage,
)


@pytest.fixture
def store(tmp_path):
    return LocalStorage(root=tmp_path / "media", public_prefix="/media")


class TestLocalStorageSuite:
    @pytest.mark.asyncio
    async def test_round_trip(self, store):
        obj = await store.save("brochures/j1/000.png", b"\x89PNG-data", "image/png")
        assert obj.key == "brochures/j1/000.png"
        assert obj.size_bytes == 9
        assert await store.load("brochures/j1/000.png") == b"\x89PNG-data"

    @pytest.mark.asyncio
    async def test_exists_and_delete(self, store):
        await store.save("a/b.png", b"data-here", "image/png")
        assert await store.exists("a/b.png") is True
        await store.delete("a/b.png")
        assert await store.exists("a/b.png") is False

    @pytest.mark.asyncio
    async def test_delete_is_idempotent(self, store):
        # Cleanup paths must not explode on an already-missing file.
        await store.delete("never/existed.png")

    @pytest.mark.asyncio
    async def test_missing_key_raises(self, store):
        with pytest.raises(StorageError):
            await store.load("nope.png")

    @pytest.mark.asyncio
    async def test_no_partial_file_is_left_behind(self, store, tmp_path):
        await store.save("x/y.png", b"0" * 5000, "image/png")
        leftovers = list((tmp_path / "media").rglob("*.part"))
        assert leftovers == [], "temporary write files must be moved into place"


class TestKeySafetySuite:
    """Keys become filesystem paths, so traversal must be impossible."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("bad", [
        "../etc/passwd",
        "a/../../../../etc/passwd",
        "/absolute/path.png",
        "",
        "a/b/../../../c.png",
    ])
    async def test_traversal_keys_are_rejected(self, store, bad):
        with pytest.raises(StorageError):
            await store.save(bad, b"data", "image/png")

    def test_url_for_rejects_bad_keys(self, store):
        with pytest.raises(StorageError):
            store.url_for("../secrets")


class TestUrlDerivationSuite:
    def test_local_urls_route_through_the_api(self, store):
        assert store.url_for("brochures/j/1.png") == "/media/brochures/j/1.png"

    def test_s3_urls_use_the_public_base_when_given(self):
        s3 = S3Storage(bucket="b", public_base="https://cdn.example.com/")
        assert s3.url_for("k/1.png") == "https://cdn.example.com/k/1.png"

    def test_s3_falls_back_to_the_bucket_url(self):
        assert S3Storage(bucket="mybucket").url_for("k.png") == \
            "https://mybucket.s3.amazonaws.com/k.png"


class TestBackendSelectionSuite:
    def teardown_method(self):
        reset_storage()

    def test_local_is_the_default(self, monkeypatch, tmp_path):
        monkeypatch.delenv("MEDIA_BACKEND", raising=False)
        monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
        reset_storage()
        assert isinstance(get_storage(), LocalStorage)

    def test_s3_without_a_bucket_degrades_to_local(self, monkeypatch, tmp_path):
        # Refusing to boot would take the whole API down over one misconfigured
        # optional feature.
        monkeypatch.setenv("MEDIA_BACKEND", "s3")
        monkeypatch.delenv("MEDIA_S3_BUCKET", raising=False)
        monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
        reset_storage()
        assert isinstance(get_storage(), LocalStorage)

    def test_s3_is_selected_when_configured(self, monkeypatch):
        monkeypatch.setenv("MEDIA_BACKEND", "s3")
        monkeypatch.setenv("MEDIA_S3_BUCKET", "gaadiiq-media")
        monkeypatch.setenv("MEDIA_S3_ACCESS_KEY", "key")
        monkeypatch.setenv("MEDIA_S3_SECRET_KEY", "secret")
        reset_storage()
        backend = get_storage()
        assert isinstance(backend, S3Storage)
        assert backend.bucket == "gaadiiq-media"

    def test_existing_r2_settings_are_reused(self, monkeypatch):
        """
        MEDIA_BACKEND=s3 alone should suffice on a deployment that already
        carries R2 credentials, rather than demanding four new variables that
        duplicate them.
        """
        from core.config import settings

        monkeypatch.setenv("MEDIA_BACKEND", "s3")
        for var in ("MEDIA_S3_BUCKET", "MEDIA_S3_ACCESS_KEY", "MEDIA_S3_SECRET_KEY",
                    "MEDIA_S3_ENDPOINT", "MEDIA_PUBLIC_BASE"):
            monkeypatch.delenv(var, raising=False)
        monkeypatch.setattr(settings, "r2_bucket_name", "gaadiiq-media")
        monkeypatch.setattr(settings, "r2_access_key_id", "r2-key")
        monkeypatch.setattr(settings, "r2_secret_access_key", "r2-secret")
        monkeypatch.setattr(settings, "r2_endpoint_url", "https://acct.r2.cloudflarestorage.com")
        monkeypatch.setattr(settings, "r2_public_url", "https://media.gaadiiq.com")

        reset_storage()
        backend = get_storage()
        assert isinstance(backend, S3Storage)
        assert backend.bucket == "gaadiiq-media"
        assert backend.access_key == "r2-key"
        assert backend.url_for("brochures/j/1.png") == "https://media.gaadiiq.com/brochures/j/1.png"

    def test_s3_without_credentials_degrades_to_local(self, monkeypatch, tmp_path):
        # Uploading into a bucket we cannot authenticate to would fail on every
        # request; local storage at least keeps the feature working.
        from core.config import settings

        monkeypatch.setenv("MEDIA_BACKEND", "s3")
        monkeypatch.setenv("MEDIA_S3_BUCKET", "some-bucket")
        monkeypatch.delenv("MEDIA_S3_ACCESS_KEY", raising=False)
        monkeypatch.delenv("MEDIA_S3_SECRET_KEY", raising=False)
        monkeypatch.setattr(settings, "r2_access_key_id", "")
        monkeypatch.setattr(settings, "r2_secret_access_key", "")
        monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
        reset_storage()
        assert isinstance(get_storage(), LocalStorage)

    def test_unknown_backend_degrades_to_local(self, monkeypatch, tmp_path):
        monkeypatch.setenv("MEDIA_BACKEND", "dropbox")
        monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
        reset_storage()
        assert isinstance(get_storage(), LocalStorage)


class TestS3ErrorTranslationSuite:
    """
    Storage failures must arrive as StorageError.

    A rejected R2 write raised botocore's ClientError straight out of save(),
    past the router's `except StorageError` handler, and became a 500 with no
    detail — a permissions problem presenting as a crash. The 403 message alone
    ("Forbidden") names neither the bucket nor the endpoint, so the wrapper adds
    them: that is what distinguishes a token scoped to the wrong bucket from one
    missing write permission.
    """

    class _RefusingClient:
        def put_object(self, **_kwargs):
            raise RuntimeError("An error occurred (403) when calling the PutObject operation: Forbidden")

        def delete_object(self, **_kwargs):
            raise RuntimeError("An error occurred (403) when calling the DeleteObject operation: Forbidden")

    def _refusing_store(self, monkeypatch):
        store = media_storage.S3Storage(
            bucket="gaadiiq-media",
            endpoint_url="https://acct.r2.cloudflarestorage.com",
            access_key="k",
            secret_key="s",
        )
        monkeypatch.setattr(store, "_client", lambda: self._RefusingClient())
        return store

    @pytest.mark.asyncio
    async def test_put_failure_becomes_storage_error(self, monkeypatch):
        store = self._refusing_store(monkeypatch)

        with pytest.raises(media_storage.StorageError):
            await store.save("vehicles/x/front.png", b"data", "image/png")

    @pytest.mark.asyncio
    async def test_message_names_the_bucket_and_endpoint(self, monkeypatch):
        store = self._refusing_store(monkeypatch)

        with pytest.raises(media_storage.StorageError) as err:
            await store.save("vehicles/x/front.png", b"data", "image/png")

        message = str(err.value)
        assert "gaadiiq-media" in message
        assert "r2.cloudflarestorage.com" in message
        assert "403" in message

    @pytest.mark.asyncio
    async def test_delete_failure_becomes_storage_error(self, monkeypatch):
        store = self._refusing_store(monkeypatch)

        with pytest.raises(media_storage.StorageError):
            await store.delete("vehicles/x/front.png")

    @pytest.mark.asyncio
    async def test_an_unsafe_key_is_still_rejected_before_any_call(self, monkeypatch):
        store = self._refusing_store(monkeypatch)

        # Must fail validation, not reach the client and be reported as a
        # remote failure.
        with pytest.raises(media_storage.StorageError) as err:
            await store.save("../../etc/passwd", b"data", "image/png")
        assert "Unsafe storage key" in str(err.value)


class TestDashboardEndpointGuardSuite:
    """
    The Cloudflare console URL is the natural thing to copy, and it fails in the
    most misleading way possible: dash.cloudflare.com is a web page, so every
    PutObject returns 403 Forbidden — identical to a token missing write
    permission. Hours go into checking token scopes when the account ID is
    sitting in the wrong URL.
    """

    def test_dashboard_url_is_reported_with_the_correct_endpoint(self, caplog):
        account = "0c79c9f16e2fcbe73b64b3201177c858"
        store = media_storage.S3Storage(
            bucket="gaadiiq-media",
            endpoint_url=f"https://dash.cloudflare.com/{account}/r2",
            access_key="k",
            secret_key="s",
        )

        with caplog.at_level(logging.ERROR, logger="gaadiiq.media_storage"):
            store._check_endpoint()

        # Naming the exact replacement matters more than describing the problem.
        assert f"https://{account}.r2.cloudflarestorage.com" in caplog.text

    def test_a_correct_endpoint_is_left_alone(self, caplog):
        store = media_storage.S3Storage(
            bucket="gaadiiq-media",
            endpoint_url="https://0c79c9f16e2fcbe73b64b3201177c858.r2.cloudflarestorage.com",
            access_key="k",
            secret_key="s",
        )

        with caplog.at_level(logging.ERROR, logger="gaadiiq.media_storage"):
            store._check_endpoint()

        assert caplog.text == ""

    def test_dashboard_url_without_an_account_id_still_warns(self, caplog):
        store = media_storage.S3Storage(
            bucket="gaadiiq-media",
            endpoint_url="https://dash.cloudflare.com/r2",
            access_key="k",
            secret_key="s",
        )

        with caplog.at_level(logging.ERROR, logger="gaadiiq.media_storage"):
            store._check_endpoint()

        assert "r2.cloudflarestorage.com" in caplog.text


class TestClientReuseSuite:
    """
    One TLS connection, not one per image.

    A client was built per operation, so a 40-image brochure opened 40
    handshakes to Cloudflare in a burst. Cloudflare answered one with
    SSLV3_ALERT_HANDSHAKE_FAILURE and the image was lost.
    """

    def test_client_is_built_once_and_reused(self, monkeypatch):
        built = []

        def _fake_boto3_client(_service, **kwargs):
            built.append(kwargs)
            return object()

        import sys
        import types

        fake_boto3 = types.ModuleType("boto3")
        fake_boto3.client = _fake_boto3_client
        monkeypatch.setitem(sys.modules, "boto3", fake_boto3)

        store = media_storage.S3Storage(
            bucket="b",
            endpoint_url="https://acct.r2.cloudflarestorage.com",
            access_key="k",
            secret_key="s",
        )
        first, second, third = store._client(), store._client(), store._client()

        assert first is second is third
        assert len(built) == 1, f"built {len(built)} clients, expected 1"

    def test_r2_requires_path_addressing_and_sigv4(self, monkeypatch):
        built = []

        import sys
        import types

        fake_boto3 = types.ModuleType("boto3")
        fake_boto3.client = lambda _service, **kwargs: built.append(kwargs) or object()
        monkeypatch.setitem(sys.modules, "boto3", fake_boto3)

        store = media_storage.S3Storage(
            bucket="b",
            endpoint_url="https://acct.r2.cloudflarestorage.com",
            access_key="k",
            secret_key="s",
        )
        store._client()

        config = built[0]["config"]
        assert config.signature_version == "s3v4"
        # Virtual-host style would put the bucket in the TLS SNI, which R2's
        # certificate does not cover.
        assert config.s3["addressing_style"] == "path"
        assert built[0]["region_name"] == "auto"
