"""Backend tests for GET /api/users/{user_id}/profile (public profile).

Covers:
- Profile shape for existing user (Emma)
- 404 for unknown user_id
- friendship.status transitions: none -> pending_out (reviewer side) / pending_in (Emma side)
  -> accepted after Emma accepts.
- Cleanup: removes the friendship at the end so demo Apple accounts stay pristine.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

REVIEWER = {"email": "apple.reviewer@nightfinder.app", "password": "Reviewer2026!"}
EMMA = {"email": "emma.demo@nightfinder.app", "password": "DemoOnly2026!"}
EMMA_ID = "user_demo_emma01"


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    j = r.json()
    return j["token"], j["user"]


def _headers(token):
    return {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def sessions():
    r_tok, r_user = _login(REVIEWER)
    e_tok, e_user = _login(EMMA)
    yield {
        "reviewer": {"token": r_tok, "user": r_user},
        "emma": {"token": e_tok, "user": e_user},
    }
    # Cleanup: reviewer removes friendship with Emma (idempotent)
    try:
        requests.delete(
            f"{API}/friends/{EMMA_ID}",
            headers=_headers(r_tok),
            timeout=15,
        )
    except Exception:
        pass


def _cleanup_friendship(reviewer_token):
    """Ensure no friendship exists between reviewer and Emma before starting."""
    requests.delete(f"{API}/friends/{EMMA_ID}", headers=_headers(reviewer_token), timeout=15)


# ---------- 1. Profile shape ---------- #
class TestProfileShape:
    def test_profile_of_emma_returns_expected_fields(self, sessions):
        tok = sessions["reviewer"]["token"]
        r = requests.get(f"{API}/users/{EMMA_ID}/profile", headers=_headers(tok), timeout=30)
        assert r.status_code == 200, r.text
        p = r.json()

        # Basic identity
        assert p.get("user_id") == EMMA_ID
        assert p.get("name")  # not empty
        # Backend may store age as int; ensure key exists (may be None if dob missing)
        assert "age" in p
        assert "bio" in p
        assert "city" in p
        assert isinstance(p.get("photos", []), list)
        assert isinstance(p.get("music_prefs", []), list)
        assert "picture" in p
        assert isinstance(p.get("is_premium"), bool)
        assert p.get("is_me") is False

        # Stats
        stats = p.get("stats") or {}
        for k in ("friends", "checkins", "moments", "likes_received"):
            assert k in stats, f"missing stats.{k}"
            assert isinstance(stats[k], int)

        # Moments list
        moments = p.get("moments")
        assert isinstance(moments, list)
        for m in moments:
            assert "moment_id" in m
            assert "active" in m
            # club_name may be None but key expected in enriched shape
            assert "club_name" in m

        # Friendship
        assert "friendship" in p
        assert p["friendship"].get("status") in {"none", "pending_out", "pending_in", "accepted"}

        # No mongo _id leak
        assert "_id" not in p

    def test_profile_of_self_returns_is_me_true(self, sessions):
        tok = sessions["reviewer"]["token"]
        me_id = sessions["reviewer"]["user"]["user_id"]
        r = requests.get(f"{API}/users/{me_id}/profile", headers=_headers(tok), timeout=30)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p.get("is_me") is True
        assert p.get("friendship", {}).get("status") == "none"


# ---------- 2. 404 for unknown user ---------- #
class TestProfileNotFound:
    def test_unknown_user_returns_404(self, sessions):
        tok = sessions["reviewer"]["token"]
        r = requests.get(
            f"{API}/users/user_does_not_exist_xyz_999/profile",
            headers=_headers(tok),
            timeout=30,
        )
        assert r.status_code == 404
        detail = ""
        try:
            detail = r.json().get("detail", "")
        except Exception:
            detail = r.text
        assert "introuvable" in detail.lower() or "not found" in detail.lower()


# ---------- 3. Friendship flow ---------- #
class TestFriendshipFlow:
    def test_full_friendship_flow_between_reviewer_and_emma(self, sessions):
        r_tok = sessions["reviewer"]["token"]
        e_tok = sessions["emma"]["token"]
        reviewer_id = sessions["reviewer"]["user"]["user_id"]

        # 0. Reset: ensure no prior friendship
        _cleanup_friendship(r_tok)

        # 1. Baseline: from reviewer side, status should be 'none'
        r = requests.get(
            f"{API}/users/{EMMA_ID}/profile",
            headers=_headers(r_tok),
            timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["friendship"]["status"] == "none"
        stats_before = r.json()["stats"]["friends"]

        # 2. Reviewer sends friend request
        r = requests.post(
            f"{API}/friends/request",
            headers=_headers(r_tok),
            json={"target_user_id": EMMA_ID},
            timeout=30,
        )
        assert r.status_code == 200, r.text

        # 3. Reviewer -> Emma profile: pending_out
        r = requests.get(
            f"{API}/users/{EMMA_ID}/profile",
            headers=_headers(r_tok),
            timeout=30,
        )
        assert r.status_code == 200
        pj = r.json()
        assert pj["friendship"]["status"] == "pending_out", pj["friendship"]

        # 4. Emma -> Reviewer profile: pending_in with friendship_id
        r = requests.get(
            f"{API}/users/{reviewer_id}/profile",
            headers=_headers(e_tok),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        pe = r.json()
        assert pe["friendship"]["status"] == "pending_in", pe["friendship"]
        fid = pe["friendship"]["friendship_id"]
        assert fid, "friendship_id should be present for pending_in"

        # 5. Emma accepts
        r = requests.post(
            f"{API}/friends/{fid}/accept",
            headers=_headers(e_tok),
            timeout=30,
        )
        assert r.status_code == 200, r.text

        # 6. Both sides see accepted + stats.friends incremented
        r1 = requests.get(
            f"{API}/users/{EMMA_ID}/profile",
            headers=_headers(r_tok),
            timeout=30,
        )
        r2 = requests.get(
            f"{API}/users/{reviewer_id}/profile",
            headers=_headers(e_tok),
            timeout=30,
        )
        assert r1.status_code == 200 and r2.status_code == 200
        p1, p2 = r1.json(), r2.json()
        assert p1["friendship"]["status"] == "accepted"
        assert p2["friendship"]["status"] == "accepted"
        assert p1["stats"]["friends"] >= stats_before + 1

        # 7. Cleanup: reviewer removes friendship
        r = requests.delete(
            f"{API}/friends/{EMMA_ID}",
            headers=_headers(r_tok),
            timeout=30,
        )
        assert r.status_code == 200, r.text

        # 8. Verify cleanup: reviewer -> Emma is back to 'none'
        r = requests.get(
            f"{API}/users/{EMMA_ID}/profile",
            headers=_headers(r_tok),
            timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["friendship"]["status"] == "none"


# ---------- 4. Auth required ---------- #
class TestAuthRequired:
    def test_profile_without_auth_returns_401_or_403(self):
        r = requests.get(f"{API}/users/{EMMA_ID}/profile", timeout=30)
        assert r.status_code in (401, 403), f"expected 401/403 unauth, got {r.status_code}"
