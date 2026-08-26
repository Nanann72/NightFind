"""Tests for phone verification (Twilio Verify) + 2FA login.

Context: TWILIO_* env vars are intentionally empty in this environment.
Endpoints must therefore return clear error responses (503 when Twilio is
needed, 400/401/409 for business errors) — and normal email login must
remain fully functional (no regression)."""
import os
import pytest
import requests
from pymongo import MongoClient

BASE_URL = "https://fan-culture-app.preview.emergentagent.com"
API = f"{BASE_URL}/api"

REVIEWER_EMAIL = "apple.reviewer@nightfinder.app"
REVIEWER_PASSWORD = "Reviewer2026!"
LUCAS_EMAIL = "lucas.demo@nightfinder.app"
LUCAS_PASSWORD = "DemoOnly2026!"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def reviewer_token(api_client):
    r = api_client.post(f"{API}/auth/login", json={
        "email": REVIEWER_EMAIL, "password": REVIEWER_PASSWORD})
    assert r.status_code == 200, r.text
    data = r.json()
    # Non-régression : token émis normalement (pas d'A2F)
    assert "token" in data
    assert "user" in data
    assert "two_factor_required" not in data
    return data["token"]


@pytest.fixture(scope="module")
def mongo_db():
    cli = MongoClient("mongodb://localhost:27017")
    yield cli["night_finder"]
    cli.close()


# ---- Non-régression : login normal ----
class TestLoginRegression:
    def test_login_reviewer_returns_token(self, api_client):
        r = api_client.post(f"{API}/auth/login", json={
            "email": REVIEWER_EMAIL, "password": REVIEWER_PASSWORD})
        assert r.status_code == 200
        d = r.json()
        assert d.get("token")
        assert d.get("user", {}).get("email") == REVIEWER_EMAIL
        assert "two_factor_required" not in d

    def test_login_lucas_returns_token(self, api_client):
        r = api_client.post(f"{API}/auth/login", json={
            "email": LUCAS_EMAIL, "password": LUCAS_PASSWORD})
        assert r.status_code == 200
        assert r.json().get("token")


# ---- /phone/send-otp ----
class TestPhoneSendOtp:
    def test_send_otp_returns_503_when_twilio_missing(self, api_client, reviewer_token):
        r = api_client.post(
            f"{API}/phone/send-otp",
            json={"phone": "+33612345678"},
            headers={"Authorization": f"Bearer {reviewer_token}"},
        )
        assert r.status_code == 503, r.text
        assert "SMS" in r.json().get("detail", "") or "Twilio" in r.json().get("detail", "")

    def test_send_otp_invalid_phone_returns_400(self, api_client, reviewer_token):
        r = api_client.post(
            f"{API}/phone/send-otp",
            json={"phone": "abc"},
            headers={"Authorization": f"Bearer {reviewer_token}"},
        )
        assert r.status_code == 400, r.text

    def test_send_otp_requires_auth(self, api_client):
        r = api_client.post(f"{API}/phone/send-otp", json={"phone": "+33612345678"})
        assert r.status_code == 401


# ---- /phone/verify-otp ----
class TestPhoneVerifyOtp:
    def test_verify_otp_returns_401_when_twilio_missing(self, api_client, reviewer_token):
        r = api_client.post(
            f"{API}/phone/verify-otp",
            json={"phone": "+33612345678", "code": "123456"},
            headers={"Authorization": f"Bearer {reviewer_token}"},
        )
        assert r.status_code == 401, r.text


# ---- /me/two-factor ----
class TestTwoFactorToggle:
    def test_enable_2fa_without_phone_verified_returns_409(self, api_client, reviewer_token, mongo_db):
        # Ensure phone_verified is not set on reviewer
        mongo_db.users.update_one(
            {"email": REVIEWER_EMAIL},
            {"$unset": {"phone_verified": "", "phone": ""}},
        )
        r = api_client.put(
            f"{API}/me/two-factor",
            json={"enabled": True},
            headers={"Authorization": f"Bearer {reviewer_token}"},
        )
        assert r.status_code == 409, r.text
        assert "numéro" in r.json().get("detail", "").lower() or "verif" in r.json().get("detail", "").lower()

    def test_disable_2fa_returns_200(self, api_client, reviewer_token):
        r = api_client.put(
            f"{API}/me/two-factor",
            json={"enabled": False},
            headers={"Authorization": f"Bearer {reviewer_token}"},
        )
        assert r.status_code == 200
        assert r.json().get("two_factor_enabled") is False


# ---- /auth/login-2fa ----
class TestLogin2FA:
    def test_login_2fa_without_phone_returns_400(self, api_client, mongo_db):
        # Ensure reviewer has no phone
        mongo_db.users.update_one(
            {"email": REVIEWER_EMAIL},
            {"$unset": {"phone": "", "phone_verified": ""}},
        )
        r = api_client.post(
            f"{API}/auth/login-2fa",
            json={"email": REVIEWER_EMAIL, "password": REVIEWER_PASSWORD, "code": "123456"},
        )
        assert r.status_code == 400, r.text
        assert "numéro" in r.json().get("detail", "").lower()

    def test_login_2fa_wrong_password_returns_401(self, api_client):
        r = api_client.post(
            f"{API}/auth/login-2fa",
            json={"email": REVIEWER_EMAIL, "password": "wrongpwd", "code": "123456"},
        )
        assert r.status_code == 401


# ---- Sécurité : A2F ne doit pas bloquer login si Twilio HS ----
class TestTwoFactorFallbackWhenTwilioDown:
    def test_login_still_works_when_2fa_enabled_but_twilio_missing(self, api_client, mongo_db):
        """Si un user a two_factor_enabled=True + phone_verified=True mais que
        Twilio n'est pas configuré, le login doit renvoyer un token normalement
        (fallback de sécurité — l'A2F ne doit pas bloquer la connexion)."""
        # Setup : force lucas en A2F activée
        mongo_db.users.update_one(
            {"email": LUCAS_EMAIL},
            {"$set": {
                "two_factor_enabled": True,
                "phone": "+33612345678",
                "phone_verified": True,
            }},
        )
        try:
            r = api_client.post(f"{API}/auth/login", json={
                "email": LUCAS_EMAIL, "password": LUCAS_PASSWORD})
            assert r.status_code == 200, r.text
            data = r.json()
            # Must return token (fallback) — NOT two_factor_required
            assert data.get("token"), f"Login blocked by 2FA despite Twilio HS: {data}"
            assert "user" in data
            assert data.get("two_factor_required") is not True
        finally:
            # Cleanup : remettre lucas à l'état normal
            mongo_db.users.update_one(
                {"email": LUCAS_EMAIL},
                {"$set": {"two_factor_enabled": False}},
            )
