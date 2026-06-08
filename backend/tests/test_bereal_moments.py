"""Tests for BeReal-style club moments feature.

Covers:
- Confirmed check-in creation
- 5-min window state endpoint
- Moment upload with TTL (24h free / 7 days premium)
- 409 conflict on duplicate upload for same check-in
- 403 forbidden when uploading without a recent confirmed check-in
- Listing moments for a club (only non-expired)
- Aggregated active-clubs endpoint
- MongoDB indexes presence on club_moments collection
"""
import os
import uuid
import time
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

PREMIUM_EMAIL = "apple.reviewer@nightfinder.app"
PREMIUM_PASS = "Reviewer2026!"

# 1x1 transparent PNG, base64
TINY_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login_or_register(session, email, password, name=None, premium=False):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password})
    if r.status_code == 200:
        return r.json()["token"]
    r = session.post(
        f"{API}/auth/register",
        json={
            "email": email,
            "password": password,
            "name": name or "Test",
            "dob": "1995-05-15",
        },
    )
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def premium_token(session):
    return _login_or_register(session, PREMIUM_EMAIL, PREMIUM_PASS, premium=True)


@pytest.fixture(scope="module")
def free_token(session):
    email = f"TEST_bereal_free_{uuid.uuid4().hex[:8]}@nightfinder.app"
    return _login_or_register(session, email, "FreeUser2026!", name="Free Tester")


def _h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def two_clubs(session, premium_token):
    r = session.get(f"{API}/clubs?radius_km=50", headers=_h(premium_token))
    assert r.status_code == 200, r.text
    clubs = r.json()
    assert isinstance(clubs, list) and len(clubs) >= 2, "Need at least 2 clubs in DB"
    return clubs[0]["club_id"], clubs[1]["club_id"]


# ---------------------------------------------------------------------------
# Tests — Premium user (TTL ~7 days)
# ---------------------------------------------------------------------------


class TestBeRealMomentsPremium:
    """Premium reviewer flow: check-in + moment upload + 7-day TTL."""

    def test_premium_user_is_premium(self, session, premium_token):
        r = session.get(f"{API}/auth/me", headers=_h(premium_token))
        assert r.status_code == 200, r.text
        me = r.json()
        # is_premium must be true for TTL=7d branch
        assert me.get("is_premium") is True, f"Reviewer account must be premium, got: {me}"

    def test_create_confirmed_checkin(self, session, premium_token, two_clubs):
        club_id, _ = two_clubs
        r = session.post(
            f"{API}/checkins",
            json={"club_id": club_id, "confirmed": True},
            headers=_h(premium_token),
        )
        assert r.status_code == 200, r.text

    def test_window_state_in_window(self, session, premium_token, two_clubs):
        club_id, _ = two_clubs
        r = session.get(f"{API}/moments/window-state", headers=_h(premium_token))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["in_window"] is True, f"Expected in_window=True, got {data}"
        assert data["club_id"] == club_id
        assert "expires_at" in data
        assert isinstance(data["seconds_left"], int)
        assert 0 < data["seconds_left"] <= 5 * 60

    def test_upload_moment_premium_ttl_7d(self, session, premium_token, two_clubs):
        club_id, _ = two_clubs
        r = session.post(
            f"{API}/clubs/{club_id}/moments",
            json={"image": TINY_PNG, "caption": "TEST premium moment"},
            headers=_h(premium_token),
        )
        assert r.status_code == 200, r.text
        m = r.json()
        assert "moment_id" in m and m["moment_id"].startswith("mom_")
        assert m["club_id"] == club_id
        assert m["is_premium_author"] is True
        assert "_id" not in m
        # Verify TTL ~7 days
        exp = datetime.fromisoformat(m["expires_at"].replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        delta_hours = (exp - now).total_seconds() / 3600
        assert 167 <= delta_hours <= 169, (
            f"Premium TTL should be ~168h, got {delta_hours:.2f}h"
        )

    def test_duplicate_upload_returns_409(self, session, premium_token, two_clubs):
        club_id, _ = two_clubs
        r = session.post(
            f"{API}/clubs/{club_id}/moments",
            json={"image": TINY_PNG, "caption": "duplicate"},
            headers=_h(premium_token),
        )
        assert r.status_code == 409, f"Expected 409, got {r.status_code} {r.text}"

    def test_upload_without_recent_checkin_returns_403(
        self, session, premium_token, two_clubs
    ):
        _, other_club = two_clubs
        # No check-in for `other_club` → should be forbidden
        r = session.post(
            f"{API}/clubs/{other_club}/moments",
            json={"image": TINY_PNG, "caption": "forbidden"},
            headers=_h(premium_token),
        )
        assert r.status_code == 403, f"Expected 403, got {r.status_code} {r.text}"

    def test_list_club_moments_includes_uploaded(self, session, premium_token, two_clubs):
        club_id, _ = two_clubs
        r = session.get(
            f"{API}/clubs/{club_id}/moments", headers=_h(premium_token)
        )
        assert r.status_code == 200, r.text
        moments = r.json()
        assert isinstance(moments, list) and len(moments) >= 1
        # Find the one we uploaded
        ours = [m for m in moments if m.get("caption") == "TEST premium moment"]
        assert len(ours) >= 1, f"Uploaded moment not in list: {moments}"
        # Image base64 must be present in list response (frontend needs it)
        m = ours[0]
        assert "image" in m and m["image"].startswith("data:image"), (
            "List should expose image base64 for rendering"
        )
        assert "_id" not in m

    def test_active_clubs_contains_uploaded_club(
        self, session, premium_token, two_clubs
    ):
        club_id, _ = two_clubs
        r = session.get(f"{API}/moments/active-clubs", headers=_h(premium_token))
        assert r.status_code == 200, r.text
        rows = r.json()
        match = [x for x in rows if x["club_id"] == club_id]
        assert len(match) == 1, f"Active-clubs missing {club_id}: {rows}"
        assert match[0]["count"] >= 1
        assert "preview" in match[0]


# ---------------------------------------------------------------------------
# Tests — Free user (TTL ~24h)
# ---------------------------------------------------------------------------


class TestBeRealMomentsFreeUser:
    """A freshly-registered user is not premium → TTL should be 24h."""

    def test_free_user_not_premium(self, session, free_token):
        r = session.get(f"{API}/auth/me", headers=_h(free_token))
        assert r.status_code == 200, r.text
        assert r.json().get("is_premium") in (False, None, 0)

    def test_free_user_upload_ttl_24h(self, session, free_token, two_clubs):
        # Use the second club so we don't conflict with the premium test
        _, club_id = two_clubs
        # confirmed check-in
        r = session.post(
            f"{API}/checkins",
            json={"club_id": club_id, "confirmed": True},
            headers=_h(free_token),
        )
        assert r.status_code == 200, r.text

        # window-state should be in_window
        r = session.get(f"{API}/moments/window-state", headers=_h(free_token))
        assert r.status_code == 200
        ws = r.json()
        assert ws["in_window"] is True

        # upload
        r = session.post(
            f"{API}/clubs/{club_id}/moments",
            json={"image": TINY_PNG, "caption": "TEST free moment"},
            headers=_h(free_token),
        )
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["is_premium_author"] is False
        exp = datetime.fromisoformat(m["expires_at"].replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        delta_hours = (exp - now).total_seconds() / 3600
        assert 23 <= delta_hours <= 25, (
            f"Free TTL should be ~24h, got {delta_hours:.2f}h"
        )


# ---------------------------------------------------------------------------
# Tests — Window state false case
# ---------------------------------------------------------------------------


class TestWindowStateNegative:
    def test_window_state_false_for_user_with_no_checkin(self, session):
        # Brand new account → no check-ins ever
        email = f"TEST_nochk_{uuid.uuid4().hex[:8]}@nightfinder.app"
        token = _login_or_register(session, email, "Nochk2026!", name="No Checkin")
        r = session.get(f"{API}/moments/window-state", headers=_h(token))
        assert r.status_code == 200
        assert r.json() == {"in_window": False}


# ---------------------------------------------------------------------------
# Tests — Mongo indexes
# ---------------------------------------------------------------------------


class TestMongoIndexes:
    """Verify indexes were created on startup."""

    def test_indexes_present(self):
        from pymongo import MongoClient

        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ.get("DB_NAME", "test_database")
        client = MongoClient(mongo_url)
        try:
            db = client[db_name]
            idx = db.club_moments.index_information()
        finally:
            client.close()
        # Expected indexes
        # 1. TTL on expires_at
        ttl_keys = [
            name
            for name, spec in idx.items()
            if spec.get("key") == [("expires_at", 1)]
        ]
        assert ttl_keys, f"Missing expires_at index, got: {list(idx.keys())}"
        ttl_idx = idx[ttl_keys[0]]
        assert ttl_idx.get("expireAfterSeconds") == 0, (
            f"expires_at index must be TTL with expireAfterSeconds=0, got: {ttl_idx}"
        )

        # 2. unique on checkin_id
        ck = [n for n, s in idx.items() if s.get("key") == [("checkin_id", 1)]]
        assert ck, f"Missing checkin_id index: {list(idx.keys())}"
        assert idx[ck[0]].get("unique") is True

        # 3. unique on moment_id
        mid = [n for n, s in idx.items() if s.get("key") == [("moment_id", 1)]]
        assert mid, f"Missing moment_id index: {list(idx.keys())}"
        assert idx[mid[0]].get("unique") is True

        # 4. compound (club_id, expires_at)
        comp = [
            n
            for n, s in idx.items()
            if s.get("key") == [("club_id", 1), ("expires_at", -1)]
        ]
        assert comp, f"Missing (club_id, expires_at) compound: {list(idx.keys())}"
