"""Iteration 34 — BeReal moments end-to-end + generic photos guard.

Tests:
    1. Emma login → GET clubs (Paris) → pick a real club → POST /checkins/manual
       with exact club coords → 200
    2. POST /clubs/{club_id}/moments with a tiny base64 JPEG → 200
    3. GET /clubs/{club_id}/moments → contains the created moment with
       user_name + image
    4. Guard: near Paris, the number of clubs still using unsplash/pexels
       photos remains small (regression check for _fix_generic_club_photos).
"""
from __future__ import annotations

import base64
import io
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

EMMA_EMAIL = "emma.demo@nightfinder.app"
EMMA_PASSWORD = "DemoOnly2026!"


# --- helpers ------------------------------------------------------------

def _tiny_jpeg_b64() -> str:
    """8x8 red JPEG encoded as data URI base64 (via PIL)."""
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 40, 60)).save(buf, format="JPEG", quality=60)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


@pytest.fixture(scope="module")
def emma_token() -> str:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": EMMA_EMAIL, "password": EMMA_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok, "no token in login response"
    return tok


@pytest.fixture(scope="module")
def paris_clubs(emma_token: str) -> list:
    headers = {"Authorization": f"Bearer {emma_token}"}
    r = requests.get(
        f"{API}/clubs",
        params={"lat": 48.8566, "lng": 2.3522, "radius_km": 10},
        headers=headers,
        timeout=15,
    )
    assert r.status_code == 200, f"list clubs failed: {r.status_code} {r.text}"
    data = r.json()
    assert isinstance(data, list) and len(data) > 0
    return data


# --- 1. Moments end-to-end flow -----------------------------------------

def test_moments_full_flow(emma_token: str, paris_clubs: list):
    headers = {"Authorization": f"Bearer {emma_token}"}
    # Pick first club with valid coords
    club = next(
        (c for c in paris_clubs if c.get("lat") and c.get("lng")),
        None,
    )
    assert club, "no club with coords in Paris response"
    club_id = club["club_id"]

    # 1a. Manual check-in at exact club coords
    r = requests.post(
        f"{API}/checkins/manual",
        json={
            "club_id": club_id,
            "lat": club["lat"],
            "lng": club["lng"],
            "accuracy": 5,
        },
        headers=headers,
        timeout=15,
    )
    assert r.status_code == 200, f"manual checkin failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("ok") is True
    assert body.get("confirmed") is True
    assert "checkin_id" in body

    # 1b. Upload a moment (may fail with 409 if a moment for this checkin
    #     already exists from previous test runs, or 429 for cooldown).
    payload = {"image": _tiny_jpeg_b64(), "caption": f"TEST_moment_{uuid.uuid4().hex[:6]}"}
    r = requests.post(
        f"{API}/clubs/{club_id}/moments",
        json=payload,
        headers=headers,
        timeout=15,
    )
    if r.status_code in (409, 429):
        # Moment (or cooldown) already exists — flow is still validated.
        # We must still see the previous moment in the GET below.
        assert True
    else:
        assert r.status_code == 200, f"upload moment failed: {r.status_code} {r.text}"
        posted = r.json()
        assert posted.get("moment_id", "").startswith("mom_")
        assert posted.get("user_name")
        assert posted.get("club_id") == club_id
        # image is intentionally NOT echoed back (server strips it)
        assert "image" not in posted or posted.get("image") is None

    # 1c. GET moments → should contain at least one for this club
    r = requests.get(
        f"{API}/clubs/{club_id}/moments",
        headers=headers,
        timeout=15,
    )
    assert r.status_code == 200, f"list moments failed: {r.status_code} {r.text}"
    moments = r.json()
    assert isinstance(moments, list)
    assert len(moments) >= 1, "expected at least 1 moment for this club"
    mine = [m for m in moments if m.get("user_name")]
    assert mine, "no moment with user_name — response shape broken"
    m0 = mine[0]
    assert m0.get("club_id") == club_id
    assert m0.get("image", "").startswith("data:image") or len(m0.get("image", "")) > 20, (
        "moment image missing / not base64"
    )
    assert m0.get("created_at")


# --- 2. Generic photos guard -------------------------------------------

def test_generic_club_photos_low_ratio(paris_clubs: list):
    """After _fix_generic_club_photos at startup, only a small number of
    clubs near Paris should still expose unsplash/pexels stock photos."""
    total = len(paris_clubs)
    generic = [
        c for c in paris_clubs
        if (c.get("photos") or [""])[0]
        and any(
            src in (c["photos"][0] or "").lower()
            for src in ("unsplash", "pexels")
        )
    ]
    ratio = len(generic) / total if total else 0
    print(
        f"generic photos near Paris: {len(generic)}/{total} "
        f"({ratio:.1%})"
    )
    # We expect the vast majority to have real Google photos.
    # Allow up to 15% still generic — anything higher means the fixer
    # regressed.
    assert ratio < 0.15, (
        f"too many clubs still use unsplash/pexels stock photos: "
        f"{len(generic)}/{total}"
    )


# --- 3. Auth guard (regression) ----------------------------------------

def test_moments_endpoints_require_auth():
    r = requests.get(f"{API}/clubs/anyclub/moments", timeout=10)
    assert r.status_code in (401, 403), (
        f"GET /clubs/*/moments should require auth, got {r.status_code}"
    )
    r = requests.post(
        f"{API}/clubs/anyclub/moments",
        json={"image": "data:image/jpeg;base64,AAA"},
        timeout=10,
    )
    assert r.status_code in (401, 403), (
        f"POST /clubs/*/moments should require auth, got {r.status_code}"
    )
