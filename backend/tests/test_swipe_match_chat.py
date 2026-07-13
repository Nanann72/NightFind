"""Night Finder — Session A.2 + B + C tests:
   Auth/register with dob, Swipe deck/quota/like/pass with daily limit,
   Match requests accept/reject, Matches + Chat with cross-user security.

   Run: pytest /app/backend/tests/test_swipe_match_chat.py -v
"""
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@nightfinder.app"
DEMO_PASS = "demo1234"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "night_finder")


# ---------------- Helpers / fixtures ---------------- #

def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _register(email, password="passw0rd!", name="Tester", dob="2000-05-15"):
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": password, "name": name, "dob": dob,
    })
    return r


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password})
    return r


@pytest.fixture(scope="session")
def mongo():
    client = AsyncIOMotorClient(MONGO_URL)
    return client[DB_NAME]


@pytest.fixture(scope="session")
def demo_token():
    r = _login(DEMO_EMAIL, DEMO_PASS)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def demo_user_id(demo_token):
    r = requests.get(f"{API}/auth/me", headers=_h(demo_token))
    assert r.status_code == 200
    return r.json()["user_id"]


@pytest.fixture(scope="session")
def fresh_user_a():
    email = f"test_a_{uuid.uuid4().hex[:6]}@nightfinder.app"
    r = _register(email, name="Alice T")
    assert r.status_code == 200, r.text
    body = r.json()
    return {"email": email, "password": "passw0rd!", "token": body["token"],
            "user_id": body["user"]["user_id"]}


@pytest.fixture(scope="session")
def fresh_user_b():
    email = f"test_b_{uuid.uuid4().hex[:6]}@nightfinder.app"
    r = _register(email, name="Bob T")
    assert r.status_code == 200, r.text
    body = r.json()
    return {"email": email, "password": "passw0rd!", "token": body["token"],
            "user_id": body["user"]["user_id"]}


@pytest.fixture(scope="session")
def fresh_user_c():
    email = f"test_c_{uuid.uuid4().hex[:6]}@nightfinder.app"
    r = _register(email, name="Carl T")
    assert r.status_code == 200, r.text
    body = r.json()
    return {"email": email, "password": "passw0rd!", "token": body["token"],
            "user_id": body["user"]["user_id"]}


# ==================== Auth / Register ==================== #

class TestAuthRegister:
    def test_existing_demo_login(self, demo_token):
        assert isinstance(demo_token, str) and len(demo_token) > 20

    def test_register_without_dob_returns_422(self):
        email = f"test_nodob_{uuid.uuid4().hex[:6]}@nightfinder.app"
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "passw0rd!", "name": "NoDob"})
        assert r.status_code == 422, f"expected 422, got {r.status_code} body={r.text}"

    def test_register_dob_under_18_returns_400(self):
        email = f"test_minor_{uuid.uuid4().hex[:6]}@nightfinder.app"
        # 10 years old
        today = datetime.now(timezone.utc).date()
        dob = today.replace(year=today.year - 10).isoformat()
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "passw0rd!", "name": "Minor", "dob": dob,
        })
        assert r.status_code == 400
        assert "18" in r.text

    def test_register_invalid_dob_format_returns_400(self):
        email = f"test_baddob_{uuid.uuid4().hex[:6]}@nightfinder.app"
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "passw0rd!", "name": "BadDob", "dob": "15/05/2000",
        })
        assert r.status_code == 400

    def test_register_valid_dob_returns_200(self):
        email = f"test_valid_{uuid.uuid4().hex[:6]}@nightfinder.app"
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "passw0rd!", "name": "Valid", "dob": "1995-06-01",
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert "token" in body and "user" in body
        assert body["user"]["email"] == email.lower()


# ==================== Swipe deck / quota (premium) ==================== #

class TestSwipeDeckQuotaPremium:
    def test_quota_premium_unlimited(self, demo_token, mongo):
        r = requests.get(f"{API}/swipe/quota", headers=_h(demo_token))
        assert r.status_code == 200
        data = r.json()
        assert data["is_premium"] is True
        assert data["limit"] is None
        assert data["remaining"] is None
        assert isinstance(data["used_today"], int)

    def test_deck_returns_profiles_excluding_self(self, demo_token, demo_user_id):
        r = requests.get(f"{API}/swipe/deck", headers=_h(demo_token))
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) <= 10
        # never include self
        assert all(p["user_id"] != demo_user_id for p in data)
        # all have photos + age (so dob exists)
        for p in data:
            assert p.get("photos") and len(p["photos"]) >= 1
            assert p.get("age") is not None

    def test_deck_excludes_hidden_user(self, demo_token, fresh_user_a, mongo):
        # Make user A 'swipeable': add photo + dob
        requests.put(f"{API}/profile/swipe-fields", headers=_h(fresh_user_a["token"]),
                     json={"photos": ["aGVsbG8="], "dob": "1996-01-01"})
        # Set A.visibility = hidden via API
        requests.put(f"{API}/profile/visibility", headers=_h(fresh_user_a["token"]),
                     json={"visibility": "hidden"})
        r = requests.get(f"{API}/swipe/deck", headers=_h(demo_token))
        assert r.status_code == 200
        ids = [p["user_id"] for p in r.json()]
        assert fresh_user_a["user_id"] not in ids
        # restore visibility for downstream tests
        requests.put(f"{API}/profile/visibility", headers=_h(fresh_user_a["token"]),
                     json={"visibility": "clubs_only"})

    def test_deck_excludes_profile_without_photos(self, demo_token, fresh_user_b):
        # B currently has no photos -> must not appear
        r = requests.get(f"{API}/swipe/deck", headers=_h(demo_token))
        ids = [p["user_id"] for p in r.json()]
        assert fresh_user_b["user_id"] not in ids


# ==================== Swipe like/pass / match requests ==================== #

class TestSwipeLikePass:
    def test_like_creates_match_request_and_notification(self, demo_token, demo_user_id,
                                                          fresh_user_c, mongo):
        # Make C swipeable
        requests.put(f"{API}/profile/swipe-fields", headers=_h(fresh_user_c["token"]),
                     json={"photos": ["aGVsbG8="], "dob": "1997-03-03"})
        # demo likes C
        r = requests.post(f"{API}/swipe/like", headers=_h(demo_token),
                          json={"target_user_id": fresh_user_c["user_id"]})
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Verify match_request exists in DB
        import asyncio
        async def check():
            mr = await mongo.match_requests.find_one(
                {"from_user_id": demo_user_id, "to_user_id": fresh_user_c["user_id"]}, {"_id": 0}
            )
            assert mr is not None
            assert mr["status"] == "pending"
            # user_swipes row
            us = await mongo.user_swipes.find_one(
                {"user_id": demo_user_id, "target_user_id": fresh_user_c["user_id"]}, {"_id": 0}
            )
            assert us is not None and us["action"] == "like"
            # notification for C
            notif = await mongo.notifications.find_one(
                {"user_id": fresh_user_c["user_id"], "type": "match_request"}, {"_id": 0}
            )
            assert notif is not None
            return mr["request_id"]
        rid = asyncio.get_event_loop().run_until_complete(check())
        assert rid.startswith("mr_")

    def test_like_idempotent(self, demo_token, fresh_user_c):
        r = requests.post(f"{API}/swipe/like", headers=_h(demo_token),
                          json={"target_user_id": fresh_user_c["user_id"]})
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True
        assert body.get("already_swiped") is True

    def test_pass_does_not_create_match_request(self, demo_token, demo_user_id, mongo):
        # Create a fresh target
        email = f"test_pass_{uuid.uuid4().hex[:6]}@nightfinder.app"
        r = _register(email)
        target = r.json()["user"]
        requests.put(f"{API}/profile/swipe-fields", headers=_h(r.json()["token"]),
                     json={"photos": ["aGVsbG8="], "dob": "1998-02-02"})
        rp = requests.post(f"{API}/swipe/pass", headers=_h(""), json={"target_user_id": target["user_id"]})
        # missing auth → 401
        assert rp.status_code == 401

        # demo passes
        r2 = requests.post(f"{API}/swipe/pass", headers={"Authorization": f"Bearer {_login(DEMO_EMAIL, DEMO_PASS).json()['token']}", "Content-Type": "application/json"},
                           json={"target_user_id": target["user_id"]})
        assert r2.status_code == 200

        import asyncio
        async def check():
            mr = await mongo.match_requests.find_one(
                {"from_user_id": _login(DEMO_EMAIL, DEMO_PASS).json()["user"]["user_id"],
                 "to_user_id": target["user_id"]}
            )
            us = await mongo.user_swipes.find_one(
                {"target_user_id": target["user_id"], "action": "pass"}, {"_id": 0}
            )
            return mr, us
        mr, us = asyncio.get_event_loop().run_until_complete(check())
        assert mr is None, "pass should NOT create match_request"
        assert us is not None, "user_swipes row should exist for pass"

    def test_swipe_self_400(self, demo_token, demo_user_id):
        r = requests.post(f"{API}/swipe/like", headers=_h(demo_token),
                          json={"target_user_id": demo_user_id})
        assert r.status_code == 400


# ==================== Daily quota enforcement (non-premium) ==================== #

class TestDailyQuotaNonPremium:
    """Temporarily flip demo to non-premium, exhaust 10 swipes, verify 402 on 11th."""

    def test_non_premium_402_at_limit(self, demo_token, demo_user_id, mongo):
        import asyncio

        async def setup_non_premium_with_zero_today():
            # clear today's swipes for demo (reset counter)
            today_start = datetime.now(timezone.utc).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            await mongo.user_swipes.delete_many(
                {"user_id": demo_user_id, "created_at": {"$gte": today_start}}
            )
            await mongo.users.update_one(
                {"user_id": demo_user_id}, {"$set": {"is_premium": False}}
            )

        async def restore():
            await mongo.users.update_one(
                {"user_id": demo_user_id}, {"$set": {"is_premium": True}}
            )

        loop = asyncio.get_event_loop()
        loop.run_until_complete(setup_non_premium_with_zero_today())
        try:
            # Quota now starts at 0/10
            q = requests.get(f"{API}/swipe/quota", headers=_h(demo_token))
            qd = q.json()
            assert qd["is_premium"] is False
            assert qd["limit"] == 10
            assert qd["remaining"] == 10
            assert qd["used_today"] == 0

            # Create 10 fresh swipeable targets and like them
            target_ids = []
            for i in range(11):
                email = f"test_q_{uuid.uuid4().hex[:6]}@nightfinder.app"
                rr = _register(email, name=f"Target {i}")
                tok = rr.json()["token"]
                uid = rr.json()["user"]["user_id"]
                requests.put(f"{API}/profile/swipe-fields", headers=_h(tok),
                             json={"photos": ["aGVsbG8="], "dob": "1995-01-01"})
                target_ids.append(uid)

            # First 10 should succeed
            for i, tid in enumerate(target_ids[:10]):
                r = requests.post(f"{API}/swipe/like", headers=_h(demo_token),
                                  json={"target_user_id": tid})
                assert r.status_code == 200, f"swipe #{i} failed: {r.status_code} {r.text}"

            q2 = requests.get(f"{API}/swipe/quota", headers=_h(demo_token)).json()
            assert q2["used_today"] == 10
            assert q2["remaining"] == 0

            # 11th must 402
            r11 = requests.post(f"{API}/swipe/like", headers=_h(demo_token),
                                json={"target_user_id": target_ids[10]})
            assert r11.status_code == 402, f"expected 402, got {r11.status_code} {r11.text}"

            # Pass also blocked
            r11p = requests.post(f"{API}/swipe/pass", headers=_h(demo_token),
                                 json={"target_user_id": target_ids[10]})
            assert r11p.status_code == 402
        finally:
            loop.run_until_complete(restore())


# ==================== Match accept / reject + cross-user security ==================== #

class TestMatchAcceptReject:
    @pytest.fixture(scope="class")
    def setup_request(self, mongo):
        """A likes B → match request from A to B."""
        import asyncio
        ea = f"test_ma_a_{uuid.uuid4().hex[:6]}@nightfinder.app"
        eb = f"test_ma_b_{uuid.uuid4().hex[:6]}@nightfinder.app"
        ec = f"test_ma_c_{uuid.uuid4().hex[:6]}@nightfinder.app"
        ra = _register(ea, name="MA-Alice"); rb = _register(eb, name="MA-Bob"); rc = _register(ec, name="MA-Carl")
        a = ra.json(); b = rb.json(); c = rc.json()
        # make B + A swipeable
        for u in (a, b):
            requests.put(f"{API}/profile/swipe-fields", headers=_h(u["token"]),
                         json={"photos": ["aGVsbG8="], "dob": "1996-04-04"})
        # A likes B
        r = requests.post(f"{API}/swipe/like", headers=_h(a["token"]),
                          json={"target_user_id": b["user"]["user_id"]})
        assert r.status_code == 200

        # find request_id via API (B is recipient)
        rq = requests.get(f"{API}/match-requests", headers=_h(b["token"]))
        assert rq.status_code == 200
        reqs = rq.json()
        mine = [x for x in reqs if x["user_id"] == a["user"]["user_id"]]
        assert len(mine) == 1, f"expected 1 inbound request, got {reqs}"
        request_id = mine[0]["request_id"]
        return {"a": a, "b": b, "c": c, "request_id": request_id}

    def test_non_recipient_cannot_accept_returns_404(self, setup_request):
        # C tries to accept a request addressed to B
        c_tok = setup_request["c"]["token"]
        r = requests.post(f"{API}/match-requests/accept", headers=_h(c_tok),
                          json={"request_id": setup_request["request_id"]})
        assert r.status_code == 404

    def test_non_recipient_cannot_reject_returns_404(self, setup_request):
        c_tok = setup_request["c"]["token"]
        r = requests.post(f"{API}/match-requests/reject", headers=_h(c_tok),
                          json={"request_id": setup_request["request_id"]})
        assert r.status_code == 404

    def test_recipient_accept_creates_match(self, setup_request, mongo):
        b_tok = setup_request["b"]["token"]
        r = requests.post(f"{API}/match-requests/accept", headers=_h(b_tok),
                          json={"request_id": setup_request["request_id"]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["match_id"].startswith("mt_")

        # Both A and B should see the match
        ml_a = requests.get(f"{API}/matches", headers=_h(setup_request["a"]["token"])).json()
        ml_b = requests.get(f"{API}/matches", headers=_h(setup_request["b"]["token"])).json()
        ids_a = [m["match_id"] for m in ml_a]
        ids_b = [m["match_id"] for m in ml_b]
        assert body["match_id"] in ids_a
        assert body["match_id"] in ids_b

        # Sender (A) should have a match_accepted notification
        import asyncio
        async def check():
            n = await mongo.notifications.find_one(
                {"user_id": setup_request["a"]["user"]["user_id"], "type": "match_accepted"}, {"_id": 0}
            )
            return n
        n = asyncio.get_event_loop().run_until_complete(check())
        assert n is not None
        # save match id for chat tests
        setup_request["match_id"] = body["match_id"]

    def test_reject_flow_separate(self, mongo):
        """Build another A2→B2 request, B2 rejects it."""
        import asyncio
        ea = f"test_rej_a_{uuid.uuid4().hex[:6]}@nightfinder.app"
        eb = f"test_rej_b_{uuid.uuid4().hex[:6]}@nightfinder.app"
        ra = _register(ea); rb = _register(eb)
        a = ra.json(); b = rb.json()
        for u in (a, b):
            requests.put(f"{API}/profile/swipe-fields", headers=_h(u["token"]),
                         json={"photos": ["aGVsbG8="], "dob": "1995-05-05"})
        rs = requests.post(f"{API}/swipe/like", headers=_h(a["token"]),
                           json={"target_user_id": b["user"]["user_id"]})
        assert rs.status_code == 200
        reqs = requests.get(f"{API}/match-requests", headers=_h(b["token"])).json()
        req_id = next(x["request_id"] for x in reqs if x["user_id"] == a["user"]["user_id"])

        r = requests.post(f"{API}/match-requests/reject", headers=_h(b["token"]),
                          json={"request_id": req_id})
        assert r.status_code == 200

        # Second reject should 404
        r2 = requests.post(f"{API}/match-requests/reject", headers=_h(b["token"]),
                           json={"request_id": req_id})
        assert r2.status_code == 404


# ==================== Chat / messages ==================== #

class TestChat:
    @pytest.fixture(scope="class")
    def matched_pair(self):
        ea = f"test_ch_a_{uuid.uuid4().hex[:6]}@nightfinder.app"
        eb = f"test_ch_b_{uuid.uuid4().hex[:6]}@nightfinder.app"
        ec = f"test_ch_c_{uuid.uuid4().hex[:6]}@nightfinder.app"  # outsider
        ra = _register(ea, name="CH-Alice"); rb = _register(eb, name="CH-Bob"); rc = _register(ec, name="CH-Carl")
        a = ra.json(); b = rb.json(); c = rc.json()
        for u in (a, b):
            requests.put(f"{API}/profile/swipe-fields", headers=_h(u["token"]),
                         json={"photos": ["aGVsbG8="], "dob": "1994-04-04"})
        # A likes B; B accepts
        requests.post(f"{API}/swipe/like", headers=_h(a["token"]),
                      json={"target_user_id": b["user"]["user_id"]})
        reqs = requests.get(f"{API}/match-requests", headers=_h(b["token"])).json()
        req_id = next(x["request_id"] for x in reqs if x["user_id"] == a["user"]["user_id"])
        acc = requests.post(f"{API}/match-requests/accept", headers=_h(b["token"]),
                            json={"request_id": req_id}).json()
        return {"a": a, "b": b, "c": c, "match_id": acc["match_id"]}

    def test_send_and_list_message_between_participants(self, matched_pair):
        a = matched_pair["a"]; b = matched_pair["b"]; mid = matched_pair["match_id"]
        r = requests.post(f"{API}/matches/{mid}/messages", headers=_h(a["token"]),
                          json={"text": "Hello B!"})
        assert r.status_code == 201, r.text
        doc = r.json()
        assert doc["text"] == "Hello B!"
        assert "message_id" in doc

        # B can list it
        rlist = requests.get(f"{API}/matches/{mid}/messages", headers=_h(b["token"]))
        assert rlist.status_code == 200
        msgs = rlist.json()
        assert any(m["text"] == "Hello B!" for m in msgs)

    def test_message_validation_too_long(self, matched_pair):
        mid = matched_pair["match_id"]
        r = requests.post(f"{API}/matches/{mid}/messages", headers=_h(matched_pair["a"]["token"]),
                          json={"text": "x" * 1001})
        assert r.status_code == 400

    def test_message_validation_empty(self, matched_pair):
        mid = matched_pair["match_id"]
        r = requests.post(f"{API}/matches/{mid}/messages", headers=_h(matched_pair["a"]["token"]),
                          json={"text": "   "})
        assert r.status_code == 400

    def test_since_param_filters(self, matched_pair):
        mid = matched_pair["match_id"]
        a = matched_pair["a"]; b = matched_pair["b"]
        # Send first message and capture timestamp via list
        requests.post(f"{API}/matches/{mid}/messages", headers=_h(a["token"]),
                      json={"text": "msg-old"})
        msgs = requests.get(f"{API}/matches/{mid}/messages", headers=_h(b["token"])).json()
        latest_iso = msgs[-1]["created_at"]
        # Send a second
        requests.post(f"{API}/matches/{mid}/messages", headers=_h(b["token"]),
                      json={"text": "msg-new"})
        # since=latest_iso must return only the new one
        rr = requests.get(f"{API}/matches/{mid}/messages",
                          headers=_h(a["token"]), params={"since": latest_iso})
        assert rr.status_code == 200
        new_msgs = rr.json()
        texts = [m["text"] for m in new_msgs]
        assert "msg-new" in texts
        assert "msg-old" not in texts

    def test_outsider_cannot_list_messages_returns_404(self, matched_pair):
        mid = matched_pair["match_id"]
        r = requests.get(f"{API}/matches/{mid}/messages", headers=_h(matched_pair["c"]["token"]))
        assert r.status_code == 404

    def test_outsider_cannot_send_message_returns_404(self, matched_pair):
        mid = matched_pair["match_id"]
        r = requests.post(f"{API}/matches/{mid}/messages",
                          headers=_h(matched_pair["c"]["token"]),
                          json={"text": "I shouldn't be here"})
        assert r.status_code == 404

    def test_invalid_match_id_returns_404(self, matched_pair):
        r = requests.get(f"{API}/matches/mt_doesnotexist/messages",
                         headers=_h(matched_pair["a"]["token"]))
        assert r.status_code == 404


# ==================== Profile swipe-fields validation ==================== #

class TestProfileSwipeFields:
    @pytest.fixture(scope="class")
    def tok(self):
        email = f"test_pf_{uuid.uuid4().hex[:6]}@nightfinder.app"
        r = _register(email, name="PF Tester")
        return r.json()["token"]

    def test_reject_dob_under_18(self, tok):
        today = datetime.now(timezone.utc).date()
        dob = today.replace(year=today.year - 10).isoformat()
        r = requests.put(f"{API}/profile/swipe-fields", headers=_h(tok), json={"dob": dob})
        assert r.status_code == 400

    def test_reject_invalid_dob_format(self, tok):
        r = requests.put(f"{API}/profile/swipe-fields", headers=_h(tok), json={"dob": "01-01-2000"})
        assert r.status_code == 400

    def test_reject_more_than_3_photos(self, tok):
        r = requests.put(f"{API}/profile/swipe-fields", headers=_h(tok),
                         json={"photos": ["a", "b", "c", "d"]})
        assert r.status_code == 400

    def test_reject_photo_over_2mb(self, tok):
        big = "a" * 3_000_001  # > 3,000,000 chars (the cap in code)
        r = requests.put(f"{API}/profile/swipe-fields", headers=_h(tok), json={"photos": [big]})
        assert r.status_code == 413

    def test_reject_bio_over_500(self, tok):
        r = requests.put(f"{API}/profile/swipe-fields", headers=_h(tok),
                         json={"bio": "x" * 501})
        assert r.status_code == 400

    def test_reject_invalid_instagram(self, tok):
        r = requests.put(f"{API}/profile/swipe-fields", headers=_h(tok),
                         json={"instagram": "bad handle!!"})
        assert r.status_code == 400
        r2 = requests.put(f"{API}/profile/swipe-fields", headers=_h(tok),
                          json={"instagram": "x" * 31})
        assert r2.status_code == 400

    def test_accept_valid_update(self, tok):
        r = requests.put(f"{API}/profile/swipe-fields", headers=_h(tok), json={
            "dob": "1995-06-15",
            "bio": "DnB & Techno",
            "city": "Paris",
            "instagram": "@valid.handle_1",  # leading @ should be stripped
            "photos": ["aGVsbG8="],
            "fav_clubs": ["club_xxx"],
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert set(body["updated"]) >= {"dob", "bio", "city", "instagram", "photos", "fav_clubs"}


# ==================== Cleanup ==================== #

def teardown_module(_):
    """Best-effort cleanup of test users and their swipe artifacts.
       Keeps demo and seed swipe profiles intact."""
    import asyncio
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    async def _clean():
        # Find test_* users
        cur = db.users.find({"email": {"$regex": "^test_.+@nightfinder.app$"}}, {"user_id": 1})
        ids = [u["user_id"] async for u in cur]
        if ids:
            await db.user_swipes.delete_many(
                {"$or": [{"user_id": {"$in": ids}}, {"target_user_id": {"$in": ids}}]}
            )
            await db.match_requests.delete_many(
                {"$or": [{"from_user_id": {"$in": ids}}, {"to_user_id": {"$in": ids}}]}
            )
            await db.matches.delete_many(
                {"$or": [{"user_a": {"$in": ids}}, {"user_b": {"$in": ids}}]}
            )
            await db.messages.delete_many({"from_user_id": {"$in": ids}})
            await db.notifications.delete_many({"user_id": {"$in": ids}})
            await db.users.delete_many({"user_id": {"$in": ids}})

        # Restore demo state: is_premium=true, visibility=clubs_only
        await db.users.update_one(
            {"email": DEMO_EMAIL},
            {"$set": {"is_premium": True, "visibility": "clubs_only"}},
        )
        # Reset demo's swipe activity from today on seed targets (so the deck isn't drained)
        # but keep persistent artifacts minimal
    asyncio.get_event_loop().run_until_complete(_clean())
    client.close()
