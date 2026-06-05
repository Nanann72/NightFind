"""Push notifications backend integration tests (iteration_3).

Covers:
- POST /api/register-push (auth, 201/200 with upstream_ok=False on placeholder key)
- POST /api/register-push 403 when body.user_id != authenticated user
- Side-effects of /api/friends/request → notifications doc (type=friend_request)
- Side-effects of /api/friends/{id}/accept → notifications doc (type=friend_accepted)
- Side-effects of /api/checkins (confirmed=true) → notifications doc (type=friend_at_club)
- Privacy: when sender visibility=hidden → no friend_at_club notification fired
- Endpoints still return 200/201 even when upstream push relay is unreachable
- db.push_tokens persistence
"""
from __future__ import annotations

import os
import uuid
import asyncio

import pytest
import requests

# Local backend (placeholder push key — upstream relay will reject with 401)
BASE_URL = os.environ.get("BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@nightfinder.app"
DEMO_PASS = "demo1234"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------- fixtures ---------------- #


@pytest.fixture(scope="module")
def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def demo_token(session: requests.Session) -> str:
    r = session.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASS})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def demo_user(session: requests.Session, demo_token: str) -> dict:
    r = session.get(f"{API}/auth/me", headers=_auth(demo_token))
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def peer_user(session: requests.Session) -> dict:
    """Create a fresh transient user used as friend target."""
    email = f"test_push_{uuid.uuid4().hex[:8]}@nightfinder.app"
    r = session.post(
        f"{API}/auth/register",
        json={"email": email, "password": "passw0rd!", "name": "Push Peer", "dob": "1995-05-15"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    return {"token": body["token"], "user": body["user"], "email": email}


@pytest.fixture(scope="module")
def db():
    """Direct MongoDB handle for verifying side-effects (notifications + push_tokens)."""
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    from pathlib import Path
    load_dotenv(Path("/app/backend/.env"))
    mongo_url = os.environ["MONGO_URL"]
    cli = AsyncIOMotorClient(mongo_url)
    return cli[os.environ.get("DB_NAME", "night_finder")]


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ---------------- /api/auth/me ---------------- #


class TestAuthMe:
    def test_me_has_username_and_visibility(self, demo_user):
        assert "username" in demo_user
        assert "visibility" in demo_user
        assert demo_user["visibility"] in ("always", "clubs_only", "hidden")


# ---------------- /api/register-push ---------------- #


class TestRegisterPush:
    def test_register_push_success_returns_upstream_ok_false(self, session, demo_token, demo_user, db):
        body = {
            "user_id": demo_user["user_id"],
            "platform": "ios",
            "device_token": f"TEST_TOKEN_{uuid.uuid4().hex[:12]}",
        }
        r = session.post(f"{API}/register-push", headers=_auth(demo_token), json=body)
        assert r.status_code in (200, 201), r.text
        payload = r.json()
        assert payload["status"] == "registered"
        assert payload["upstream_ok"] is False, "placeholder key must result in upstream_ok=False"

        # Persistence in db.push_tokens
        doc = _run(db.push_tokens.find_one({"user_id": demo_user["user_id"], "platform": "ios"}))
        assert doc is not None, "push_tokens entry not persisted"
        assert doc["device_token"] == body["device_token"]
        assert doc["last_register_ok"] is False

    def test_register_push_user_id_mismatch_403(self, session, demo_token):
        body = {
            "user_id": "usr_NOT_ME",
            "platform": "android",
            "device_token": "TEST_TOKEN_mismatch",
        }
        r = session.post(f"{API}/register-push", headers=_auth(demo_token), json=body)
        assert r.status_code == 403, r.text

    def test_register_push_requires_auth(self, session, demo_user):
        body = {
            "user_id": demo_user["user_id"],
            "platform": "ios",
            "device_token": "TEST_TOKEN_noauth",
        }
        r = session.post(f"{API}/register-push", json=body)
        assert r.status_code in (401, 403), r.text


# ---------------- /api/friends/request → notifications ---------------- #


class TestFriendRequestNotification:
    def test_request_creates_friend_request_notification(
        self, session, demo_token, demo_user, peer_user, db
    ):
        # Clean any prior friendship between demo & peer (safety)
        _run(db.friendships.delete_many({
            "$or": [
                {"from_user_id": demo_user["user_id"], "to_user_id": peer_user["user"]["user_id"]},
                {"from_user_id": peer_user["user"]["user_id"], "to_user_id": demo_user["user_id"]},
            ]
        }))

        r = session.post(
            f"{API}/friends/request",
            headers=_auth(demo_token),
            json={"target_user_id": peer_user["user"]["user_id"]},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # notifications doc inserted for target
        notif = _run(db.notifications.find_one({
            "user_id": peer_user["user"]["user_id"],
            "type": "friend_request",
        }, sort=[("created_at", -1)]))
        assert notif is not None, "friend_request notification not created"
        assert notif["data"]["from_user_id"] == demo_user["user_id"]
        assert "friendship_id" in notif["data"]

        # Endpoint must succeed even though upstream push relay returns 401
        # (push_service.send_push returns False but never raises)


# ---------------- /api/friends/{id}/accept → notifications ---------------- #


class TestFriendAcceptNotification:
    @pytest.fixture(scope="class")
    def friendship_id(self, session, demo_user, peer_user, db):
        """Find the pending friendship_id between demo and peer."""
        fs = _run(db.friendships.find_one({
            "from_user_id": demo_user["user_id"],
            "to_user_id": peer_user["user"]["user_id"],
            "status": "pending",
        }))
        assert fs is not None, "pending friendship not found — friend_request test should run first"
        return fs["friendship_id"]

    def test_accept_creates_friend_accepted_notification(
        self, session, peer_user, demo_user, db, friendship_id
    ):
        r = session.post(
            f"{API}/friends/{friendship_id}/accept",
            headers=_auth(peer_user["token"]),
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        notif = _run(db.notifications.find_one({
            "user_id": demo_user["user_id"],
            "type": "friend_accepted",
        }, sort=[("created_at", -1)]))
        assert notif is not None, "friend_accepted notification not created"
        assert notif["data"]["friend_user_id"] == peer_user["user"]["user_id"]


# ---------------- /api/checkins (confirmed=true) → friend_at_club ---------------- #


class TestCheckinFriendAtClubNotification:
    @pytest.fixture(scope="class")
    def a_club_id(self, session) -> str:
        r = session.get(f"{API}/clubs", params={"limit": 1})
        assert r.status_code == 200, r.text
        items = r.json()
        assert items, "no clubs available in fixtures"
        return items[0]["club_id"]

    def _ensure_visibility(self, session, token, value):
        r = session.put(
            f"{API}/profile/visibility",
            headers=_auth(token),
            json={"visibility": value},
        )
        assert r.status_code == 200, r.text

    def test_checkin_notifies_visible_friend(
        self, session, demo_token, demo_user, peer_user, a_club_id, db
    ):
        # Force both users to "clubs_only" (default but be explicit)
        self._ensure_visibility(session, demo_token, "clubs_only")
        self._ensure_visibility(session, peer_user["token"], "clubs_only")

        before_count = _run(db.notifications.count_documents({
            "user_id": peer_user["user"]["user_id"],
            "type": "friend_at_club",
        }))

        r = session.post(
            f"{API}/checkins",
            headers=_auth(demo_token),
            json={"club_id": a_club_id, "confirmed": True},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["confirmed"] is True

        after_count = _run(db.notifications.count_documents({
            "user_id": peer_user["user"]["user_id"],
            "type": "friend_at_club",
        }))
        assert after_count == before_count + 1, (
            f"friend_at_club notif not delivered to peer (before={before_count} after={after_count})"
        )

        latest = _run(db.notifications.find_one({
            "user_id": peer_user["user"]["user_id"],
            "type": "friend_at_club",
        }, sort=[("created_at", -1)]))
        assert latest["data"]["friend_user_id"] == demo_user["user_id"]
        assert latest["data"]["club_id"] == a_club_id

    def test_hidden_sender_does_not_notify_friends(
        self, session, demo_token, demo_user, peer_user, a_club_id, db
    ):
        # Set demo to hidden → no friend_at_club notif should be created
        self._ensure_visibility(session, demo_token, "hidden")
        self._ensure_visibility(session, peer_user["token"], "clubs_only")

        before_count = _run(db.notifications.count_documents({
            "user_id": peer_user["user"]["user_id"],
            "type": "friend_at_club",
        }))

        r = session.post(
            f"{API}/checkins",
            headers=_auth(demo_token),
            json={"club_id": a_club_id, "confirmed": True},
        )
        # Endpoint must still succeed
        assert r.status_code == 200, r.text

        after_count = _run(db.notifications.count_documents({
            "user_id": peer_user["user"]["user_id"],
            "type": "friend_at_club",
        }))
        assert after_count == before_count, (
            "PRIVACY VIOLATION: hidden sender produced friend_at_club notification "
            f"(before={before_count} after={after_count})"
        )

        # Reset visibility to a safe default for subsequent runs
        self._ensure_visibility(session, demo_token, "clubs_only")

    def test_hidden_friend_does_not_receive_notification(
        self, session, demo_token, demo_user, peer_user, a_club_id, db
    ):
        # Sender visible, recipient hidden → recipient must NOT receive
        self._ensure_visibility(session, demo_token, "clubs_only")
        self._ensure_visibility(session, peer_user["token"], "hidden")

        before_count = _run(db.notifications.count_documents({
            "user_id": peer_user["user"]["user_id"],
            "type": "friend_at_club",
        }))

        r = session.post(
            f"{API}/checkins",
            headers=_auth(demo_token),
            json={"club_id": a_club_id, "confirmed": True},
        )
        assert r.status_code == 200, r.text

        after_count = _run(db.notifications.count_documents({
            "user_id": peer_user["user"]["user_id"],
            "type": "friend_at_club",
        }))
        assert after_count == before_count, (
            "PRIVACY VIOLATION: hidden recipient received friend_at_club notification "
            f"(before={before_count} after={after_count})"
        )

        # Reset for cleanliness
        self._ensure_visibility(session, peer_user["token"], "clubs_only")


# ---------------- Cleanup ---------------- #


def teardown_module(module):
    """Best-effort cleanup of transient test artifacts (notifications + push_tokens)."""
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import load_dotenv
        from pathlib import Path
        load_dotenv(Path("/app/backend/.env"))
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        d = cli[os.environ.get("DB_NAME", "night_finder")]
        loop = asyncio.new_event_loop()
        loop.run_until_complete(d.push_tokens.delete_many({"device_token": {"$regex": "^TEST_TOKEN_"}}))
        loop.close()
    except Exception:
        pass
