"""
Backend tests for Night Finder 3.0 engagement pulse endpoints.
- GET /api/activity/pulse (auth)  -> rotating engagement item (hot_club / new_user / people_tonight)
- GET /api/activity/live?club_ids=...  -> deterministic per-hour "people here" counters
"""

import os
import re
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

REVIEWER_EMAIL = "apple.reviewer@nightfinder.app"
REVIEWER_PASSWORD = "Reviewer2026!"

PARIS_LAT = 48.85
PARIS_LNG = 2.35

FORBIDDEN_NAME_RX = re.compile(r"test|admin|reviewer|demo", re.IGNORECASE)


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": REVIEWER_EMAIL, "password": REVIEWER_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ─── /api/activity/pulse ──────────────────────────────────────────────
class TestActivityPulse:
    def test_pulse_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/activity/pulse", timeout=15)
        assert r.status_code in (401, 403), r.text

    def test_pulse_shape_and_variety(self, auth_headers):
        seen_types = set()
        for _ in range(12):
            r = requests.get(
                f"{BASE_URL}/api/activity/pulse",
                params={"lat": PARIS_LAT, "lng": PARIS_LNG},
                headers=auth_headers,
                timeout=20,
            )
            assert r.status_code == 200, r.text
            data = r.json()
            for key in ("type", "emoji", "title", "body"):
                assert key in data and isinstance(data[key], str) and data[key], f"missing {key}: {data}"
            assert data["type"] in {"hot_club", "new_user", "people_tonight"}, data
            seen_types.add(data["type"])

            # new_user must never leak demo/test/admin/reviewer names
            if data["type"] == "new_user":
                assert not FORBIDDEN_NAME_RX.search(data["title"]), f"leaked test name: {data['title']}"

            # hot_club route sanity
            if data["type"] == "hot_club":
                assert data.get("route", "").startswith("/club/"), data

        # at least 2 distinct types should show up on 12 rolls (rotation working)
        assert len(seen_types) >= 2, f"pulse types not rotating: {seen_types}"

    def test_pulse_hot_club_route(self, auth_headers):
        found = False
        for _ in range(20):
            r = requests.get(
                f"{BASE_URL}/api/activity/pulse",
                params={"lat": PARIS_LAT, "lng": PARIS_LNG},
                headers=auth_headers,
                timeout=20,
            )
            assert r.status_code == 200
            d = r.json()
            if d["type"] == "hot_club":
                assert d["route"].startswith("/club/") and len(d["route"]) > len("/club/")
                assert "Ça bouge" in d["title"] or "bouge" in d["title"]
                found = True
                break
        assert found, "no hot_club pulse returned in 20 rolls"


# ─── /api/activity/live ──────────────────────────────────────────────
class TestActivityLive:
    @pytest.fixture(scope="class")
    def club_ids(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/clubs",
            params={"lat": PARIS_LAT, "lng": PARIS_LNG},
            headers=auth_headers,
            timeout=25,
        )
        assert r.status_code == 200, r.text
        clubs = r.json()
        assert isinstance(clubs, list) and len(clubs) >= 2, f"need >=2 clubs, got {len(clubs) if isinstance(clubs, list) else clubs}"
        ids = [c["club_id"] for c in clubs[:3]]
        assert all(isinstance(i, str) and i for i in ids)
        return ids

    def test_live_returns_counts(self, auth_headers, club_ids):
        r = requests.get(
            f"{BASE_URL}/api/activity/live",
            params={"club_ids": ",".join(club_ids)},
            headers=auth_headers,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "counts" in data and isinstance(data["counts"], dict)
        for cid in club_ids:
            assert cid in data["counts"], f"missing {cid} in counts"
            n = data["counts"][cid]
            assert isinstance(n, int) and n > 0, f"expected positive int for {cid}, got {n}"

    def test_live_deterministic_within_hour(self, auth_headers, club_ids):
        params = {"club_ids": ",".join(club_ids)}
        r1 = requests.get(f"{BASE_URL}/api/activity/live", params=params, headers=auth_headers, timeout=20)
        r2 = requests.get(f"{BASE_URL}/api/activity/live", params=params, headers=auth_headers, timeout=20)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json() == r2.json(), f"counts changed within same hour: {r1.json()} vs {r2.json()}"

    def test_live_requires_auth(self, club_ids):
        r = requests.get(
            f"{BASE_URL}/api/activity/live",
            params={"club_ids": ",".join(club_ids)},
            timeout=15,
        )
        assert r.status_code in (401, 403)
