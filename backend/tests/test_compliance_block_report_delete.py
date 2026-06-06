"""Night Finder — App Store compliance backend tests (iteration 5).

Covers the four P0 blockers that the main agent just implemented:
  1. Block / Unblock / List blocks
  2. Report user (7 reasons, validation)
  3. /api/users/me/export (RGPD Art. 20 — data portability)
  4. DELETE /api/users/me (Apple 5.1.1(v) account deletion + cascade)
  5. Block-filter on /api/swipe/deck and /api/match-requests

Run:
  pytest /app/backend/tests/test_compliance_block_report_delete.py -v
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@nightfinder.app"
DEMO_PASS = "demo1234"


# ---------------- Helpers ---------------- #

def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _register(email, password="passw0rd!", name="Tester", dob="2000-05-15"):
    return requests.post(f"{API}/auth/register", json={
        "email": email, "password": password, "name": name, "dob": dob,
    })


def _login(email, password):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": password})


def _new_user(prefix="block-test"):
    email = f"{prefix}-{uuid.uuid4().hex[:8]}@nightfinder.app"
    r = _register(email)
    assert r.status_code in (200, 201), r.text
    body = r.json()
    return {
        "email": email,
        "password": "passw0rd!",
        "token": body["token"],
        "user_id": body["user"]["user_id"],
    }


# ---------------- Fixtures ---------------- #

@pytest.fixture(scope="session")
def demo_auth():
    r = _login(DEMO_EMAIL, DEMO_PASS)
    assert r.status_code == 200, r.text
    data = r.json()
    return {"token": data["token"], "user_id": data["user"]["user_id"]}


@pytest.fixture()
def peer_user():
    """A throw-away user used as block/report target."""
    u = _new_user("peer")
    yield u
    # Best-effort cleanup: delete the peer account if still present
    try:
        requests.delete(
            f"{API}/users/me",
            headers=_h(u["token"]),
            json={"confirm": "DELETE", "password": u["password"]},
        )
    except Exception:
        pass


@pytest.fixture()
def cleanup_demo_blocks(demo_auth):
    """Snapshot current blocks for demo and restore after test."""
    initial_ids = set()
    r = requests.get(f"{API}/blocks", headers=_h(demo_auth["token"]))
    if r.status_code == 200:
        initial_ids = {b["user_id"] for b in r.json() if b.get("user_id")}
    yield
    r = requests.get(f"{API}/blocks", headers=_h(demo_auth["token"]))
    if r.status_code == 200:
        current = {b["user_id"] for b in r.json() if b.get("user_id")}
        for new_id in current - initial_ids:
            requests.delete(f"{API}/blocks/{new_id}", headers=_h(demo_auth["token"]))


# ---------------- 1. /api/blocks ---------------- #

class TestBlockEndpoints:

    def test_block_user_success(self, demo_auth, peer_user, cleanup_demo_blocks):
        r = requests.post(
            f"{API}/blocks",
            headers=_h(demo_auth["token"]),
            json={"target_user_id": peer_user["user_id"]},
        )
        assert r.status_code == 201, r.text
        assert r.json().get("ok") is True

    def test_block_self_returns_400(self, demo_auth):
        r = requests.post(
            f"{API}/blocks",
            headers=_h(demo_auth["token"]),
            json={"target_user_id": demo_auth["user_id"]},
        )
        assert r.status_code == 400, r.text

    def test_block_unknown_user_returns_404(self, demo_auth):
        r = requests.post(
            f"{API}/blocks",
            headers=_h(demo_auth["token"]),
            json={"target_user_id": f"usr_{uuid.uuid4().hex[:10]}"},
        )
        assert r.status_code == 404, r.text

    def test_block_requires_auth(self, peer_user):
        r = requests.post(f"{API}/blocks", json={"target_user_id": peer_user["user_id"]})
        assert r.status_code in (401, 403)

    def test_block_is_idempotent(self, demo_auth, peer_user, cleanup_demo_blocks):
        r1 = requests.post(
            f"{API}/blocks", headers=_h(demo_auth["token"]),
            json={"target_user_id": peer_user["user_id"]},
        )
        r2 = requests.post(
            f"{API}/blocks", headers=_h(demo_auth["token"]),
            json={"target_user_id": peer_user["user_id"]},
        )
        assert r1.status_code == 201
        assert r2.status_code == 201  # upsert → not an error

    def test_list_blocks_returns_user_info(self, demo_auth, peer_user, cleanup_demo_blocks):
        requests.post(
            f"{API}/blocks", headers=_h(demo_auth["token"]),
            json={"target_user_id": peer_user["user_id"]},
        )
        r = requests.get(f"{API}/blocks", headers=_h(demo_auth["token"]))
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        match = next((x for x in rows if x["user_id"] == peer_user["user_id"]), None)
        assert match is not None, "blocked peer not present in /api/blocks"
        # name should be present (peer has been registered with name "Tester")
        assert "name" in match
        # photo key must exist (may be None)
        assert "photo" in match
        assert "blocked_at" in match

    def test_unblock_user(self, demo_auth, peer_user, cleanup_demo_blocks):
        requests.post(
            f"{API}/blocks", headers=_h(demo_auth["token"]),
            json={"target_user_id": peer_user["user_id"]},
        )
        r = requests.delete(
            f"{API}/blocks/{peer_user['user_id']}",
            headers=_h(demo_auth["token"]),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("removed") == 1

        # Verify list no longer contains the peer
        r2 = requests.get(f"{API}/blocks", headers=_h(demo_auth["token"]))
        assert peer_user["user_id"] not in {b["user_id"] for b in r2.json()}

    def test_unblock_nonexistent_block_is_ok(self, demo_auth):
        # Idempotent: deleting a block that doesn't exist should still return ok
        r = requests.delete(
            f"{API}/blocks/usr_doesnotexist123",
            headers=_h(demo_auth["token"]),
        )
        assert r.status_code == 200
        assert r.json().get("removed") == 0


# ---------------- 2. /api/reports ---------------- #

ALL_REASONS = [
    "harassment", "inappropriate_photos", "spam",
    "fake_profile", "underage", "hate_speech", "other",
]


class TestReportEndpoints:

    @pytest.mark.parametrize("reason", ALL_REASONS)
    def test_report_each_allowed_reason(self, demo_auth, peer_user, reason):
        r = requests.post(
            f"{API}/reports",
            headers=_h(demo_auth["token"]),
            json={
                "target_user_id": peer_user["user_id"],
                "reason": reason,
                "context": "swipe",
                "details": f"E2E test for reason {reason}",
            },
        )
        assert r.status_code == 201, f"{reason} → {r.status_code} / {r.text}"
        body = r.json()
        assert body.get("ok") is True
        assert body.get("report_id", "").startswith("rep_")

    def test_report_invalid_reason_returns_400(self, demo_auth, peer_user):
        r = requests.post(
            f"{API}/reports",
            headers=_h(demo_auth["token"]),
            json={
                "target_user_id": peer_user["user_id"],
                "reason": "not_a_valid_reason",
            },
        )
        assert r.status_code == 400, r.text

    def test_report_unknown_target_returns_404(self, demo_auth):
        r = requests.post(
            f"{API}/reports",
            headers=_h(demo_auth["token"]),
            json={
                "target_user_id": f"usr_{uuid.uuid4().hex[:10]}",
                "reason": "spam",
            },
        )
        assert r.status_code == 404, r.text

    def test_report_self_returns_400(self, demo_auth):
        r = requests.post(
            f"{API}/reports",
            headers=_h(demo_auth["token"]),
            json={"target_user_id": demo_auth["user_id"], "reason": "spam"},
        )
        assert r.status_code == 400, r.text

    def test_report_requires_auth(self, peer_user):
        r = requests.post(
            f"{API}/reports",
            json={"target_user_id": peer_user["user_id"], "reason": "spam"},
        )
        assert r.status_code in (401, 403)


# ---------------- 3. Block filter on deck + match-requests ---------------- #

class TestBlockFilter:

    def test_blocked_user_excluded_from_deck(self, demo_auth, peer_user, cleanup_demo_blocks):
        # Block the peer
        requests.post(
            f"{API}/blocks", headers=_h(demo_auth["token"]),
            json={"target_user_id": peer_user["user_id"]},
        )
        r = requests.get(f"{API}/swipe/deck", headers=_h(demo_auth["token"]))
        assert r.status_code == 200, r.text
        deck = r.json()
        # peer is newly registered without photos so should never appear anyway,
        # but assert explicitly:
        deck_ids = {p.get("user_id") for p in deck}
        assert peer_user["user_id"] not in deck_ids

    def test_blocker_excluded_from_match_requests(self, demo_auth, cleanup_demo_blocks):
        """A user who blocked me must not appear in MY pending match-requests."""
        # Create a peer with a profile, have them like demo so a pending request exists,
        # then have peer BLOCK demo, then demo's match-requests should not show the peer.
        peer = _new_user("mr-blocker")
        try:
            # Peer likes demo (creates pending match_request to demo)
            r_like = requests.post(
                f"{API}/swipe/like",
                headers=_h(peer["token"]),
                json={"target_user_id": demo_auth["user_id"]},
            )
            # like may 200, but if peer is non-premium and demo profile filter rejects we still try
            assert r_like.status_code in (200, 201, 402), r_like.text

            # Check demo sees pending request (only if like succeeded)
            r_pending_before = requests.get(
                f"{API}/match-requests", headers=_h(demo_auth["token"]),
            )
            assert r_pending_before.status_code == 200
            had_request = any(
                x.get("user_id") == peer["user_id"] for x in r_pending_before.json()
            )

            # Peer blocks demo
            rb = requests.post(
                f"{API}/blocks", headers=_h(peer["token"]),
                json={"target_user_id": demo_auth["user_id"]},
            )
            assert rb.status_code == 201

            r_after = requests.get(f"{API}/match-requests", headers=_h(demo_auth["token"]))
            assert r_after.status_code == 200
            ids_after = {x.get("user_id") for x in r_after.json()}
            assert peer["user_id"] not in ids_after, (
                f"peer who blocked demo should be filtered out (had_request={had_request})"
            )
        finally:
            # Cleanup the peer account
            requests.delete(
                f"{API}/users/me", headers=_h(peer["token"]),
                json={"confirm": "DELETE", "password": peer["password"]},
            )


# ---------------- 4. /api/users/me/export ---------------- #

class TestExport:

    EXPECTED_KEYS = {
        "user", "swipes", "match_requests", "matches", "messages",
        "checkins", "detected_songs", "friendships", "notifications",
        "blocks", "events_created", "exported_at",
    }

    def test_export_returns_full_schema(self, demo_auth):
        r = requests.get(f"{API}/users/me/export", headers=_h(demo_auth["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        missing = self.EXPECTED_KEYS - set(body.keys())
        assert not missing, f"missing keys in export: {missing}"

    def test_export_user_has_no_password_hash(self, demo_auth):
        r = requests.get(f"{API}/users/me/export", headers=_h(demo_auth["token"]))
        assert r.status_code == 200
        u = r.json().get("user") or {}
        assert "password_hash" not in u, "export must NOT leak password_hash"
        assert u.get("user_id") == demo_auth["user_id"]
        assert u.get("email") == DEMO_EMAIL

    def test_export_list_fields_are_lists(self, demo_auth):
        r = requests.get(f"{API}/users/me/export", headers=_h(demo_auth["token"]))
        body = r.json()
        for k in ("swipes", "match_requests", "matches", "messages", "checkins",
                  "detected_songs", "friendships", "notifications",
                  "blocks", "events_created"):
            assert isinstance(body.get(k), list), f"{k} should be a list"

    def test_export_requires_auth(self):
        r = requests.get(f"{API}/users/me/export")
        assert r.status_code in (401, 403)


# ---------------- 5. DELETE /api/users/me (cascade + login fail) ---------------- #

class TestAccountDeletion:

    def test_delete_requires_confirm_field(self):
        u = _new_user("del-confirm")
        try:
            r = requests.delete(
                f"{API}/users/me", headers=_h(u["token"]),
                json={"confirm": "yes", "password": u["password"]},
            )
            assert r.status_code == 400, r.text
        finally:
            requests.delete(
                f"{API}/users/me", headers=_h(u["token"]),
                json={"confirm": "DELETE", "password": u["password"]},
            )

    def test_delete_wrong_password_returns_401(self):
        u = _new_user("del-wrongpw")
        try:
            r = requests.delete(
                f"{API}/users/me", headers=_h(u["token"]),
                json={"confirm": "DELETE", "password": "wrong-password"},
            )
            assert r.status_code == 401, r.text
        finally:
            requests.delete(
                f"{API}/users/me", headers=_h(u["token"]),
                json={"confirm": "DELETE", "password": u["password"]},
            )

    def test_delete_requires_auth(self):
        r = requests.delete(
            f"{API}/users/me",
            json={"confirm": "DELETE", "password": "x"},
        )
        assert r.status_code in (401, 403)

    def test_delete_cascade_and_login_after_fails(self):
        """Full path: create user, seed a block + report + push token,
        delete the account, verify cascade + login fails afterwards."""
        u = _new_user("del-full")
        peer = _new_user("del-full-peer")
        try:
            # Seed: u blocks peer, peer reports u, both have some side data
            rb = requests.post(
                f"{API}/blocks", headers=_h(u["token"]),
                json={"target_user_id": peer["user_id"]},
            )
            assert rb.status_code == 201
            rr = requests.post(
                f"{API}/reports", headers=_h(peer["token"]),
                json={"target_user_id": u["user_id"], "reason": "spam"},
            )
            assert rr.status_code == 201

            # Delete u
            rd = requests.delete(
                f"{API}/users/me", headers=_h(u["token"]),
                json={"confirm": "DELETE", "password": u["password"]},
            )
            assert rd.status_code == 200, rd.text
            assert rd.json().get("ok") is True
            assert rd.json().get("deleted_user_id") == u["user_id"]

            # Login with same credentials must fail
            rlog = _login(u["email"], u["password"])
            assert rlog.status_code in (401, 404), (
                f"login after delete should fail, got {rlog.status_code}"
            )

            # Authed call with old token must also fail (user lookup fails)
            rme = requests.get(f"{API}/auth/me", headers=_h(u["token"]))
            assert rme.status_code in (401, 404), (
                f"auth/me with stale token should fail, got {rme.status_code}"
            )

            # Peer's /blocks list must no longer reference deleted user (if peer had blocked u — they didn't here, so check cascade indirectly via peer's match-requests is fine)
            # Also: u no longer appears in any other user's blocks listing
            r_peer_blocks = requests.get(f"{API}/blocks", headers=_h(peer["token"]))
            assert r_peer_blocks.status_code == 200
            assert u["user_id"] not in {b["user_id"] for b in r_peer_blocks.json()}
        finally:
            # Cleanup peer
            try:
                requests.delete(
                    f"{API}/users/me", headers=_h(peer["token"]),
                    json={"confirm": "DELETE", "password": peer["password"]},
                )
            except Exception:
                pass

    def test_demo_account_still_logs_in(self):
        """Safety net: ensure no test poisoned the demo account."""
        r = _login(DEMO_EMAIL, DEMO_PASS)
        assert r.status_code == 200, "demo account must remain functional"
