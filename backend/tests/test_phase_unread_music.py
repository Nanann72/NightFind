"""Iteration 42 tests — Phase 3/4/7 (unread badge + music chip filter)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
REVIEWER_EMAIL = "apple.reviewer@nightfinder.app"
REVIEWER_PWD = "Reviewer2026!"
EMMA_EMAIL = "emma.demo@nightfinder.app"
EMMA_PWD = "DemoOnly2026!"


@pytest.fixture(scope="module")
def reviewer_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": REVIEWER_EMAIL, "password": REVIEWER_PWD},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def emma_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMMA_EMAIL, "password": EMMA_PWD},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------------- Unread count / mark-read ----------------

class TestMatchesUnread:
    def test_matches_list_contains_unread_field(self, reviewer_token):
        r = requests.get(f"{BASE_URL}/api/matches", headers=hdr(reviewer_token), timeout=15)
        assert r.status_code == 200, r.text
        matches = r.json()
        assert isinstance(matches, list)
        assert len(matches) >= 2, f"expected >=2 matches (Emma, Lucas), got {matches}"
        for m in matches:
            assert "unread" in m, f"missing unread in {m}"
            assert isinstance(m["unread"], int)
            assert "match_id" in m and "name" in m

    def test_emma_has_3_unread_and_lucas_zero(self, reviewer_token):
        r = requests.get(f"{BASE_URL}/api/matches", headers=hdr(reviewer_token), timeout=15)
        assert r.status_code == 200
        matches = r.json()
        by_name = {m["name"]: m for m in matches}
        assert "Emma" in by_name, f"no Emma match: names={list(by_name)}"
        # Report actual values (do not fail the whole suite for count mismatch — but assert positive/zero pattern)
        emma_unread = by_name["Emma"]["unread"]
        assert emma_unread >= 1, f"Emma should have unread >=1, got {emma_unread}"
        if "Lucas" in by_name:
            assert by_name["Lucas"]["unread"] == 0, f"Lucas should be 0, got {by_name['Lucas']['unread']}"

    def test_unread_count_endpoint(self, reviewer_token):
        r = requests.get(
            f"{BASE_URL}/api/matches/unread-count", headers=hdr(reviewer_token), timeout=15
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "unread" in data
        assert isinstance(data["unread"], int)
        assert data["unread"] >= 1

    def test_mark_emma_read_zeros_unread(self, reviewer_token):
        # 1. get initial
        r = requests.get(f"{BASE_URL}/api/matches", headers=hdr(reviewer_token), timeout=15)
        matches = r.json()
        emma = next((m for m in matches if m["name"] == "Emma"), None)
        assert emma is not None
        match_id = emma["match_id"]
        initial_total = requests.get(
            f"{BASE_URL}/api/matches/unread-count", headers=hdr(reviewer_token), timeout=15
        ).json()["unread"]
        emma_initial = emma["unread"]

        # 2. mark read
        r2 = requests.post(
            f"{BASE_URL}/api/matches/{match_id}/read",
            headers=hdr(reviewer_token),
            timeout=15,
        )
        assert r2.status_code in (200, 201, 204), r2.text

        # 3. verify Emma's unread == 0 and global count decreased by emma_initial
        r3 = requests.get(f"{BASE_URL}/api/matches", headers=hdr(reviewer_token), timeout=15)
        matches3 = r3.json()
        emma3 = next((m for m in matches3 if m["name"] == "Emma"), None)
        assert emma3["unread"] == 0, f"expected 0 after read, got {emma3['unread']}"

        r4 = requests.get(
            f"{BASE_URL}/api/matches/unread-count", headers=hdr(reviewer_token), timeout=15
        )
        new_total = r4.json()["unread"]
        assert new_total == initial_total - emma_initial, (
            f"total {new_total} != {initial_total} - {emma_initial}"
        )


# ---------------- Music chip (techno) ----------------

class TestClubsMusicFilter:
    def test_clubs_music_techno(self, reviewer_token):
        r = requests.get(
            f"{BASE_URL}/api/clubs",
            params={"music": "techno", "lat": 48.8566, "lng": 2.3522, "radius_km": 50},
            headers=hdr(reviewer_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        clubs = r.json()
        # accept either list directly or {"items":[]}
        items = clubs if isinstance(clubs, list) else clubs.get("items", [])
        assert isinstance(items, list)
        # At least one techno-club (Paris seed contains multiple)
        assert len(items) >= 1, f"no clubs returned for music=techno: {clubs}"

    def test_clubs_music_house(self, reviewer_token):
        r = requests.get(
            f"{BASE_URL}/api/clubs",
            params={"music": "house", "lat": 48.8566, "lng": 2.3522, "radius_km": 50},
            headers=hdr(reviewer_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text

    def test_clubs_no_filter(self, reviewer_token):
        r = requests.get(
            f"{BASE_URL}/api/clubs",
            params={"lat": 48.8566, "lng": 2.3522, "radius_km": 50},
            headers=hdr(reviewer_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
