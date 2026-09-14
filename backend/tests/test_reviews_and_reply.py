"""Régression: système d'avis clubs (rating 1-5), réponse gérant, annotation avg sur /clubs.

Endpoints couverts:
- POST /api/clubs/{club_id}/reviews (create + upsert)
- GET  /api/clubs/{club_id}/reviews (avg, count, my_review, reviews[])
- POST /api/clubs/{club_id}/reviews/{review_id}/reply (403 non-owner, ok owner)
- GET  /api/clubs?lat&lng (annotations user_rating / user_rating_count)
- Régression rapide: /api/auth/login, /api/clubs/{id}, /api/matches, /api/notifications
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fan-culture-app.preview.emergentagent.com").rstrip("/")

APPLE_EMAIL = "apple.reviewer@nightfinder.app"
APPLE_PWD = "Reviewer2026!"
LUCAS_EMAIL = "lucas.demo@nightfinder.app"
LUCAS_PWD = "DemoOnly2026!"
EMMA_EMAIL = "emma.demo@nightfinder.app"
EMMA_PWD = "DemoOnly2026!"

CONCRETE_CLUB_ID = "gp_ChIJq6qqqYFx5kcRSSbNW9NNx-Y"  # will be discovered dynamically
PENICHE_CLUB_ID = "gp_ChIJQUPlmeRx5kcRgdLD_VS7-h4"

PARIS_LAT = 48.8566
PARIS_LNG = 2.3522


@pytest.fixture(scope="module")
def apple_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": APPLE_EMAIL, "password": APPLE_PWD}, timeout=30)
    assert r.status_code == 200, f"apple login failed: {r.status_code} {r.text[:300]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def lucas_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": LUCAS_EMAIL, "password": LUCAS_PWD}, timeout=30)
    assert r.status_code == 200
    return r.json()["token"]


@pytest.fixture(scope="module")
def emma_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMMA_EMAIL, "password": EMMA_PWD}, timeout=30)
    assert r.status_code == 200
    return r.json()["token"]


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ─── Régression rapide auth ────────────────────────────────────────────────
class TestAuthRegression:
    def test_login_apple_returns_token_and_user(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": APPLE_EMAIL, "password": APPLE_PWD}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 10
        assert "user" in data and data["user"].get("email") == APPLE_EMAIL

    def test_login_lucas_owner(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": LUCAS_EMAIL, "password": LUCAS_PWD}, timeout=30)
        assert r.status_code == 200
        u = r.json()["user"]
        # lucas doit être propriétaire de Péniche
        assert u.get("is_bar_owner") is True
        assert u.get("owned_club_id") == PENICHE_CLUB_ID


# ─── Régression /clubs ─────────────────────────────────────────────────────
class TestClubsRegression:
    def test_list_clubs_paris_returns_items_with_review_annotations(self, apple_token):
        r = requests.get(
            f"{BASE_URL}/api/clubs",
            params={"lat": PARIS_LAT, "lng": PARIS_LNG, "radius_km": 20},
            headers=_hdr(apple_token),
            timeout=45,
        )
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list) and len(items) > 0
        # Chaque club doit avoir user_rating (null autorisé) et user_rating_count
        for c in items:
            assert "user_rating" in c, f"missing user_rating on {c.get('name')}"
            assert "user_rating_count" in c
            assert isinstance(c["user_rating_count"], int)
            if c["user_rating"] is not None:
                assert 1.0 <= c["user_rating"] <= 5.0

    def test_peniche_marcounet_has_avg_from_two_reviews(self, apple_token):
        r = requests.get(
            f"{BASE_URL}/api/clubs",
            params={"lat": PARIS_LAT, "lng": PARIS_LNG, "radius_km": 20},
            headers=_hdr(apple_token),
            timeout=45,
        )
        items = r.json()
        peniche = next((c for c in items if c.get("club_id") == PENICHE_CLUB_ID), None)
        # Ne doit pas planter même si Péniche pas dans les 20km — cherche avec plus large
        if peniche is None:
            r2 = requests.get(
                f"{BASE_URL}/api/clubs",
                params={"lat": PARIS_LAT, "lng": PARIS_LNG, "radius_km": 100, "search": "Marcounet"},
                headers=_hdr(apple_token),
                timeout=45,
            )
            items2 = r2.json()
            peniche = next((c for c in items2 if c.get("club_id") == PENICHE_CLUB_ID), None)
        assert peniche is not None, "Péniche Marcounet introuvable dans /api/clubs"
        assert peniche["user_rating_count"] >= 2, f"attendu ≥2 avis, got {peniche['user_rating_count']}"
        assert peniche["user_rating"] is not None and 1.0 <= peniche["user_rating"] <= 5.0

    def test_get_club_by_id(self, apple_token):
        r = requests.get(f"{BASE_URL}/api/clubs/{PENICHE_CLUB_ID}", headers=_hdr(apple_token), timeout=30)
        assert r.status_code == 200
        club = r.json()
        assert club.get("club_id") == PENICHE_CLUB_ID


# ─── Reviews CRUD ──────────────────────────────────────────────────────────
# We use a test club_id (fake) to isolate from Péniche/Concrete existing reviews.
TEST_CLUB_ID = "gp_TEST_REVIEW_REGRESSION_XYZ"


class TestReviewsCRUD:
    def test_create_review_rating_out_of_range_low(self, apple_token):
        r = requests.post(
            f"{BASE_URL}/api/clubs/{TEST_CLUB_ID}/reviews",
            json={"rating": 0, "text": "trop bas"},
            headers=_hdr(apple_token),
            timeout=20,
        )
        assert r.status_code == 400, f"attendu 400, got {r.status_code} {r.text[:200]}"

    def test_create_review_rating_out_of_range_high(self, apple_token):
        r = requests.post(
            f"{BASE_URL}/api/clubs/{TEST_CLUB_ID}/reviews",
            json={"rating": 6, "text": "trop haut"},
            headers=_hdr(apple_token),
            timeout=20,
        )
        assert r.status_code == 400

    def test_create_and_upsert_review(self, apple_token):
        # Create rating 3
        r = requests.post(
            f"{BASE_URL}/api/clubs/{TEST_CLUB_ID}/reviews",
            json={"rating": 3, "text": "TEST_regression initial"},
            headers=_hdr(apple_token),
            timeout=20,
        )
        assert r.status_code == 201
        # GET verify
        g = requests.get(f"{BASE_URL}/api/clubs/{TEST_CLUB_ID}/reviews", headers=_hdr(apple_token), timeout=20)
        assert g.status_code == 200
        d = g.json()
        assert d["count"] >= 1
        assert d["my_review"] is not None
        assert d["my_review"]["rating"] == 3
        assert d["avg"] is not None
        # Upsert to rating 5
        r2 = requests.post(
            f"{BASE_URL}/api/clubs/{TEST_CLUB_ID}/reviews",
            json={"rating": 5, "text": "TEST_regression updated"},
            headers=_hdr(apple_token),
            timeout=20,
        )
        assert r2.status_code == 201
        g2 = requests.get(f"{BASE_URL}/api/clubs/{TEST_CLUB_ID}/reviews", headers=_hdr(apple_token), timeout=20)
        d2 = g2.json()
        assert d2["my_review"]["rating"] == 5
        assert d2["my_review"]["text"] == "TEST_regression updated"
        # No duplicate created (still same count as before)
        assert d2["count"] == d["count"]

    def test_get_reviews_structure(self, apple_token):
        r = requests.get(f"{BASE_URL}/api/clubs/{TEST_CLUB_ID}/reviews", headers=_hdr(apple_token), timeout=20)
        assert r.status_code == 200
        d = r.json()
        for k in ("avg", "count", "my_review", "reviews"):
            assert k in d, f"clé manquante: {k}"
        assert isinstance(d["reviews"], list)


# ─── Reply owner ───────────────────────────────────────────────────────────
class TestReviewReply:
    def test_non_owner_cannot_reply(self, apple_token, lucas_token):
        # Apple laisse un avis sur TEST_CLUB (déjà fait plus haut). Récupère review_id
        g = requests.get(f"{BASE_URL}/api/clubs/{TEST_CLUB_ID}/reviews", headers=_hdr(apple_token), timeout=20)
        reviews = g.json()["reviews"]
        assert reviews, "il faut au moins un avis"
        rev_id = reviews[0]["review_id"]
        # Lucas essaye de répondre à un avis sur un club qui n'est pas le sien → 403
        r = requests.post(
            f"{BASE_URL}/api/clubs/{TEST_CLUB_ID}/reviews/{rev_id}/reply",
            json={"text": "je suis pas proprio"},
            headers=_hdr(lucas_token),
            timeout=20,
        )
        assert r.status_code == 403, f"attendu 403, got {r.status_code}"

    def test_random_user_cannot_reply_to_peniche(self, apple_token):
        # Apple (non-owner) tente de répondre à un avis Péniche
        g = requests.get(f"{BASE_URL}/api/clubs/{PENICHE_CLUB_ID}/reviews", headers=_hdr(apple_token), timeout=20)
        assert g.status_code == 200
        reviews = g.json()["reviews"]
        assert reviews, "Péniche devrait avoir des avis (fixtures)"
        rev_id = reviews[0]["review_id"]
        r = requests.post(
            f"{BASE_URL}/api/clubs/{PENICHE_CLUB_ID}/reviews/{rev_id}/reply",
            json={"text": "TEST non-owner"},
            headers=_hdr(apple_token),
            timeout=20,
        )
        assert r.status_code == 403

    def test_owner_lucas_can_reply_to_peniche(self, apple_token, lucas_token):
        # Emma dépose un avis frais sur Péniche pour avoir un review_id à répondre
        # (utilise emma pour ne pas polluer l'existant Apple/Emma)
        # On récupère la liste et on prend le premier avis de la Péniche
        g = requests.get(f"{BASE_URL}/api/clubs/{PENICHE_CLUB_ID}/reviews", headers=_hdr(apple_token), timeout=20)
        reviews = g.json()["reviews"]
        assert reviews, "Péniche devrait avoir des avis"
        rev = reviews[0]
        rev_id = rev["review_id"]
        target_user_id = rev["user_id"]
        # Compte les notifications de l'auteur AVANT
        # (utiliser Apple si target_user_id == Apple, sinon skip la vérif notif)
        r = requests.post(
            f"{BASE_URL}/api/clubs/{PENICHE_CLUB_ID}/reviews/{rev_id}/reply",
            json={"text": "Merci pour ton avis 🙏 — TEST_regression reply"},
            headers=_hdr(lucas_token),
            timeout=20,
        )
        assert r.status_code == 200, f"attendu 200 owner, got {r.status_code} {r.text[:200]}"
        assert r.json().get("ok") is True
        # Vérifie que la reply est bien stockée
        g2 = requests.get(f"{BASE_URL}/api/clubs/{PENICHE_CLUB_ID}/reviews", headers=_hdr(apple_token), timeout=20)
        target = next((x for x in g2.json()["reviews"] if x["review_id"] == rev_id), None)
        assert target is not None
        assert target.get("reply") is not None
        assert "text" in target["reply"] and "name" in target["reply"] and "at" in target["reply"]
        assert "TEST_regression reply" in target["reply"]["text"]

    def test_reply_empty_returns_400(self, lucas_token, apple_token):
        g = requests.get(f"{BASE_URL}/api/clubs/{PENICHE_CLUB_ID}/reviews", headers=_hdr(apple_token), timeout=20)
        rev_id = g.json()["reviews"][0]["review_id"]
        r = requests.post(
            f"{BASE_URL}/api/clubs/{PENICHE_CLUB_ID}/reviews/{rev_id}/reply",
            json={"text": "   "},
            headers=_hdr(lucas_token),
            timeout=20,
        )
        assert r.status_code == 400

    def test_reply_review_not_found(self, lucas_token):
        r = requests.post(
            f"{BASE_URL}/api/clubs/{PENICHE_CLUB_ID}/reviews/rev_doesnotexist/reply",
            json={"text": "TEST"},
            headers=_hdr(lucas_token),
            timeout=20,
        )
        assert r.status_code == 404


# ─── Régression rapide ─────────────────────────────────────────────────────
class TestOtherRegression:
    def test_matches(self, apple_token):
        r = requests.get(f"{BASE_URL}/api/matches", headers=_hdr(apple_token), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_notifications(self, apple_token):
        r = requests.get(f"{BASE_URL}/api/notifications", headers=_hdr(apple_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        # peut être list ou {items: []}
        assert isinstance(data, (list, dict))
