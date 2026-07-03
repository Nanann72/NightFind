"""Backend tests — /api/users/nearby endpoint must expose the 20 admin-seeded bots
to every authenticated user (admin AND regular users), with the admin account
itself always filtered out.

Reference request:
- Endpoint: GET /api/users/nearby?lat=48.8566&lng=2.3522&radius_km=15
- 20 bots pre-seeded around Paris (visibility='everyone', is_bot=true)
- Admin credentials from /app/memory/test_credentials.md
"""
import os
import random
import string
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

ADMIN_EMAIL = "admin@nightfinder.app"
ADMIN_PASSWORD = "NightFinder2026!Admin"

PARIS_LAT = 48.8566
PARIS_LNG = 2.3522


def _random_email() -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    return f"TEST_nearby_{suffix}@example.com"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("user", {}).get("is_admin") is True
    return data["token"]


@pytest.fixture(scope="module")
def regular_user():
    """Register a fresh regular (non-admin) user."""
    email = _random_email()
    payload = {
        "name": "TEST NearbyUser",
        "dob": "1998-05-12",
        "email": email,
        "password": "TestPass2026!",
    }
    r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=15)
    assert r.status_code in (200, 201), f"Register failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token")
    user_id = data.get("user", {}).get("user_id")
    assert token, "no token in register response"
    yield {"token": token, "email": email, "user_id": user_id}
    # Cleanup — best effort direct DB delete via login+DELETE? no API. Skip.


# ---- Ensure at least 20 bots exist before tests ---- #
@pytest.fixture(scope="module", autouse=True)
def ensure_bots(admin_token):
    """Guarantee ~20 bots are present. If not, seed them."""
    h = {"Authorization": f"Bearer {admin_token}"}
    stats = requests.get(f"{BASE_URL}/api/admin/bots/stats", headers=h, timeout=10).json()
    if stats.get("total_bots", 0) < 20:
        need = 20 - int(stats.get("total_bots", 0))
        requests.post(
            f"{BASE_URL}/api/admin/seed-bots?count={need}", headers=h, timeout=20
        )
    stats2 = requests.get(f"{BASE_URL}/api/admin/bots/stats", headers=h, timeout=10).json()
    assert stats2["total_bots"] >= 20, f"Only {stats2['total_bots']} bots present"
    assert stats2["bots_with_location"] >= 20, (
        f"Only {stats2['bots_with_location']} bots have location"
    )
    return stats2


# =============== Tests =============== #


class TestUsersNearby:
    def _call(self, token: str, radius: float = 15.0):
        r = requests.get(
            f"{BASE_URL}/api/users/nearby",
            params={"lat": PARIS_LAT, "lng": PARIS_LNG, "radius_km": radius},
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        return r

    def test_endpoint_requires_auth(self):
        r = requests.get(
            f"{BASE_URL}/api/users/nearby",
            params={"lat": PARIS_LAT, "lng": PARIS_LNG, "radius_km": 15},
            timeout=10,
        )
        assert r.status_code in (401, 403), f"Expected auth error, got {r.status_code}"

    def test_admin_sees_bots(self, admin_token):
        r = self._call(admin_token, radius=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "users" in body and "count" in body
        users = body["users"]
        # At least 20 bots visible
        bots = [u for u in users if u.get("is_bot")]
        assert len(bots) >= 20, (
            f"Admin only sees {len(bots)} bots (payload count={body['count']})"
        )

    def test_regular_user_sees_bots(self, regular_user):
        r = self._call(regular_user["token"], radius=15)
        assert r.status_code == 200, r.text
        body = r.json()
        bots = [u for u in body["users"] if u.get("is_bot")]
        assert len(bots) >= 20, (
            f"Regular user only sees {len(bots)} bots — bots must be visible to everyone"
        )

    def test_admin_account_excluded_from_own_nearby(self, admin_token):
        """Admin's own profile must not appear in its own /nearby response."""
        r = self._call(admin_token, radius=15)
        body = r.json()
        ids = [u.get("user_id") for u in body["users"]]
        # Fetch admin's own user_id
        me = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=10,
        )
        assert me.status_code == 200
        admin_id = me.json()["user_id"]
        assert admin_id not in ids, "Admin should be excluded (self-filter)"

    def test_admin_account_excluded_from_regular_user_nearby(self, regular_user, admin_token):
        """The hidden admin account must not appear in a regular user's /nearby."""
        r = self._call(regular_user["token"], radius=15)
        body = r.json()
        me = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=10,
        )
        admin_id = me.json()["user_id"]
        ids = [u.get("user_id") for u in body["users"]]
        assert admin_id not in ids, (
            "Admin (visibility=hidden) must never appear in regular user's nearby feed"
        )

    def test_bot_payload_shape(self, admin_token):
        r = self._call(admin_token, radius=15)
        users = r.json()["users"]
        bots = [u for u in users if u.get("is_bot")]
        assert bots, "no bots returned"
        b = bots[0]
        required = {"user_id", "name", "lat", "lng", "distance_km", "is_bot", "is_premium"}
        missing = required - set(b.keys())
        assert not missing, f"Bot payload missing fields: {missing}"
        assert isinstance(b["lat"], (int, float))
        assert isinstance(b["lng"], (int, float))
        assert isinstance(b["distance_km"], (int, float))
        assert b["distance_km"] >= 0
        # Optional but expected
        assert "picture" in b, "picture field expected in nearby payload"

    def test_bots_within_radius(self, admin_token):
        r = self._call(admin_token, radius=15)
        users = r.json()["users"]
        for u in users:
            assert u["distance_km"] <= 15.001, (
                f"user {u['user_id']} at distance {u['distance_km']} > radius"
            )

    def test_small_radius_still_finds_bots(self, admin_token):
        """Bots are scattered within ~5 km of Paris center — 5 km should return most of them."""
        r = self._call(admin_token, radius=5)
        body = r.json()
        bots = [u for u in body["users"] if u.get("is_bot")]
        assert len(bots) >= 5, (
            f"Only {len(bots)} bots within 5 km — expected majority of the 20 bots"
        )

    def test_response_sorted_by_distance(self, admin_token):
        r = self._call(admin_token, radius=15)
        distances = [u["distance_km"] for u in r.json()["users"]]
        assert distances == sorted(distances), "Nearby users must be sorted by distance"
