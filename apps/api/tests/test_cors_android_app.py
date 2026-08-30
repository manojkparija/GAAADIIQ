"""
The Android app's origin is allowed by CORS.

Reported from an installed debug APK, as two unrelated-looking faults:

  - Browse showed "0 listings found" with all three chips at 0, while the
    website showed the same catalogue perfectly well;
  - Voice Diagnosis said "Could not reach the speech service. Check your
    connection and try again."

One cause. capacitor.config.ts sets `androidScheme: 'https'`, so the Android
WebView serves the bundle from `https://localhost`. The allow-list carried
`capacitor://localhost` — which is the *iOS* origin — and not that one, so
every request the APK made was refused by CORS.

Neither message could say so. A CORS refusal never reaches JavaScript: the
fetch rejects with no status, so the catalogue loader records a failed source
and the STT service falls through to its default branch, whose text is about
the connection. The phone had a working connection the whole time.

That is why it read as an APK bug rather than an API one, and why nothing in
the web application needed changing.

These pin the origin itself rather than a request through TestClient:
CORSMiddleware answers a preflight from the configured list, so asserting on
the list is asserting on the thing that was wrong. The preflight test below
covers the wiring.
"""
from fastapi.testclient import TestClient

from core.config import settings
from main import app

#: What capacitor.config.ts's `androidScheme: 'https'` produces.
ANDROID_ORIGIN = "https://localhost"
#: iOS, for contrast — this one was already present and is not the same thing.
IOS_ORIGIN = "capacitor://localhost"


def test_the_android_webview_origin_is_allowed():
    assert ANDROID_ORIGIN in settings.allowed_origins, (
        "The APK serves its bundle from https://localhost. Without this every "
        "request it makes is refused by CORS, and the app reports it as a "
        "connection problem."
    )


def test_the_ios_origin_is_still_allowed():
    # Removing it while adding the Android one would trade one platform's
    # outage for another's, and iOS has no build here to catch it.
    assert IOS_ORIGIN in settings.allowed_origins


def test_the_two_origins_are_not_confused_for_each_other():
    # They are different schemes and neither implies the other. This exists
    # because the list looked like it covered "the mobile app" and did not.
    assert ANDROID_ORIGIN != IOS_ORIGIN


def test_a_preflight_from_the_app_is_answered():
    """
    The wiring, not just the list: CORSMiddleware has to be reached.

    A preflight is what the WebView sends before the catalogue request, and a
    missing Access-Control-Allow-Origin on it is exactly what produced the
    empty grid.
    """
    client = TestClient(app)

    resp = client.options(
        "/cars",
        headers={
            "Origin": ANDROID_ORIGIN,
            "Access-Control-Request-Method": "GET",
        },
    )

    assert resp.status_code == 200, resp.text
    assert resp.headers.get("access-control-allow-origin") == ANDROID_ORIGIN


def test_a_request_from_the_app_carries_the_header_back():
    # The preflight passing is not enough — the actual response has to carry
    # the header too, or the browser still withholds the body.
    client = TestClient(app)

    resp = client.get("/health", headers={"Origin": ANDROID_ORIGIN})

    assert resp.headers.get("access-control-allow-origin") == ANDROID_ORIGIN


def test_an_unrelated_origin_is_still_refused():
    # The half a careless widening would break. allow_credentials is True, so
    # an over-broad list would let any site make credentialed calls to this API.
    client = TestClient(app)

    resp = client.get("/health", headers={"Origin": "https://not-gaadiiq.example"})

    assert "access-control-allow-origin" not in resp.headers
