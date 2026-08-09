"""
Iteration 36 - Backend re-verification for Swipe Tinder features (superlike/rewind/boost/instant match).
Focused smoke tests only (main script curl already passed). Uses reviewer + Emma demo accounts.
"""
import os
import pytest
import requests

BASE = os.environ.get("EXPO_BACKEND_URL", "https://fan-culture-app.preview.emergentagent.com").rstrip("/")


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def reviewer_token():
    return _login("apple.reviewer@nightfinder.app", "Reviewer2026!")


@pytest.fixture(scope="module")
def emma_token():
    return _login("emma.demo@nightfinder.app", "DemoOnly2026!")


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# --- Quota endpoint returns superlike + boost fields ---
def test_quota_has_superlike_and_boost_fields(reviewer_token):
    r = requests.get(f"{BASE}/api/swipe/quota", headers=_h(reviewer_token), timeout=15)
    assert r.status_code == 200, r.text
    q = r.json()
    for key in ("superlikes_limit", "superlikes_remaining", "boost_active"):
        assert key in q, f"missing {key} in {q}"
    assert "boost_until" in q  # even if null
    assert isinstance(q["superlikes_limit"], int)
    assert isinstance(q["superlikes_remaining"], int)


# --- Deck endpoint reachable + returns list ---
def test_swipe_deck_reachable(reviewer_token):
    r = requests.get(f"{BASE}/api/swipe/deck", headers=_h(reviewer_token), timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, list)


# --- Non-premium (Emma) → rewind returns 402 ---
def test_rewind_402_non_premium(emma_token):
    r = requests.post(f"{BASE}/api/swipe/rewind", headers=_h(emma_token), timeout=15)
    assert r.status_code == 402, r.text


# --- Non-premium → boost returns 402 ---
def test_boost_402_non_premium(emma_token):
    r = requests.post(f"{BASE}/api/swipe/boost", headers=_h(emma_token), timeout=15)
    assert r.status_code == 402, r.text


# --- Premium reviewer can call boost (may 200 or 409 if already active) ---
def test_boost_premium_reviewer(reviewer_token):
    r = requests.post(f"{BASE}/api/swipe/boost", headers=_h(reviewer_token), timeout=15)
    assert r.status_code in (200, 409), r.text
