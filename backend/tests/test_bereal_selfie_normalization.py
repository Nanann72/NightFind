"""Iteration 40 — BeReal selfie normalization + club_name enrichment.

Bugs targeted:
  * (2) /api/me/moments and /api/clubs/{id}/moments used to return raw base64
    selfies, causing a black square in the profile grid/story viewer.
    _normalize_selfie now prepends `data:image/jpeg;base64,` when needed.
  * (3) profile moments were missing club_name for `gp_...` club ids because
    the enrichment only queried db.clubs — it now also queries db.places.
Non-regression:
  * /api/moments/feed already normalized selfies via _enrich_moment.
"""
from __future__ import annotations

import base64
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

REVIEWER_EMAIL = "apple.reviewer@nightfinder.app"
REVIEWER_PASSWORD = "Reviewer2026!"

# Tiny raw base64 JPEG (no data: prefix) — used to simulate legacy uploads.
RAW_B64 = (
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL"
    "DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/"
    "wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgED"
    "AwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcY"
    "GRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJ"
    "ipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo"
    "6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiigD//Z"
)

DB_URL = "mongodb://localhost:27017"
DB_NAME = "night_finder"

# A gp_ place used to test club_name enrichment via db.places lookup
PLACE_CLUB_ID = "gp_ChIJCfUElBFy5kcR5-HZRzpGR9k"
TEST_MOMENT_ID = f"mmt_test_bereal_{uuid.uuid4().hex[:6]}"


@pytest.fixture(scope="module")
def reviewer_token() -> str:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": REVIEWER_EMAIL, "password": REVIEWER_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def reviewer_user_id() -> str:
    c = MongoClient(DB_URL)
    u = c[DB_NAME].users.find_one({"email": REVIEWER_EMAIL}, {"_id": 0, "user_id": 1})
    assert u, "reviewer user missing in DB"
    return u["user_id"]


@pytest.fixture(scope="module")
def seed_raw_selfie_moment(reviewer_user_id: str):
    """Insert a legacy-style moment with RAW base64 selfie for the reviewer."""
    client = MongoClient(DB_URL)
    db = client[DB_NAME]
    now = datetime.now(timezone.utc)
    doc = {
        "moment_id": TEST_MOMENT_ID,
        "user_id": reviewer_user_id,
        "user_name": "Apple Reviewer",
        "user_picture": None,
        "club_id": PLACE_CLUB_ID,  # gp_ place, not in db.clubs
        "checkin_id": f"ci_test_{uuid.uuid4().hex[:8]}",
        "image": "data:image/jpeg;base64," + RAW_B64,
        "selfie": RAW_B64,  # ← RAW base64, no data: prefix
        "caption": "TEST_selfie_normalization",
        "is_premium_author": True,
        "created_at": now,
        "expires_at": now + timedelta(hours=24),
        "likes_count": 0,
    }
    db.club_moments.insert_one(doc)
    yield doc
    # cleanup
    db.club_moments.delete_one({"moment_id": TEST_MOMENT_ID})


def _find_moment(items, moment_id):
    return next((m for m in items if m.get("moment_id") == moment_id), None)


# --- 1. /api/me/moments : selfie normalized + club_name from db.places ---

def test_me_moments_normalizes_raw_selfie(reviewer_token, seed_raw_selfie_moment):
    r = requests.get(
        f"{API}/me/moments",
        headers={"Authorization": f"Bearer {reviewer_token}"},
        timeout=15,
    )
    assert r.status_code == 200, f"GET /me/moments: {r.status_code} {r.text}"
    body = r.json()
    assert isinstance(body, list)
    m = _find_moment(body, TEST_MOMENT_ID)
    assert m, f"seeded moment {TEST_MOMENT_ID} missing from /me/moments"
    selfie = m.get("selfie") or ""
    assert selfie.startswith("data:") or selfie.startswith("http"), (
        f"selfie NOT normalized in /me/moments: starts with {selfie[:20]!r}"
    )
    # club_name must be filled from db.places lookup
    assert m.get("club_name"), (
        f"club_name missing for gp_ club_id (should come from db.places lookup): {m.get('club_name')!r}"
    )


def test_me_moments_all_selfies_normalized(reviewer_token, seed_raw_selfie_moment):
    """Regression: any moment with a selfie must never expose raw base64."""
    r = requests.get(
        f"{API}/me/moments",
        headers={"Authorization": f"Bearer {reviewer_token}"},
        timeout=15,
    )
    assert r.status_code == 200
    offenders = [
        m for m in r.json()
        if m.get("selfie") and not m["selfie"].startswith(("data:", "http"))
    ]
    assert not offenders, (
        f"{len(offenders)} moment(s) still expose raw base64 selfie in /me/moments"
    )


# --- 2. /api/clubs/{club_id}/moments : selfie normalized ---

def test_club_moments_normalize_selfie(reviewer_token, seed_raw_selfie_moment):
    r = requests.get(
        f"{API}/clubs/{PLACE_CLUB_ID}/moments",
        headers={"Authorization": f"Bearer {reviewer_token}"},
        timeout=15,
    )
    assert r.status_code == 200, f"GET club moments: {r.status_code} {r.text}"
    m = _find_moment(r.json(), TEST_MOMENT_ID)
    assert m, "seeded moment not visible in club moments endpoint"
    selfie = m.get("selfie") or ""
    assert selfie.startswith("data:") or selfie.startswith("http"), (
        f"selfie NOT normalized in /clubs/*/moments: {selfie[:20]!r}"
    )


# --- 3. /api/moments/feed : non-regression selfie normalized ---

def test_feed_normalizes_selfie(reviewer_token, seed_raw_selfie_moment):
    """Non-regression: /moments/feed must never return raw base64 selfies."""
    r = requests.get(
        f"{API}/moments/feed",
        params={"limit": 100},
        headers={"Authorization": f"Bearer {reviewer_token}"},
        timeout=15,
    )
    assert r.status_code == 200, f"GET feed: {r.status_code} {r.text}"
    body = r.json()
    items = body.get("moments") if isinstance(body, dict) else body
    assert isinstance(items, list)
    # Whether or not our specific seeded moment is in the feed page, any
    # moment with a selfie in the response must be normalized.
    offenders = [
        m for m in items
        if m.get("selfie") and not m["selfie"].startswith(("data:", "http"))
    ]
    assert not offenders, (
        f"{len(offenders)} moment(s) in /moments/feed still expose raw base64 selfie"
    )


# --- 4. Auth guard regression ---

def test_me_moments_requires_auth():
    r = requests.get(f"{API}/me/moments", timeout=10)
    assert r.status_code in (401, 403)
