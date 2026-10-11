"""
GAADIIQ's own videos on the Reviews & News hub.

MOST OF THIS FILE IS ABOUT ONE FUNCTION

extract_youtube_id decides what ends up interpolated into an iframe `src` in
the browser. A permissive parser here is the difference between an embed and
script execution on the page, so the refusals below matter more than the
acceptances: anything the function cannot positively identify as one video
must raise rather than make a best effort.

The happy paths are the shapes people actually paste. The refusals are the
ones that look close enough to pass a careless check.
"""
import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.dependencies import get_admin_user, get_current_user
from db.session import get_db
from main import app
from models.user import User
from routers.videos import extract_youtube_id

ID = "dQw4w9WgXcQ"  # eleven characters, the shape YouTube uses


# ── The parser ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("value", [
    ID,
    f"https://www.youtube.com/watch?v={ID}",
    f"http://youtube.com/watch?v={ID}",
    f"https://m.youtube.com/watch?v={ID}",
    f"https://youtu.be/{ID}",
    f"youtu.be/{ID}",                                  # pasted without a scheme
    f"https://www.youtube.com/embed/{ID}",
    f"https://www.youtube.com/shorts/{ID}",
    f"https://www.youtube.com/live/{ID}",
    f"https://www.youtube-nocookie.com/embed/{ID}",
    f"  https://youtu.be/{ID}  ",                       # pasted with whitespace
    f"https://www.youtube.com/watch?v={ID}&t=42s",      # share-at-timestamp
])
def test_the_shapes_people_paste(value):
    assert extract_youtube_id(value) == ID


@pytest.mark.parametrize("value,why", [
    ("", "nothing at all"),
    ("   ", "whitespace"),
    ("https://vimeo.com/123456789", "a different video host"),
    # The one a "contains youtube.com" check waves through.
    (f"https://evil.example.com/youtube.com/watch?v={ID}", "youtube in the path"),
    (f"https://youtube.com.attacker.net/watch?v={ID}", "youtube as a subdomain"),
    ("javascript:alert(1)", "a script URL"),
    ("https://www.youtube.com/playlist?list=PLabcdefghijk", "a playlist, not one video"),
    ("https://www.youtube.com/@gaadiiq", "a channel, not one video"),
    ("https://www.youtube.com/watch?v=tooshort", "an id of the wrong length"),
    ("https://www.youtube.com/watch?v=waaaaaaaaaaytoolong", "an id of the wrong length"),
    ("https://www.youtube.com/watch?v=has spaces", "an id with a space in it"),
    ("https://www.youtube.com/watch", "no id at all"),
])
def test_it_refuses_what_it_cannot_identify(value, why):
    with pytest.raises(ValueError):
        extract_youtube_id(value)


def test_the_id_can_only_ever_be_youtube_safe_characters():
    """
    Belt and braces on the one property the iframe depends on.

    Whatever shape went in, what comes out is eleven characters from
    [A-Za-z0-9_-]. Nothing in that set can close an attribute, open a tag or
    change the origin of the embed.
    """
    import re
    for value in [ID, f"https://youtu.be/{ID}", f"https://www.youtube.com/watch?v={ID}"]:
        assert re.fullmatch(r"[A-Za-z0-9_-]{11}", extract_youtube_id(value))


# ── The endpoints ───────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def client(db_engine):
    factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

    async def override_db():
        async with factory() as session:
            yield session
            await session.commit()

    admin = User(id=uuid.uuid4(), email="admin@test.com", hashed_password="x")
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_admin_user] = lambda: admin
    app.dependency_overrides[get_current_user] = lambda: admin
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def _add(client, url=f"https://youtu.be/{ID}", title="GAADIIQ reviews the Creta", **kw):
    return await client.post("/videos", json={"url": url, "title": title, **kw})


@pytest.mark.asyncio
async def test_a_pasted_link_becomes_a_video(client):
    resp = await _add(client)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["youtube_id"] == ID
    assert body["title"] == "GAADIIQ reviews the Creta"
    assert body["is_published"] is True


@pytest.mark.asyncio
async def test_a_playlist_is_refused_with_a_reason(client):
    resp = await _add(client, url="https://www.youtube.com/playlist?list=PLabcdefghijk")
    assert resp.status_code == 400, resp.text
    # The admin needs to know WHICH part was wrong, not just that it was.
    assert "playlist" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_a_title_is_required(client):
    resp = await _add(client, title="   ")
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_the_same_video_cannot_be_added_twice(client):
    assert (await _add(client)).status_code == 201
    second = await _add(client, url=f"https://www.youtube.com/watch?v={ID}", title="Again")
    # Same video, different link shape. 409, not a 500 from the constraint.
    assert second.status_code == 409, second.text


@pytest.mark.asyncio
async def test_the_public_list_shows_published_videos_newest_first(client):
    older = datetime(2026, 1, 1, tzinfo=timezone.utc).isoformat()
    newer = datetime(2026, 6, 1, tzinfo=timezone.utc).isoformat()
    await _add(client, url=f"https://youtu.be/{ID}", title="Older", published_at=older)
    await _add(client, url="https://youtu.be/AAAAAAAAAAA", title="Newer", published_at=newer)

    resp = await client.get("/videos")
    assert resp.status_code == 200, resp.text
    assert [v["title"] for v in resp.json()] == ["Newer", "Older"]


@pytest.mark.asyncio
async def test_unpublishing_hides_it_from_the_public_list_without_deleting(client):
    created = (await _add(client)).json()

    patch = await client.patch(f"/videos/{created['id']}", json={"is_published": False})
    assert patch.status_code == 200, patch.text

    assert (await client.get("/videos")).json() == []
    # Still there for the admin: unpublishing is not deleting.
    everything = (await client.get("/videos/all")).json()
    assert [v["title"] for v in everything] == ["GAADIIQ reviews the Creta"]


@pytest.mark.asyncio
async def test_a_patch_that_only_unpublishes_leaves_the_rest_alone(client):
    """exclude_unset. Without it a partial PATCH blanks every field it omits."""
    created = (await _add(client, description="Full road test")).json()

    await client.patch(f"/videos/{created['id']}", json={"is_published": False})

    after = next(v for v in (await client.get("/videos/all")).json()
                 if v["id"] == created["id"])
    assert after["title"] == "GAADIIQ reviews the Creta"
    assert after["description"] == "Full road test"


@pytest.mark.asyncio
async def test_deleting_removes_it(client):
    created = (await _add(client)).json()
    assert (await client.delete(f"/videos/{created['id']}")).status_code == 204
    assert (await client.get("/videos")).json() == []


@pytest.mark.asyncio
async def test_a_video_need_not_be_about_a_car(client):
    """A channel trailer is about no single model; forcing one would invent it."""
    body = (await _add(client, title="Welcome to GAADIIQ")).json()
    assert body["car_id"] is None
    assert body["car_label"] is None
