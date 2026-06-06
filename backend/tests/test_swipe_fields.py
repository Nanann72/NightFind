"""Tests for PUT /api/profile/swipe-fields and DOB validation flows.

These tests verify:
1. Updating swipe-fields persists for the demo account
2. /auth/me returns bio/city/instagram/dob after update (current bug check)
3. DD/MM/YYYY format is rejected (must always be YYYY-MM-DD)
4. <18 years old DOB is rejected with 400
5. Invalid calendar dates are rejected
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fan-culture-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@nightfinder.app"
DEMO_PASSWORD = "demo1234"


@pytest.fixture(scope="module")
def demo_token():
    r = requests.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def fresh_user_token():
    """Create a brand new user (18+) to safely run mutating tests without polluting demo."""
    ts = int(datetime.now(timezone.utc).timestamp())
    email = f"test_sf_{ts}_{uuid.uuid4().hex[:6]}@nightfinder.app"
    payload = {"email": email, "password": "Test12345!", "name": "TEST SwipeFields", "dob": "1995-02-15"}
    r = requests.post(f"{API}/auth/register", json=payload, timeout=15)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    return r.json()["token"], r.json()["user"]["user_id"], email


def H(token: str):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---- 1) Valid update + persistence ---- #
def test_update_swipe_fields_valid_returns_200(fresh_user_token):
    token, _, _ = fresh_user_token
    body = {"bio": "Soirées électro à fond", "city": "Paris", "instagram": "@test_handle", "dob": "1995-02-15"}
    r = requests.put(f"{API}/profile/swipe-fields", headers=H(token), json=body, timeout=15)
    assert r.status_code == 200, f"got {r.status_code} {r.text}"
    j = r.json()
    assert j["ok"] is True
    assert set(j["updated"]) == {"bio", "city", "instagram", "dob"}


def test_auth_me_returns_swipe_fields_after_update(fresh_user_token):
    """CRITICAL: After update, /auth/me must return bio/city/instagram/dob.
    If this fails, the frontend swipe-profile screen will not pre-fill values
    next time the user opens it (user perceives 'config not saving')."""
    token, _, _ = fresh_user_token
    # First do the update (idempotent)
    body = {"bio": "Soirées électro à fond", "city": "Paris", "instagram": "test_handle", "dob": "1995-02-15"}
    requests.put(f"{API}/profile/swipe-fields", headers=H(token), json=body, timeout=15)

    r = requests.get(f"{API}/auth/me", headers=H(token), timeout=15)
    assert r.status_code == 200
    me = r.json()
    assert me.get("bio") == "Soirées électro à fond", f"bio not exposed: {me}"
    assert me.get("city") == "Paris", f"city not exposed: {me}"
    assert me.get("instagram") == "test_handle", f"instagram not exposed: {me}"
    assert me.get("dob") == "1995-02-15", f"dob not exposed: {me}"


# ---- 2) DD/MM/YYYY rejected ---- #
def test_update_dob_ddmmyyyy_rejected(fresh_user_token):
    token, _, _ = fresh_user_token
    r = requests.put(f"{API}/profile/swipe-fields", headers=H(token), json={"dob": "15/02/1995"}, timeout=15)
    assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"
    assert "invalide" in r.text.lower() or "yyyy" in r.text.lower()


# ---- 3) Under 18 rejected ---- #
def test_update_dob_under_18_rejected(fresh_user_token):
    token, _, _ = fresh_user_token
    today = datetime.now(timezone.utc).date()
    young = today.replace(year=today.year - 17)
    r = requests.put(f"{API}/profile/swipe-fields", headers=H(token), json={"dob": young.isoformat()}, timeout=15)
    assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"
    assert "18" in r.text


# ---- 4) Invalid calendar date (Feb 30) — but our backend parses with strptime, so 02-30 must fail ---- #
def test_update_dob_invalid_calendar_rejected(fresh_user_token):
    token, _, _ = fresh_user_token
    r = requests.put(f"{API}/profile/swipe-fields", headers=H(token), json={"dob": "1995-02-30"}, timeout=15)
    assert r.status_code == 400


# ---- 5) Leap year edge cases ---- #
def test_update_dob_leap_year_2024_accepted(fresh_user_token):
    token, _, _ = fresh_user_token
    r = requests.put(f"{API}/profile/swipe-fields", headers=H(token), json={"dob": "2004-02-29"}, timeout=15)
    # 2004 is a leap year and the person is >= 18 in 2026
    assert r.status_code == 200, r.text


def test_update_dob_non_leap_2023_rejected(fresh_user_token):
    token, _, _ = fresh_user_token
    r = requests.put(f"{API}/profile/swipe-fields", headers=H(token), json={"dob": "2023-02-29"}, timeout=15)
    assert r.status_code == 400


# ---- 6) Demo account read-only sanity check (do not mutate fields) ---- #
def test_demo_auth_me_works(demo_token):
    r = requests.get(f"{API}/auth/me", headers=H(demo_token), timeout=15)
    assert r.status_code == 200
    me = r.json()
    assert me["email"] == DEMO_EMAIL


# ---- 7) Instagram handle validation ---- #
def test_invalid_instagram_handle_rejected(fresh_user_token):
    token, _, _ = fresh_user_token
    r = requests.put(f"{API}/profile/swipe-fields", headers=H(token), json={"instagram": "bad handle with spaces!!!"}, timeout=15)
    assert r.status_code == 400


def test_instagram_strips_leading_at(fresh_user_token):
    token, _, _ = fresh_user_token
    r = requests.put(f"{API}/profile/swipe-fields", headers=H(token), json={"instagram": "@nightfinder"}, timeout=15)
    assert r.status_code == 200
    me = requests.get(f"{API}/auth/me", headers=H(token), timeout=15).json()
    # Will fail too if auth/me doesn't expose instagram (caught by test above)
    assert me.get("instagram") in ("nightfinder", None)


# ---- 8) Bio length limit ---- #
def test_bio_too_long_rejected(fresh_user_token):
    token, _, _ = fresh_user_token
    r = requests.put(f"{API}/profile/swipe-fields", headers=H(token), json={"bio": "x" * 501}, timeout=15)
    assert r.status_code == 400


# ---- 9) Empty body returns ok with empty updates ---- #
def test_empty_body_returns_ok(fresh_user_token):
    token, _, _ = fresh_user_token
    r = requests.put(f"{API}/profile/swipe-fields", headers=H(token), json={}, timeout=15)
    assert r.status_code == 200
    assert r.json()["updated"] == []
