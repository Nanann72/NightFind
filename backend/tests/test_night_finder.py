"""Night Finder backend API tests."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fan-culture-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@nightfinder.app"
DEMO_PASS = "demo1234"


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def auth_token(session):
    # Ensure demo account exists
    r = session.post(f"{API}/auth/register", json={
        "email": DEMO_EMAIL, "password": DEMO_PASS, "name": "Demo User", "dob": "1995-05-15"})
    if r.status_code == 200:
        return r.json()["token"]
    # Already exists -> login
    r = session.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASS})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def _no_mongo_id(obj):
    if isinstance(obj, dict):
        assert "_id" not in obj, f"Found _id key in {obj}"
        for v in obj.values():
            _no_mongo_id(v)
    elif isinstance(obj, list):
        for v in obj:
            _no_mongo_id(v)


# ---------- Clubs ----------
class TestClubs:
    def test_list_clubs_no_coords(self, session):
        r = session.get(f"{API}/clubs")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 12, f"Expected at least 12 seeded clubs, got {len(data)}"
        _no_mongo_id(data)
        assert all(c["distance_km"] is None for c in data)

    def test_list_clubs_with_coords_sorted(self, session):
        r = session.get(f"{API}/clubs", params={"lat": 48.85, "lng": 2.35})
        assert r.status_code == 200
        data = r.json()
        assert len(data) > 0
        for c in data:
            assert "distance_km" in c
            assert c["distance_km"] is not None
            assert c["distance_km"] <= 50.0
        distances = [c["distance_km"] for c in data]
        assert distances == sorted(distances), "Clubs not sorted by distance"

    def test_filter_music_techno(self, session):
        r = session.get(f"{API}/clubs", params={"music": "techno"})
        assert r.status_code == 200
        data = r.json()
        assert len(data) > 0
        assert all("techno" in c["music_styles"] for c in data)

    def test_filter_max_price(self, session):
        r = session.get(f"{API}/clubs", params={"max_price": 20})
        assert r.status_code == 200
        for c in r.json():
            assert c["avg_price"] <= 20

    def test_filter_open_now(self, session):
        r = session.get(f"{API}/clubs", params={"open_now": "true"})
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_filter_vip(self, session):
        r = session.get(f"{API}/clubs", params={"vip": "true"})
        assert r.status_code == 200
        for c in r.json():
            assert "vip" in c["features"]

    def test_filter_terrasse(self, session):
        r = session.get(f"{API}/clubs", params={"terrasse": "true"})
        assert r.status_code == 200
        for c in r.json():
            assert "terrasse" in c["features"]

    def test_search_concrete(self, session):
        r = session.get(f"{API}/clubs", params={"search": "concrete"})
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        assert any("Concrete" in c["name"] for c in data)

    def test_get_club_by_id_with_events(self, session):
        r = session.get(f"{API}/clubs")
        clubs = r.json()
        club_id = clubs[0]["club_id"]
        r = session.get(f"{API}/clubs/{club_id}")
        assert r.status_code == 200
        body = r.json()
        assert body["club_id"] == club_id
        assert "events" in body
        _no_mongo_id(body)

    def test_get_club_404(self, session):
        r = session.get(f"{API}/clubs/club_doesnotexist")
        assert r.status_code == 404


# ---------- Auth ----------
class TestAuth:
    def test_register_new_user(self, session):
        email = f"test_user_{uuid.uuid4().hex[:8]}@nightfinder.app"
        r = session.post(f"{API}/auth/register", json={
            "email": email, "password": "passw0rd!", "name": "Tester", "dob": "1995-05-15"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "token" in body and "user" in body
        assert body["user"]["email"] == email.lower()

    def test_register_duplicate(self, session, auth_token):
        r = session.post(f"{API}/auth/register", json={
            "email": DEMO_EMAIL, "password": DEMO_PASS, "name": "Demo", "dob": "1995-05-15"})
        assert r.status_code == 400

    def test_login_success(self, session, auth_token):
        r = session.post(f"{API}/auth/login", json={
            "email": DEMO_EMAIL, "password": DEMO_PASS
        })
        assert r.status_code == 200
        assert "token" in r.json()

    def test_login_bad_password(self, session, auth_token):
        r = session.post(f"{API}/auth/login", json={
            "email": DEMO_EMAIL, "password": "wrong-password"
        })
        assert r.status_code == 401

    def test_me_with_token(self, session, auth_token):
        r = session.get(f"{API}/auth/me", headers=auth_headers(auth_token))
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == DEMO_EMAIL
        _no_mongo_id(body)

    def test_me_without_token(self, session):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_forgot_password(self, session):
        r = session.post(f"{API}/auth/forgot-password", json={"email": "anything@x.com"})
        assert r.status_code == 200
        assert r.json()["ok"] is True


# ---------- Events ----------
class TestEvents:
    def test_list_events(self, session, auth_token):
        r = session.get(f"{API}/events", headers=auth_headers(auth_token))
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        for e in data:
            assert "club_name" in e
            assert "club_photo" in e
        _no_mongo_id(data)

    def test_reserve_event(self, session, auth_token):
        events = session.get(f"{API}/events", headers=auth_headers(auth_token)).json()
        assert len(events) > 0
        eid = events[0]["event_id"]
        r = session.post(f"{API}/events/{eid}/reserve", headers=auth_headers(auth_token))
        assert r.status_code == 200
        body = r.json()
        assert "reservation_id" in body
        assert body["status"] == "confirmed"


# ---------- Favorites / Swipes ----------
class TestFavorites:
    def test_favorites_flow(self, session, auth_token):
        clubs = session.get(f"{API}/clubs").json()
        cid = clubs[0]["club_id"]
        # add
        r = session.post(f"{API}/favorites/{cid}", headers=auth_headers(auth_token))
        assert r.status_code == 200
        # get
        r = session.get(f"{API}/favorites", headers=auth_headers(auth_token))
        assert r.status_code == 200
        data = r.json()
        _no_mongo_id(data)
        assert any(c["club_id"] == cid for c in data)
        # delete
        r = session.delete(f"{API}/favorites/{cid}", headers=auth_headers(auth_token))
        assert r.status_code == 200
        r = session.get(f"{API}/favorites", headers=auth_headers(auth_token))
        assert not any(c["club_id"] == cid for c in r.json())

    def test_swipe_like_adds_favorite(self, session, auth_token):
        clubs = session.get(f"{API}/clubs").json()
        cid = clubs[1]["club_id"]
        # clean
        session.delete(f"{API}/favorites/{cid}", headers=auth_headers(auth_token))
        r = session.post(f"{API}/swipes", headers=auth_headers(auth_token),
                         json={"club_id": cid, "action": "like"})
        assert r.status_code == 200
        favs = session.get(f"{API}/favorites", headers=auth_headers(auth_token)).json()
        assert any(c["club_id"] == cid for c in favs)
        session.delete(f"{API}/favorites/{cid}", headers=auth_headers(auth_token))


# ---------- Notifications ----------
class TestNotifications:
    def test_notifications_seeded(self, session, auth_token):
        r = session.get(f"{API}/notifications", headers=auth_headers(auth_token))
        assert r.status_code == 200
        data = r.json()
        _no_mongo_id(data)
        assert len(data) >= 3
