"""Backend tests for iteration 32:
- BUG 1: /api/auth/apple with unsigned JWT (identity_token) -> 200; invalid random string -> 400
- BUG 2: /api/auth/login with apple.reviewer@nightfinder.app / Reviewer2026! -> 200 + /api/auth/me returns Apple Reviewer + is_premium
- FEATURE: /api/checkins/manual within radius -> 200, outside ~500m -> 403 with 'Rapproche-toi'
"""
import os
import json
import base64
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fan-culture-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def make_unsigned_jwt(payload: dict) -> str:
    """Produce a JWT with alg=HS256 but any signature; backend decodes without verify."""
    header = {"alg": "HS256", "typ": "JWT"}
    h = _b64url(json.dumps(header, separators=(",", ":")).encode())
    p = _b64url(json.dumps(payload, separators=(",", ":")).encode())
    # arbitrary signature - backend won't verify
    s = _b64url(b"fake-signature")
    return f"{h}.{p}.{s}"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- BUG 1 --- Apple Sign-In endpoint ---
class TestAppleSignIn:
    def test_apple_signin_with_unsigned_jwt_returns_200(self, api_client):
        token = make_unsigned_jwt({"sub": "test123", "email": "appletest@example.com"})
        r = api_client.post(f"{API}/auth/apple", json={"identity_token": token})
        assert r.status_code == 200, f"expected 200, got {r.status_code} body={r.text}"
        data = r.json()
        assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 10
        assert "user" in data
        u = data["user"]
        assert u.get("email") == "appletest@example.com"
        # Ensure user_id shape
        assert "user_id" in u or "id" in u

    def test_apple_signin_with_random_string_returns_400(self, api_client):
        r = api_client.post(f"{API}/auth/apple", json={"identity_token": "this-is-not-a-jwt-at-all"})
        assert r.status_code == 400, f"expected 400, got {r.status_code} body={r.text}"

    def test_apple_signin_persists_user_second_call_same_user(self, api_client):
        token = make_unsigned_jwt({"sub": "test123", "email": "appletest@example.com"})
        r1 = api_client.post(f"{API}/auth/apple", json={"identity_token": token})
        r2 = api_client.post(f"{API}/auth/apple", json={"identity_token": token})
        assert r1.status_code == 200 and r2.status_code == 200
        u1 = r1.json()["user"]
        u2 = r2.json()["user"]
        # Same identifier
        assert u1.get("user_id", u1.get("id")) == u2.get("user_id", u2.get("id"))


# --- BUG 2 --- Reviewer account login + /auth/me ---
class TestReviewerAccount:
    def test_reviewer_login_and_me(self, api_client):
        r = api_client.post(f"{API}/auth/login", json={
            "email": "apple.reviewer@nightfinder.app",
            "password": "Reviewer2026!",
        })
        assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
        data = r.json()
        assert "token" in data
        token = data["token"]

        me = api_client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200, f"me failed: {me.status_code} {me.text}"
        me_data = me.json()
        # Check name and premium
        assert me_data.get("name") == "Apple Reviewer", f"got name={me_data.get('name')}"
        assert me_data.get("is_premium") is True, f"is_premium not True: {me_data}"


# --- FEATURE --- Manual check-in ---
class TestManualCheckin:
    @pytest.fixture(scope="class")
    def emma_token(self, api_client):
        r = api_client.post(f"{API}/auth/login", json={
            "email": "emma.demo@nightfinder.app",
            "password": "DemoOnly2026!",
        })
        assert r.status_code == 200, f"emma login failed: {r.status_code} {r.text}"
        return r.json()["token"]

    @pytest.fixture(scope="class")
    def a_club(self, api_client, emma_token):
        r = api_client.get(
            f"{API}/clubs",
            params={"lat": 48.8566, "lng": 2.3522, "radius_km": 10},
            headers={"Authorization": f"Bearer {emma_token}"},
        )
        assert r.status_code == 200, f"clubs list failed: {r.status_code} {r.text}"
        clubs = r.json()
        # Response may be list or {items: [...]}
        if isinstance(clubs, dict):
            clubs = clubs.get("items") or clubs.get("clubs") or []
        assert len(clubs) > 0, "no clubs returned in radius"
        # find one with lat/lng
        for c in clubs:
            if c.get("lat") and c.get("lng"):
                return c
        pytest.skip("no club with coordinates")

    def test_manual_checkin_at_club_coords_returns_ok(self, api_client, emma_token, a_club):
        payload = {
            "club_id": a_club["club_id"] if "club_id" in a_club else a_club["id"],
            "lat": a_club["lat"],
            "lng": a_club["lng"],
        }
        r = api_client.post(
            f"{API}/checkins/manual",
            json=payload,
            headers={"Authorization": f"Bearer {emma_token}"},
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code} body={r.text}"
        data = r.json()
        assert data.get("ok") is True
        assert "distance_m" in data
        assert data["distance_m"] < 5

    def test_manual_checkin_far_returns_403_with_rapproche(self, api_client, emma_token, a_club):
        # Offset ~500m north (0.0045 deg lat ≈ 500m)
        payload = {
            "club_id": a_club["club_id"] if "club_id" in a_club else a_club["id"],
            "lat": a_club["lat"] + 0.0045,
            "lng": a_club["lng"],
        }
        r = api_client.post(
            f"{API}/checkins/manual",
            json=payload,
            headers={"Authorization": f"Bearer {emma_token}"},
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code} body={r.text}"
        detail = r.json().get("detail", "")
        assert "Rapproche-toi" in detail, f"missing 'Rapproche-toi' in: {detail}"

    def test_manual_checkin_requires_auth(self, api_client, a_club):
        payload = {
            "club_id": a_club["club_id"] if "club_id" in a_club else a_club["id"],
            "lat": a_club["lat"],
            "lng": a_club["lng"],
        }
        r = api_client.post(f"{API}/checkins/manual", json=payload)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"
