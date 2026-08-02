"""Backend tests — Iteration 33.

Validates the Google Places photo proxy flow that was reported broken in
production. The bug is a stale GOOGLE_PLACES_API_KEY in the deploy secrets, so
here we simply validate that in the current (preview) environment:

- GET /api/health/integrations exposes google_places.configured=true,
  key_fingerprint (8 hex chars), live_test='ok', resend, audd,
  and places_in_db > 15000.
- GET /api/clubs?lat=..&lng=..&radius_km=10 returns clubs whose
  photos[0] path is /api/places/photo?name=... .
- GET /api/places/photo?name=... streams a real image (content-type image/*
  and body size > 10 KB) — this is the flow that breaks in prod.
"""

import os
import re

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
    "https://fan-culture-app.preview.emergentagent.com"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------------- Health / integrations diagnostic ---------------- #


class TestHealthIntegrations:
    def test_health_integrations_shape_and_live_test(self, api):
        r = api.get(f"{BASE_URL}/api/health/integrations", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()

        # google_places block
        gp = data.get("google_places") or {}
        assert gp.get("configured") is True, f"google_places.configured should be True: {gp}"
        fp = gp.get("key_fingerprint")
        assert isinstance(fp, str) and re.fullmatch(r"[0-9a-f]{8}", fp), \
            f"key_fingerprint must be 8 hex chars, got {fp!r}"
        assert gp.get("live_test") == "ok", f"google_places.live_test should be 'ok', got {gp}"

        # resend block
        rs = data.get("resend") or {}
        assert rs.get("configured") is True, f"resend.configured should be True: {rs}"
        assert rs.get("from_email") == "contact@nightfinder.app", \
            f"resend.from_email expected 'contact@nightfinder.app', got {rs.get('from_email')!r}"

        # audd block
        ad = data.get("audd") or {}
        assert ad.get("configured") is True, f"audd.configured should be True: {ad}"

        # places DB
        n = data.get("places_in_db")
        assert isinstance(n, int) and n > 15000, f"places_in_db should be >15000, got {n}"


# ---------------- Places photo proxy end-to-end ---------------- #


class TestPlacesPhotoProxy:
    def test_clubs_return_proxy_photo_urls(self, api):
        r = api.get(
            f"{BASE_URL}/api/clubs",
            params={"lat": 48.8566, "lng": 2.3522, "radius_km": 10},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        clubs = r.json()
        assert isinstance(clubs, list) and len(clubs) > 0

        # Find at least one club whose first photo is served via our proxy
        proxied = [c for c in clubs if (c.get("photos") or []) and str(c["photos"][0]).startswith("/api/places/photo")]
        assert len(proxied) > 0, (
            f"No club has a /api/places/photo proxied photo; "
            f"sample photos: {[c.get('photos', [None])[:1] for c in clubs[:3]]}"
        )

        # cache one for the next test via pytest attribute
        TestPlacesPhotoProxy._club_photo_path = proxied[0]["photos"][0]

    def test_photo_proxy_streams_real_image(self, api):
        photo_path = getattr(TestPlacesPhotoProxy, "_club_photo_path", None)
        if not photo_path:
            pytest.skip("No proxied photo path found in previous test")

        url = f"{BASE_URL}{photo_path}"
        r = api.get(url, timeout=30)
        assert r.status_code == 200, f"Photo proxy failed: {r.status_code} {r.text[:200]}"
        ctype = r.headers.get("content-type", "")
        assert ctype.startswith("image/"), f"Expected image/* content-type, got {ctype!r}"
        assert len(r.content) > 10 * 1024, f"Image too small ({len(r.content)} bytes), likely default/placeholder"
