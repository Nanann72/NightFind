"""Friends system (Phase 1) backend tests.

Covers:
- /api/auth/login response includes username & visibility
- /api/profile/username (validation, uniqueness 409)
- /api/profile/visibility (3 valid values + 400 on invalid)
- /api/friends/list, /api/friends/search, /api/friends/active
- friend request → accept flow (+ remove friend cleanup)
- privacy invariant: hidden users excluded from /api/friends/active
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://fan-culture-app.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@nightfinder.app"
DEMO_PASS = "demo1234"


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def demo_token(session):
    r = session.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASS})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def demo_user(session, demo_token):
    r = session.get(f"{API}/auth/me", headers=_auth(demo_token))
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def second_user(session):
    email = f"test_friend_{uuid.uuid4().hex[:8]}@nightfinder.app"
    r = session.post(
        f"{API}/auth/register",
        json={"email": email, "password": "passw0rd!", "name": "Second User"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    return {"token": body["token"], "user": body["user"], "email": email}


# ---------- /api/auth/me includes username + visibility ----------
class TestAuthMeFields:
    def test_login_response_has_username_and_visibility(self, session):
        r = session.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASS})
        assert r.status_code == 200
        u = r.json()["user"]
        assert "username" in u, "username field missing on login user"
        assert "visibility" in u, "visibility field missing on login user"
        assert u["visibility"] in ("always", "clubs_only", "hidden")

    def test_me_returns_username_visibility(self, session, demo_token):
        r = session.get(f"{API}/auth/me", headers=_auth(demo_token))
        assert r.status_code == 200
        body = r.json()
        assert "username" in body
        assert "visibility" in body


# ---------- /api/profile/username ----------
class TestUsername:
    def test_set_valid_username(self, session, demo_token):
        # unique username for demo
        u = f"demo_{uuid.uuid4().hex[:6]}"
        r = session.put(
            f"{API}/profile/username",
            headers=_auth(demo_token),
            json={"username": u},
        )
        assert r.status_code == 200, r.text
        assert r.json()["username"] == u
        # GET /me to verify persistence
        me = session.get(f"{API}/auth/me", headers=_auth(demo_token)).json()
        assert me["username"] == u

    @pytest.mark.parametrize(
        "bad",
        ["ab", "a" * 21, "Bad-Name", "with space", "hé-llo"],
    )
    def test_invalid_username_400(self, session, demo_token, bad):
        r = session.put(
            f"{API}/profile/username",
            headers=_auth(demo_token),
            json={"username": bad},
        )
        assert r.status_code == 400, f"Expected 400 for {bad!r}, got {r.status_code}"

    def test_uppercase_username_is_lowercased(self, session, demo_token):
        # Backend strips + lowercases before regex check, so UPPER becomes valid.
        u = f"UPPER{uuid.uuid4().hex[:4]}"
        r = session.put(
            f"{API}/profile/username", headers=_auth(demo_token), json={"username": u}
        )
        assert r.status_code == 200
        assert r.json()["username"] == u.lower()

    def test_username_uniqueness_returns_409(self, session, demo_token, second_user):
        shared = f"shared_{uuid.uuid4().hex[:6]}"
        # demo claims shared
        r = session.put(
            f"{API}/profile/username",
            headers=_auth(demo_token),
            json={"username": shared},
        )
        assert r.status_code == 200
        # second user tries to take same → 409
        r2 = session.put(
            f"{API}/profile/username",
            headers=_auth(second_user["token"]),
            json={"username": shared},
        )
        assert r2.status_code == 409, r2.text

    def test_unauthenticated_set_username_401(self, session):
        r = session.put(f"{API}/profile/username", json={"username": "abcdef"})
        assert r.status_code == 401


# ---------- /api/profile/visibility ----------
class TestVisibility:
    @pytest.mark.parametrize("value", ["always", "clubs_only", "hidden"])
    def test_valid_visibility(self, session, demo_token, value):
        r = session.put(
            f"{API}/profile/visibility",
            headers=_auth(demo_token),
            json={"visibility": value},
        )
        assert r.status_code == 200, r.text
        assert r.json()["visibility"] == value
        me = session.get(f"{API}/auth/me", headers=_auth(demo_token)).json()
        assert me["visibility"] == value

    def test_invalid_visibility_400(self, session, demo_token):
        r = session.put(
            f"{API}/profile/visibility",
            headers=_auth(demo_token),
            json={"visibility": "invisible"},
        )
        assert r.status_code == 400


# ---------- Friend request flow ----------
class TestFriendsFlow:
    def test_list_structure_initially(self, session, demo_token):
        r = session.get(f"{API}/friends/list", headers=_auth(demo_token))
        assert r.status_code == 200
        body = r.json()
        for k in ("friends", "incoming", "outgoing"):
            assert k in body, f"missing key {k}"
            assert isinstance(body[k], list)

    def test_active_empty_when_no_friends(self, session, second_user):
        # second_user has no friendships -> []
        r = session.get(f"{API}/friends/active", headers=_auth(second_user["token"]))
        assert r.status_code == 200
        assert r.json() == []

    def test_search_min_length(self, session, demo_token):
        r = session.get(f"{API}/friends/search?q=a", headers=_auth(demo_token))
        assert r.status_code == 200
        assert r.json() == []

    def test_search_excludes_self(self, session, demo_token, demo_user):
        # set demo username deterministically
        uname = f"demosearch_{uuid.uuid4().hex[:4]}"
        session.put(
            f"{API}/profile/username", headers=_auth(demo_token), json={"username": uname}
        )
        r = session.get(
            f"{API}/friends/search?q={uname[:4]}", headers=_auth(demo_token)
        )
        assert r.status_code == 200
        for u in r.json():
            assert u["user_id"] != demo_user["user_id"]

    def test_request_accept_remove_flow(self, session, demo_token, demo_user, second_user):
        # Ensure second user has a username (so it can be discovered)
        peer_uname = f"peer_{uuid.uuid4().hex[:6]}"
        r = session.put(
            f"{API}/profile/username",
            headers=_auth(second_user["token"]),
            json={"username": peer_uname},
        )
        assert r.status_code == 200

        # Search from demo finds the peer
        r = session.get(
            f"{API}/friends/search?q={peer_uname[:4]}", headers=_auth(demo_token)
        )
        assert r.status_code == 200
        results = r.json()
        peer_id = second_user["user"]["user_id"]
        assert any(u["user_id"] == peer_id for u in results), "peer not in search results"

        # Demo sends request
        r = session.post(
            f"{API}/friends/request",
            headers=_auth(demo_token),
            json={"target_user_id": peer_id},
        )
        assert r.status_code == 200, r.text

        # Duplicate request → 409
        r2 = session.post(
            f"{API}/friends/request",
            headers=_auth(demo_token),
            json={"target_user_id": peer_id},
        )
        assert r2.status_code == 409

        # Demo's outgoing should contain the peer
        demo_list = session.get(f"{API}/friends/list", headers=_auth(demo_token)).json()
        outgoing_ids = [f["user_id"] for f in demo_list["outgoing"]]
        assert peer_id in outgoing_ids

        # Peer's incoming should contain demo
        peer_list = session.get(
            f"{API}/friends/list", headers=_auth(second_user["token"])
        ).json()
        incoming = peer_list["incoming"]
        assert any(f["user_id"] == demo_user["user_id"] for f in incoming)
        friendship_id = next(
            f["friendship_id"] for f in incoming if f["user_id"] == demo_user["user_id"]
        )

        # Peer accepts
        r = session.post(
            f"{API}/friends/{friendship_id}/accept",
            headers=_auth(second_user["token"]),
        )
        assert r.status_code == 200, r.text

        # Both now see each other in friends list
        demo_list = session.get(f"{API}/friends/list", headers=_auth(demo_token)).json()
        assert any(f["user_id"] == peer_id for f in demo_list["friends"])
        peer_list = session.get(
            f"{API}/friends/list", headers=_auth(second_user["token"])
        ).json()
        assert any(f["user_id"] == demo_user["user_id"] for f in peer_list["friends"])

        # Cannot send self request
        r = session.post(
            f"{API}/friends/request",
            headers=_auth(demo_token),
            json={"target_user_id": demo_user["user_id"]},
        )
        assert r.status_code == 400

        # ---- Privacy: peer is hidden → /friends/active for demo must NOT include peer ----
        session.put(
            f"{API}/profile/visibility",
            headers=_auth(second_user["token"]),
            json={"visibility": "hidden"},
        )
        # create a checkin for peer so they would otherwise show up
        clubs = session.get(f"{API}/clubs").json()
        club_id = clubs[0]["club_id"]
        ci = session.post(
            f"{API}/checkins",
            headers=_auth(second_user["token"]),
            json={"club_id": club_id, "confirmed": True},
        )
        assert ci.status_code == 200
        active = session.get(f"{API}/friends/active", headers=_auth(demo_token)).json()
        assert all(a["user_id"] != peer_id for a in active), (
            "Hidden friend leaked into /friends/active"
        )

        # Switch peer to clubs_only → they should now appear in active
        session.put(
            f"{API}/profile/visibility",
            headers=_auth(second_user["token"]),
            json={"visibility": "clubs_only"},
        )
        active2 = session.get(f"{API}/friends/active", headers=_auth(demo_token)).json()
        assert any(a["user_id"] == peer_id for a in active2), (
            "Visible friend not present in /friends/active after recent checkin"
        )
        # Sanity on fields
        entry = next(a for a in active2 if a["user_id"] == peer_id)
        for k in ("club_id", "club_name", "lat", "lng", "checked_in_at"):
            assert k in entry

        # Cleanup — remove friendship
        r = session.delete(
            f"{API}/friends/{peer_id}", headers=_auth(demo_token)
        )
        assert r.status_code == 200
        demo_list = session.get(f"{API}/friends/list", headers=_auth(demo_token)).json()
        assert not any(f["user_id"] == peer_id for f in demo_list["friends"])


# ---------- Reject flow ----------
class TestRejectFlow:
    def test_reject_pending_request(self, session, demo_token):
        # Create a fresh user just for this test (avoid coupling with accept-flow)
        email = f"test_reject_{uuid.uuid4().hex[:8]}@nightfinder.app"
        r = session.post(
            f"{API}/auth/register",
            json={"email": email, "password": "passw0rd!", "name": "Reject User"},
        )
        assert r.status_code == 200
        other_token = r.json()["token"]
        other_id = r.json()["user"]["user_id"]

        # Demo sends request
        r = session.post(
            f"{API}/friends/request",
            headers=_auth(demo_token),
            json={"target_user_id": other_id},
        )
        assert r.status_code == 200

        # Other rejects
        other_list = session.get(f"{API}/friends/list", headers=_auth(other_token)).json()
        fs_id = other_list["incoming"][0]["friendship_id"]
        r = session.post(f"{API}/friends/{fs_id}/reject", headers=_auth(other_token))
        assert r.status_code == 200

        # Now incoming is empty for other, demo outgoing is empty too
        other_list = session.get(f"{API}/friends/list", headers=_auth(other_token)).json()
        assert all(f["friendship_id"] != fs_id for f in other_list["incoming"])
        demo_list = session.get(f"{API}/friends/list", headers=_auth(demo_token)).json()
        assert all(f["user_id"] != other_id for f in demo_list["outgoing"])
