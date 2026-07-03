"""Backend tests — Instagram-style feed for Night Finder moments.

Endpoints under test:
- GET  /api/moments/feed        → list of active moments with likes/comments/liked_by_me/club_name
- GET  /api/moments/highlights  → grouped-by-user story bar with is_self flag
- POST /api/moments/{id}/like   → idempotent like
- DEL  /api/moments/{id}/like   → unlike
- GET  /api/moments/{id}/comments      → sorted ASC by created_at
- POST /api/moments/{id}/comments      → adds a comment (returns full comment)
- DEL  /api/moments/{id}/comments/{cid} → author-of-comment OR author-of-moment only

Preconditions (per review request): ~8 demo moments already seeded in
`club_moments` for users Chloé, Louis, Camille, Clara, Inès, Malo, Adam.
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

TIMEOUT = 15


def _rand_email() -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    return f"TEST_feed_{suffix}@example.com"


# ---------------- Fixtures ---------------- #


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    return data["token"]


@pytest.fixture(scope="module")
def admin_user_id(admin_token):
    r = requests.get(
        f"{BASE_URL}/api/auth/me",
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200
    return r.json()["user_id"]


def _register(name: str) -> dict:
    payload = {
        "name": name,
        "dob": "1998-05-12",
        "email": _rand_email(),
        "password": "TestPass2026!",
    }
    r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=TIMEOUT)
    assert r.status_code in (200, 201), f"Register failed: {r.status_code} {r.text}"
    data = r.json()
    return {
        "token": data["token"],
        "user_id": data["user"]["user_id"],
        "name": data["user"].get("name") or name,
        "email": payload["email"],
    }


@pytest.fixture(scope="module")
def userA():
    return _register("TEST Alice")


@pytest.fixture(scope="module")
def userB():
    return _register("TEST Bob")


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------- /moments/feed ---------------- #


class TestFeed:
    def test_feed_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/moments/feed", timeout=TIMEOUT)
        assert r.status_code in (401, 403)

    def test_feed_returns_moments(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/moments/feed?limit=30",
            headers=_auth(admin_token),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "moments" in body and "count" in body
        assert isinstance(body["moments"], list)
        assert body["count"] == len(body["moments"])
        # Precondition: 8 demo moments seeded
        assert body["count"] >= 1, (
            "Expected at least 1 seeded moment in club_moments"
        )

    def test_feed_moment_shape(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/moments/feed",
            headers=_auth(admin_token),
            timeout=TIMEOUT,
        )
        moments = r.json()["moments"]
        assert moments, "No moments returned"
        m = moments[0]
        required = {
            "moment_id", "user_id", "user_name",
            "created_at", "expires_at",
            "likes_count", "comments_count", "liked_by_me",
        }
        missing = required - set(m.keys())
        assert not missing, f"Feed moment missing fields: {missing} (got {list(m.keys())})"
        # club_name key must be present (can be null)
        assert "club_name" in m, "club_name key must be included (even if null)"
        assert isinstance(m["likes_count"], int)
        assert isinstance(m["comments_count"], int)
        assert isinstance(m["liked_by_me"], bool)
        # ObjectId leakage check
        assert "_id" not in m, "MongoDB _id must be excluded"

    def test_feed_sorted_newest_first(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/moments/feed",
            headers=_auth(admin_token),
            timeout=TIMEOUT,
        )
        created = [m["created_at"] for m in r.json()["moments"]]
        assert created == sorted(created, reverse=True), (
            "Feed must be sorted by created_at DESC"
        )

    def test_feed_only_active(self, admin_token):
        """No expired moment should be returned."""
        from datetime import datetime, timezone
        r = requests.get(
            f"{BASE_URL}/api/moments/feed",
            headers=_auth(admin_token),
            timeout=TIMEOUT,
        )
        now_iso = datetime.now(timezone.utc).isoformat()
        for m in r.json()["moments"]:
            # expires_at is ISO string; string compare is safe (ISO8601 lexicographic)
            assert m["expires_at"] > now_iso, (
                f"Expired moment {m['moment_id']} returned in feed (expires_at={m['expires_at']})"
            )


# ---------------- /moments/highlights ---------------- #


class TestHighlights:
    def test_highlights_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/moments/highlights", timeout=TIMEOUT)
        assert r.status_code in (401, 403)

    def test_highlights_shape(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/moments/highlights",
            headers=_auth(admin_token),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "highlights" in body and "count" in body
        assert body["count"] == len(body["highlights"])
        assert body["count"] >= 1, "Expected at least 1 highlight (8 seeded moments)"
        h = body["highlights"][0]
        for k in {"user_id", "user_name", "moment_id", "moments_count", "is_self"}:
            assert k in h, f"Highlight missing '{k}'"
        assert isinstance(h["is_self"], bool)
        assert isinstance(h["moments_count"], int)

    def test_highlights_grouped_by_user(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/moments/highlights",
            headers=_auth(admin_token),
            timeout=TIMEOUT,
        )
        highlights = r.json()["highlights"]
        user_ids = [h["user_id"] for h in highlights]
        assert len(user_ids) == len(set(user_ids)), (
            "Highlights must be grouped by user (one entry per user)"
        )

    def test_highlights_self_first_for_admin(self, admin_token, admin_user_id):
        """Admin has no active moment so is_self=false for all — but ordering
        rule is still verifiable: any is_self=true must be first."""
        r = requests.get(
            f"{BASE_URL}/api/moments/highlights",
            headers=_auth(admin_token),
            timeout=TIMEOUT,
        )
        highlights = r.json()["highlights"]
        # For admin (no moments), all should be is_self=false
        selves = [h for h in highlights if h.get("is_self")]
        assert not selves, (
            f"Admin has no moments — no highlight should have is_self=true, got {selves}"
        )
        # And admin should NOT appear as one of the users (no moments = not grouped)
        assert admin_user_id not in [h["user_id"] for h in highlights]

    def test_highlights_is_self_false_for_other_viewer(self, userA):
        """A fresh user with no moments — every highlight must have is_self=false."""
        r = requests.get(
            f"{BASE_URL}/api/moments/highlights",
            headers=_auth(userA["token"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        for h in r.json()["highlights"]:
            assert h["is_self"] is False, (
                f"Highlight for user {h['user_id']} should be is_self=false "
                f"when viewer is {userA['user_id']}"
            )


# ---------------- likes / comments ---------------- #


@pytest.fixture(scope="module")
def target_moment_id(admin_token):
    """Pick the first seeded moment from the feed to run like/comment tests against."""
    r = requests.get(
        f"{BASE_URL}/api/moments/feed",
        headers=_auth(admin_token),
        timeout=TIMEOUT,
    )
    moments = r.json()["moments"]
    assert moments, "No moment to run like/comment tests on"
    return moments[0]["moment_id"]


class TestLikes:
    def test_like_idempotent(self, userA, target_moment_id):
        # First call
        r1 = requests.post(
            f"{BASE_URL}/api/moments/{target_moment_id}/like",
            headers=_auth(userA["token"]),
            timeout=TIMEOUT,
        )
        assert r1.status_code == 200, r1.text
        c1 = r1.json()["likes_count"]
        assert r1.json()["liked_by_me"] is True
        # Second call → same count
        r2 = requests.post(
            f"{BASE_URL}/api/moments/{target_moment_id}/like",
            headers=_auth(userA["token"]),
            timeout=TIMEOUT,
        )
        assert r2.status_code == 200, r2.text
        c2 = r2.json()["likes_count"]
        assert c2 == c1, f"Like must be idempotent, got {c1} then {c2}"

    def test_like_reflected_in_feed(self, userA, target_moment_id):
        r = requests.get(
            f"{BASE_URL}/api/moments/feed",
            headers=_auth(userA["token"]),
            timeout=TIMEOUT,
        )
        m = next((x for x in r.json()["moments"] if x["moment_id"] == target_moment_id), None)
        assert m, "Target moment not in feed"
        assert m["liked_by_me"] is True, "liked_by_me must be true after POST like"
        assert m["likes_count"] >= 1

    def test_unlike_decrements(self, userA, target_moment_id):
        # First, ensure the like is present
        requests.post(
            f"{BASE_URL}/api/moments/{target_moment_id}/like",
            headers=_auth(userA["token"]),
            timeout=TIMEOUT,
        )
        before = requests.post(
            f"{BASE_URL}/api/moments/{target_moment_id}/like",
            headers=_auth(userA["token"]),
            timeout=TIMEOUT,
        ).json()["likes_count"]
        r = requests.delete(
            f"{BASE_URL}/api/moments/{target_moment_id}/like",
            headers=_auth(userA["token"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert r.json()["liked_by_me"] is False
        assert r.json()["likes_count"] == before - 1, (
            f"Unlike must decrement (before={before}, after={r.json()['likes_count']})"
        )

    def test_like_404_on_unknown_moment(self, userA):
        r = requests.post(
            f"{BASE_URL}/api/moments/mom_does_not_exist/like",
            headers=_auth(userA["token"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 404, f"Expected 404, got {r.status_code}"


class TestComments:
    def test_post_comment_returns_full(self, userA, target_moment_id):
        payload = {"text": "TEST comment from Alice"}
        r = requests.post(
            f"{BASE_URL}/api/moments/{target_moment_id}/comments",
            headers=_auth(userA["token"]),
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        c = r.json()
        for k in {"comment_id", "moment_id", "user_id", "user_name", "text", "created_at"}:
            assert k in c, f"Comment response missing '{k}'"
        assert c["text"] == payload["text"]
        assert c["user_id"] == userA["user_id"]
        assert "_id" not in c, "MongoDB _id must be excluded"
        # Persist ID for later tests via class attribute
        TestComments.cid_by_A = c["comment_id"]

    def test_list_comments_sorted_asc(self, userA, target_moment_id):
        # Add a second comment so we can verify ordering
        payload = {"text": "TEST second comment"}
        r2 = requests.post(
            f"{BASE_URL}/api/moments/{target_moment_id}/comments",
            headers=_auth(userA["token"]),
            json=payload,
            timeout=TIMEOUT,
        )
        assert r2.status_code == 200
        # Now list
        r = requests.get(
            f"{BASE_URL}/api/moments/{target_moment_id}/comments",
            headers=_auth(userA["token"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        comments = r.json()["comments"]
        assert len(comments) >= 2
        created = [c["created_at"] for c in comments]
        assert created == sorted(created), "Comments must be sorted ASC by created_at"

    def test_delete_comment_by_author(self, userA, target_moment_id):
        # Create a fresh comment and delete it by its author
        r = requests.post(
            f"{BASE_URL}/api/moments/{target_moment_id}/comments",
            headers=_auth(userA["token"]),
            json={"text": "TEST delete-by-author"},
            timeout=TIMEOUT,
        )
        cid = r.json()["comment_id"]
        d = requests.delete(
            f"{BASE_URL}/api/moments/{target_moment_id}/comments/{cid}",
            headers=_auth(userA["token"]),
            timeout=TIMEOUT,
        )
        assert d.status_code == 200, d.text
        # Verify removed
        listing = requests.get(
            f"{BASE_URL}/api/moments/{target_moment_id}/comments",
            headers=_auth(userA["token"]),
            timeout=TIMEOUT,
        ).json()["comments"]
        assert cid not in [c["comment_id"] for c in listing]

    def test_delete_comment_forbidden_for_other_user(self, userA, userB, target_moment_id):
        # A posts, B tries to delete → 403
        r = requests.post(
            f"{BASE_URL}/api/moments/{target_moment_id}/comments",
            headers=_auth(userA["token"]),
            json={"text": "TEST forbidden delete"},
            timeout=TIMEOUT,
        )
        cid = r.json()["comment_id"]
        d = requests.delete(
            f"{BASE_URL}/api/moments/{target_moment_id}/comments/{cid}",
            headers=_auth(userB["token"]),
            timeout=TIMEOUT,
        )
        assert d.status_code == 403, (
            f"Non-author non-moment-owner must get 403, got {d.status_code}: {d.text}"
        )
        # Cleanup: author deletes it
        requests.delete(
            f"{BASE_URL}/api/moments/{target_moment_id}/comments/{cid}",
            headers=_auth(userA["token"]),
            timeout=TIMEOUT,
        )

    def test_comment_text_validation(self, userA, target_moment_id):
        # Empty text should be rejected (Pydantic min_length=1)
        r = requests.post(
            f"{BASE_URL}/api/moments/{target_moment_id}/comments",
            headers=_auth(userA["token"]),
            json={"text": ""},
            timeout=TIMEOUT,
        )
        assert r.status_code in (400, 422), (
            f"Empty comment must be rejected, got {r.status_code}"
        )

    def test_post_comment_404_on_unknown_moment(self, userA):
        r = requests.post(
            f"{BASE_URL}/api/moments/mom_does_not_exist/comments",
            headers=_auth(userA["token"]),
            json={"text": "hey"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 404
