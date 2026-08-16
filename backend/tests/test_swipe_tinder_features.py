"""Tests for Tinder-like swipe features (iter 39):

- GET /api/me/profile-completion → {percent, missing[]}
- GET /api/swipe/quota → likes_given_7d, activity_boost_target, activity_boost_active, profile_completion
- GET /api/swipe/deck → excludes already-swiped users, self, virtuals
- Deck sort: activity_boost (>=10 likes 7d) then profile completion
- GET /api/swipe/likes-hub → likes/superlikes/requests (with request_id), counts
- Like-back flow via likes-hub → creates match, removes from hub
- Idempotency: self-like -> 400, double-like -> already_swiped
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fan-culture-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "night_finder")

REVIEWER_EMAIL = "apple.reviewer@nightfinder.app"
REVIEWER_PW = "Reviewer2026!"
LUCAS_EMAIL = "lucas.demo@nightfinder.app"
LUCAS_PW = "DemoOnly2026!"


# ---- helpers ----
def _login(email: str, password: str) -> tuple[str, dict]:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login {email} failed: {r.status_code} {r.text}"
    data = r.json()
    return data["token"], data["user"]


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def reviewer_ctx():
    token, user = _login(REVIEWER_EMAIL, REVIEWER_PW)
    return {"token": token, "user": user, "headers": _headers(token)}


@pytest.fixture(scope="module")
def lucas_ctx():
    token, user = _login(LUCAS_EMAIL, LUCAS_PW)
    return {"token": token, "user": user, "headers": _headers(token)}


# ---- Profile completion ----
class TestProfileCompletion:
    def test_reviewer_profile_completion(self, reviewer_ctx):
        r = requests.get(f"{API}/me/profile-completion", headers=reviewer_ctx["headers"], timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "percent" in data and "missing" in data
        assert isinstance(data["percent"], int)
        assert 0 <= data["percent"] <= 100
        assert isinstance(data["missing"], list)

    def test_completion_consistency_with_user_fields(self, reviewer_ctx, mongo):
        user = mongo.users.find_one({"user_id": reviewer_ctx["user"]["user_id"]})
        assert user is not None
        r = requests.get(f"{API}/me/profile-completion", headers=reviewer_ctx["headers"], timeout=10)
        data = r.json()
        # Recompute expected fields manually
        fields = [
            ("Ajoute une photo", 25, bool(user.get("photos"))),
            ("Ajoute 3 photos", 10, len(user.get("photos") or []) >= 3),
            ("Écris une bio", 20, bool((user.get("bio") or "").strip())),
            ("Renseigne ta date de naissance", 15, bool(user.get("dob"))),
            ("Indique ta ville", 10, bool((user.get("city") or "").strip())),
            ("Ajoute tes goûts musicaux", 10, bool(user.get("music_prefs"))),
            ("Lie ton Instagram", 5, bool((user.get("instagram") or "").strip())),
            ("Ajoute tes clubs favoris", 5, bool(user.get("fav_clubs"))),
        ]
        expected_percent = min(100, sum(p for _, p, ok in fields if ok))
        expected_missing = [lbl for lbl, _, ok in fields if not ok]
        assert data["percent"] == expected_percent, f"expected {expected_percent} got {data['percent']}"
        assert set(data["missing"]) == set(expected_missing)


# ---- Swipe quota ----
class TestSwipeQuota:
    def test_quota_fields_present(self, reviewer_ctx):
        r = requests.get(f"{API}/swipe/quota", headers=reviewer_ctx["headers"], timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in [
            "likes_given_7d",
            "activity_boost_target",
            "activity_boost_active",
            "profile_completion",
        ]:
            assert k in data, f"missing {k} in quota response"
        assert data["activity_boost_target"] == 10
        assert isinstance(data["likes_given_7d"], int)
        assert isinstance(data["activity_boost_active"], bool)
        assert 0 <= data["profile_completion"] <= 100
        # activity_boost_active must be consistent
        assert data["activity_boost_active"] == (data["likes_given_7d"] >= 10)


# ---- Swipe deck ----
class TestSwipeDeck:
    def test_deck_does_not_contain_self_or_virtuals(self, reviewer_ctx, mongo):
        r = requests.get(f"{API}/swipe/deck", headers=reviewer_ctx["headers"], timeout=15)
        assert r.status_code == 200, r.text
        deck = r.json()
        my_id = reviewer_ctx["user"]["user_id"]
        deck_ids = [p["user_id"] for p in deck]
        assert my_id not in deck_ids
        for uid in deck_ids:
            u = mongo.users.find_one({"user_id": uid}, {"is_virtual": 1})
            assert not (u and u.get("is_virtual") is True), f"virtual user {uid} in deck"

    def test_deck_excludes_already_swiped(self, reviewer_ctx, mongo):
        r = requests.get(f"{API}/swipe/deck", headers=reviewer_ctx["headers"], timeout=15)
        deck = r.json()
        my_id = reviewer_ctx["user"]["user_id"]
        deck_ids = {p["user_id"] for p in deck}
        already = set()
        for row in mongo.user_swipes.find({"user_id": my_id}, {"target_user_id": 1}):
            already.add(row["target_user_id"])
        overlap = deck_ids & already
        assert not overlap, f"Deck contains already-swiped users: {overlap}"


# ---- Deck sorting: activity boost ----
class TestDeckSortActivityBoost:
    """Seed 10 like-swipes from a target candidate to trigger activity boost,
    verify that candidate is ranked higher than the non-boosted ones.

    Uses fresh test users so we don't pollute reviewer's real swipes.
    """

    @pytest.fixture(scope="class")
    def viewer_ctx(self, mongo):
        # Create a fresh viewer with 0 swipes
        email = f"TEST_viewer_{uuid.uuid4().hex[:6]}@nightfinder.app"
        r = requests.post(
            f"{API}/auth/register",
            json={"email": email, "password": "TestPw2026!", "name": "TEST Viewer", "dob": "1998-01-01"},
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        data = r.json()
        token = data["token"]
        uid = data["user"]["user_id"]
        # Make viewer profile complete enough so swipe endpoints work
        mongo.users.update_one(
            {"user_id": uid},
            {"$set": {
                "photos": ["https://picsum.photos/300/500"],
                "bio": "test bio",
                "dob": "1998-01-01",
                "city": "Paris",
                "gender": "male",
                "interested_in": ["male", "female"],
            }},
        )
        yield {"token": token, "user_id": uid, "headers": _headers(token), "email": email}
        # cleanup
        mongo.users.delete_one({"user_id": uid})
        mongo.user_swipes.delete_many({"$or": [{"user_id": uid}, {"target_user_id": uid}]})

    def test_activity_boost_ranks_above_non_boosted(self, viewer_ctx, mongo):
        # Pick two candidate users from the deck to boost / not boost
        r = requests.get(f"{API}/swipe/deck", headers=viewer_ctx["headers"], timeout=15)
        assert r.status_code == 200, r.text
        deck = r.json()
        if len(deck) < 2:
            pytest.skip(f"deck too small ({len(deck)}) to test sort")
        # Take a middle/bottom candidate to boost (so we can detect it moved up)
        boosted_candidate = deck[-1]
        boosted_id = boosted_candidate["user_id"]
        # Seed 10 likes given BY boosted_candidate in last 7 days
        # Use random dummy target ids (don't have to exist)
        now = datetime.now(timezone.utc)
        mongo.user_swipes.delete_many({"user_id": boosted_id, "target_user_id": {"$regex": "^TEST_boost_"}})
        docs = [
            {
                "swipe_id": f"sw_TEST_{uuid.uuid4().hex[:8]}",
                "user_id": boosted_id,
                "target_user_id": f"TEST_boost_{i}_{uuid.uuid4().hex[:6]}",
                "action": "like",
                "created_at": now - timedelta(hours=i),
            }
            for i in range(10)
        ]
        mongo.user_swipes.insert_many(docs)
        try:
            # Re-fetch deck: boosted must now be ranked BEFORE the previous "top" candidate at index 0
            r2 = requests.get(f"{API}/swipe/deck", headers=viewer_ctx["headers"], timeout=15)
            assert r2.status_code == 200
            deck2 = r2.json()
            deck2_ids = [p["user_id"] for p in deck2]
            assert boosted_id in deck2_ids, "boosted candidate disappeared from deck"
            new_rank = deck2_ids.index(boosted_id)
            old_rank = len(deck) - 1
            # boosted candidate should now be ranked higher (smaller index)
            assert new_rank < old_rank, (
                f"boosted candidate {boosted_id} did not move up: old={old_rank} new={new_rank} "
                f"deck2_ids={deck2_ids}"
            )
        finally:
            mongo.user_swipes.delete_many({"user_id": boosted_id, "target_user_id": {"$regex": "^TEST_boost_"}})


# ---- Like flow: no duplicate, no self ----
class TestLikeIdempotencyAndSelf:
    def test_self_like_rejected(self, reviewer_ctx):
        my_id = reviewer_ctx["user"]["user_id"]
        r = requests.post(
            f"{API}/swipe/like",
            headers=reviewer_ctx["headers"],
            json={"target_user_id": my_id},
            timeout=10,
        )
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text}"

    def test_double_like_no_duplicate(self, mongo):
        # Create a throwaway viewer to swipe on a fresh target
        email_v = f"TEST_v_{uuid.uuid4().hex[:6]}@nightfinder.app"
        email_t = f"TEST_t_{uuid.uuid4().hex[:6]}@nightfinder.app"
        rv = requests.post(f"{API}/auth/register", json={"email": email_v, "password": "TestPw2026!", "name": "TEST V", "dob": "1998-01-01"}, timeout=15)
        rt = requests.post(f"{API}/auth/register", json={"email": email_t, "password": "TestPw2026!", "name": "TEST T", "dob": "1998-01-01"}, timeout=15)
        assert rv.status_code in (200, 201) and rt.status_code in (200, 201)
        tok_v = rv.json()["token"]
        uid_v = rv.json()["user"]["user_id"]
        uid_t = rt.json()["user"]["user_id"]
        # Make target visible enough
        mongo.users.update_one({"user_id": uid_t}, {"$set": {"photos": ["https://picsum.photos/300/500"], "bio": "b", "dob": "1998-01-01", "city": "Paris"}})
        try:
            r1 = requests.post(f"{API}/swipe/like", headers=_headers(tok_v), json={"target_user_id": uid_t}, timeout=10)
            assert r1.status_code == 200, r1.text
            r2 = requests.post(f"{API}/swipe/like", headers=_headers(tok_v), json={"target_user_id": uid_t}, timeout=10)
            assert r2.status_code == 200, r2.text
            data2 = r2.json()
            assert data2.get("already_swiped") is True, f"expected already_swiped on 2nd like: {data2}"
            count = mongo.user_swipes.count_documents({"user_id": uid_v, "target_user_id": uid_t})
            assert count == 1, f"expected 1 swipe row, got {count}"
        finally:
            mongo.users.delete_many({"user_id": {"$in": [uid_v, uid_t]}})
            mongo.user_swipes.delete_many({"$or": [{"user_id": uid_v}, {"target_user_id": uid_t}]})
            mongo.match_requests.delete_many({"from_user_id": uid_v})


# ---- Likes hub ----
class TestLikesHub:
    def test_likes_hub_shape(self, reviewer_ctx):
        r = requests.get(f"{API}/swipe/likes-hub", headers=reviewer_ctx["headers"], timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ["likes", "superlikes", "requests", "likes_count", "superlikes_count"]:
            assert k in data, f"missing {k}"
        assert isinstance(data["likes"], list)
        assert isinstance(data["superlikes"], list)
        assert isinstance(data["requests"], list)
        assert data["likes_count"] == len(data["likes"])
        assert data["superlikes_count"] == len(data["superlikes"])
        for req in data["requests"]:
            assert "request_id" in req, f"request missing request_id: {req}"

    def test_hub_excludes_users_i_swiped(self, reviewer_ctx, mongo):
        me = reviewer_ctx["user"]["user_id"]
        r = requests.get(f"{API}/swipe/likes-hub", headers=reviewer_ctx["headers"], timeout=10)
        data = r.json()
        hub_ids = {p["user_id"] for p in data["likes"]} | {p["user_id"] for p in data["superlikes"]}
        my_swipes = {row["target_user_id"] for row in mongo.user_swipes.find({"user_id": me}, {"target_user_id": 1})}
        overlap = hub_ids & my_swipes
        assert not overlap, f"users I already swiped still in hub: {overlap}"

    def test_like_back_creates_match_and_removes_from_hub(self, mongo):
        # Create two fresh users; user_liker likes user_me; user_me likes back → match
        email_liker = f"TEST_liker_{uuid.uuid4().hex[:6]}@nightfinder.app"
        email_me = f"TEST_me_{uuid.uuid4().hex[:6]}@nightfinder.app"
        r_liker = requests.post(f"{API}/auth/register", json={"email": email_liker, "password": "TestPw2026!", "name": "TEST Liker", "dob": "1998-01-01"}, timeout=15)
        r_me = requests.post(f"{API}/auth/register", json={"email": email_me, "password": "TestPw2026!", "name": "TEST Me", "dob": "1998-01-01"}, timeout=15)
        assert r_liker.status_code in (200, 201) and r_me.status_code in (200, 201)
        tok_liker = r_liker.json()["token"]
        tok_me = r_me.json()["token"]
        uid_liker = r_liker.json()["user"]["user_id"]
        uid_me = r_me.json()["user"]["user_id"]
        # Ensure both profiles are visible
        mongo.users.update_many(
            {"user_id": {"$in": [uid_liker, uid_me]}},
            {"$set": {"photos": ["https://picsum.photos/300/500"], "bio": "test", "dob": "1998-01-01", "city": "Paris"}},
        )
        try:
            # liker likes me
            r1 = requests.post(f"{API}/swipe/like", headers=_headers(tok_liker), json={"target_user_id": uid_me}, timeout=10)
            assert r1.status_code == 200, r1.text
            # Check likes-hub for `me` contains liker
            r2 = requests.get(f"{API}/swipe/likes-hub", headers=_headers(tok_me), timeout=10)
            assert r2.status_code == 200
            hub = r2.json()
            hub_ids = {p["user_id"] for p in hub["likes"] + hub["superlikes"]}
            assert uid_liker in hub_ids, f"liker not in hub: {hub_ids}"
            # me likes back → should create a match
            r3 = requests.post(f"{API}/swipe/like", headers=_headers(tok_me), json={"target_user_id": uid_liker}, timeout=10)
            assert r3.status_code == 200, r3.text
            data3 = r3.json()
            assert data3.get("matched") is True, f"expected matched=True got {data3}"
            assert "match_id" in data3
            # DB check
            match_doc = mongo.matches.find_one({"match_id": data3["match_id"]})
            assert match_doc is not None, "match doc not persisted"
            # Reload hub → liker should no longer appear (already swiped or matched)
            r4 = requests.get(f"{API}/swipe/likes-hub", headers=_headers(tok_me), timeout=10)
            hub2 = r4.json()
            hub2_ids = {p["user_id"] for p in hub2["likes"] + hub2["superlikes"]}
            assert uid_liker not in hub2_ids, f"liker still in hub after match: {hub2_ids}"
        finally:
            mongo.users.delete_many({"user_id": {"$in": [uid_liker, uid_me]}})
            mongo.user_swipes.delete_many({"$or": [{"user_id": uid_liker}, {"user_id": uid_me}, {"target_user_id": uid_liker}, {"target_user_id": uid_me}]})
            mongo.match_requests.delete_many({"$or": [{"from_user_id": uid_liker}, {"from_user_id": uid_me}, {"to_user_id": uid_liker}, {"to_user_id": uid_me}]})
            mongo.matches.delete_many({"$or": [{"user_a": uid_liker}, {"user_b": uid_liker}, {"user_a": uid_me}, {"user_b": uid_me}]})
            mongo.notifications.delete_many({"user_id": {"$in": [uid_liker, uid_me]}})
