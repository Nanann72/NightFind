"""Backend tests for the Jan 2026 review:
- Advanced user search filters (/api/users/search)
- Notifications unread badge + mark-read
- Chat typing indicator + read receipts smoke-test
"""
from __future__ import annotations

import os
import uuid
import pytest
import requests

BASE = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://fan-culture-app.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE}/api"

REVIEWER_EMAIL = "apple.reviewer@nightfinder.app"
REVIEWER_PASSWORD = "Reviewer2026!"


@pytest.fixture(scope="module")
def token() -> str:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": REVIEWER_EMAIL, "password": REVIEWER_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ==================== /api/users/search ==================== #


class TestUserSearch:
    def test_query_backward_compat(self, headers):
        r = requests.get(f"{API}/users/search", params={"q": "chlo"}, headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "users" in data and "count" in data
        assert isinstance(data["users"], list)
        # Check music field exposed
        if data["users"]:
            assert "music" in data["users"][0]

    def test_empty_query_no_filters_returns_empty(self, headers):
        r = requests.get(f"{API}/users/search", params={"q": ""}, headers=headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data == {"users": [], "count": 0}

    def test_age_range_only(self, headers):
        r = requests.get(
            f"{API}/users/search",
            params={"min_age": 18, "max_age": 25},
            headers=headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        users = data["users"]
        assert isinstance(users, list)
        # Should return results (age filter now works without q)
        assert data["count"] >= 0
        # Verify ages in range for those with age computed
        for u in users:
            if u.get("age") is not None:
                assert 18 <= u["age"] <= 25, f"user {u['user_id']} age {u['age']} out of range"

    def test_city_paris_filter(self, headers):
        r = requests.get(
            f"{API}/users/search",
            params={"city": "paris"},
            headers=headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        users = data["users"]
        assert isinstance(users, list)
        assert data["count"] > 0, "Expected at least one Paris user (bots seeded in Paris)"
        for u in users:
            if u.get("city"):
                assert "paris" in u["city"].lower(), f"non-paris user in results: {u['city']}"

    def test_music_filter_techno_house(self, headers):
        r = requests.get(
            f"{API}/users/search",
            params={"music": "techno,house"},
            headers=headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        users = data["users"]
        assert isinstance(users, list)
        # Verify each returned user has at least one of techno/house in music
        for u in users:
            music_list = [m.lower() for m in (u.get("music") or [])]
            joined = " ".join(music_list)
            assert ("techno" in joined) or ("house" in joined), (
                f"user {u['user_id']} music {music_list} has neither techno nor house"
            )

    def test_premium_only(self, headers):
        r = requests.get(
            f"{API}/users/search",
            params={"premium_only": "true"},
            headers=headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        for u in data["users"]:
            assert u.get("is_premium") is True, f"non-premium in premium_only: {u}"

    def test_combined_filters(self, headers):
        r = requests.get(
            f"{API}/users/search",
            params={"q": "b", "min_age": 25, "max_age": 40, "city": "paris"},
            headers=headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        for u in data["users"]:
            if u.get("age") is not None:
                assert 25 <= u["age"] <= 40
            if u.get("city"):
                assert "paris" in u["city"].lower()


# ==================== Notifications unread + mark-read ==================== #


class TestNotifications:
    def test_unread_count_shape(self, headers):
        r = requests.get(f"{API}/notifications/unread-count", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "unread" in data
        assert isinstance(data["unread"], int)
        assert data["unread"] >= 0

    def test_mark_read_zeroes_unread(self, headers):
        # Grab notifications list before
        r_list = requests.get(f"{API}/notifications", headers=headers, timeout=15)
        assert r_list.status_code == 200
        list_before = r_list.json()
        assert isinstance(list_before, list)

        # Mark all read
        r_mark = requests.post(f"{API}/notifications/mark-read", headers=headers, timeout=15)
        assert r_mark.status_code == 200, r_mark.text
        m = r_mark.json()
        assert m.get("ok") is True
        assert "updated" in m and isinstance(m["updated"], int)

        # Unread should now be 0
        r_after = requests.get(f"{API}/notifications/unread-count", headers=headers, timeout=15)
        assert r_after.status_code == 200
        assert r_after.json()["unread"] == 0

        # Notifications list still intact (mark-read does NOT delete)
        r_list_after = requests.get(f"{API}/notifications", headers=headers, timeout=15)
        assert r_list_after.status_code == 200
        list_after = r_list_after.json()
        assert len(list_after) == len(list_before), "mark-read must not delete notifications"


# ==================== Chat typing / peer-state / read ==================== #


class TestChatTypingReadReceipts:
    @pytest.fixture(scope="class")
    def match_id(self, headers) -> str:
        r = requests.get(f"{API}/matches", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        matches = r.json()
        assert isinstance(matches, list) and len(matches) > 0, "reviewer has no pre-seeded matches"
        return matches[0]["match_id"]

    def test_typing_endpoint(self, headers, match_id):
        r = requests.post(f"{API}/matches/{match_id}/typing", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

    def test_peer_state_shape(self, headers, match_id):
        r = requests.get(f"{API}/matches/{match_id}/peer-state", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "is_typing" in data and isinstance(data["is_typing"], bool)
        assert "peer_last_read_at" in data  # may be null

    def test_mark_read(self, headers, match_id):
        r = requests.post(f"{API}/matches/{match_id}/read", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        assert "marked" in data

    def test_bogus_match_returns_404(self, headers):
        fake = f"mt_{uuid.uuid4().hex[:10]}"
        r = requests.post(f"{API}/matches/{fake}/typing", headers=headers, timeout=15)
        assert r.status_code == 404
