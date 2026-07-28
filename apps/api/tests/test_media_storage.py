"""Storage abstraction — the seam that makes S3 a config change, not a rewrite."""
import pytest

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
        reset_storage()
        backend = get_storage()
        assert isinstance(backend, S3Storage)
        assert backend.bucket == "gaadiiq-media"

    def test_unknown_backend_degrades_to_local(self, monkeypatch, tmp_path):
        monkeypatch.setenv("MEDIA_BACKEND", "dropbox")
        monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
        reset_storage()
        assert isinstance(get_storage(), LocalStorage)
