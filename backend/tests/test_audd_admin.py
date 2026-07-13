"""Tests for the new Audd.io admin diagnostic endpoints + Jan-2026 regression.

Covers:
- GET  /api/admin/audd/status       (require_admin, mask token, list recent songs)
- POST /api/admin/audd/probe        (guardrails: too-small, invalid b64, too-large, non-admin)
- REGRESSION: GET /api/users/search?music=techno,house  (music-filter re.compile fix)
- REGRESSION: GET /api/notifications/unread-count
"""
import base64
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback (public preview URL is exported in frontend/.env)
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

ADMIN_EMAIL = "admin@nightfinder.app"
ADMIN_PWD = "NightFinder2026!Admin"
REVIEWER_EMAIL = "apple.reviewer@nightfinder.app"
REVIEWER_PWD = "Reviewer2026!"


def _login(email: str, password: str) -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
        timeout=20,
    )
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PWD)


@pytest.fixture(scope="module")
def user_token():
    return _login(REVIEWER_EMAIL, REVIEWER_PWD)


# ------------------------------------------------------------------
# /api/admin/audd/status
# ------------------------------------------------------------------
class TestAuddStatus:
    def test_admin_get_status(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/audd/status",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=20,
        )
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert set(["configured", "token_preview", "total_songs", "recent_songs"]).issubset(j.keys())
        assert isinstance(j["configured"], bool)
        assert isinstance(j["total_songs"], int)
        assert isinstance(j["recent_songs"], list)
        # If configured, token_preview must be masked (…) and NEVER equal the raw token.
        if j["configured"]:
            assert "…" in j["token_preview"] or "•" in j["token_preview"], j["token_preview"]
            raw = os.environ.get("AUDD_API_TOKEN", "")
            assert j["token_preview"] != raw
        else:
            assert j["token_preview"] == ""

    def test_non_admin_forbidden(self, user_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/audd/status",
            headers={"Authorization": f"Bearer {user_token}"},
            timeout=20,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text[:200]}"


# ------------------------------------------------------------------
# /api/admin/audd/probe
# ------------------------------------------------------------------
class TestAuddProbe:
    def test_probe_too_small(self, admin_token):
        payload = base64.b64encode(b"hi").decode()
        r = requests.post(
            f"{BASE_URL}/api/admin/audd/probe",
            json={"audio_base64": payload},
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=20,
        )
        # Must NOT hit Audd.io -> HTTP 200 with ok:false
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j["ok"] is False
        assert j["sample_bytes"] == 2  # "hi" = 2 bytes
        assert "too small" in j.get("message", "").lower()

    def test_probe_invalid_base64(self, admin_token):
        r = requests.post(
            f"{BASE_URL}/api/admin/audd/probe",
            json={"audio_base64": "not!!valid$$base64@@@###"},
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=20,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text[:200]}"

    def test_probe_too_large(self, admin_token):
        # 6 MB of raw bytes -> > 5 MB limit
        big = base64.b64encode(b"\x00" * (6 * 1024 * 1024)).decode()
        r = requests.post(
            f"{BASE_URL}/api/admin/audd/probe",
            json={"audio_base64": big},
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30,
        )
        assert r.status_code == 413, f"expected 413, got {r.status_code} {r.text[:200]}"

    def test_probe_non_admin_forbidden(self, user_token):
        payload = base64.b64encode(b"hi").decode()
        r = requests.post(
            f"{BASE_URL}/api/admin/audd/probe",
            json={"audio_base64": payload},
            headers={"Authorization": f"Bearer {user_token}"},
            timeout=20,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text[:200]}"


# ------------------------------------------------------------------
# Regression tests (Jan 2026)
# ------------------------------------------------------------------
class TestRegressionJan2026:
    def test_users_search_music_filter(self, user_token):
        # Previously crashed with 500 (regex-inside-$in). Fix must still hold.
        r = requests.get(
            f"{BASE_URL}/api/users/search",
            params={"music": "techno,house"},
            headers={"Authorization": f"Bearer {user_token}"},
            timeout=20,
        )
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert "users" in j and isinstance(j["users"], list)
        assert "count" in j

    def test_notifications_unread_count(self, user_token):
        r = requests.get(
            f"{BASE_URL}/api/notifications/unread-count",
            headers={"Authorization": f"Bearer {user_token}"},
            timeout=20,
        )
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert "unread" in j
        assert isinstance(j["unread"], int)
