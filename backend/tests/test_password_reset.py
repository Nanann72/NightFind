"""Password reset endpoint tests — /api/auth/forgot-password + /api/auth/reset-password.

Covers:
- Privacy: forgot-password returns 200 for existing & non-existing emails
- OTP + link modes
- Rate limit (max 3 pending entries per 15min)
- Missing code/token → 400
- Invalid code → 400
- Valid code (inserted directly) → 200 + login with new password works
- Single-use: reusing same code after success → 400
- Link mode with token → same behaviour
"""
from __future__ import annotations

import hashlib
import os
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

# Load backend .env for MONGO_URL / DB_NAME
load_dotenv(Path("/app/backend/.env"))

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL"
) else None
if not BASE_URL:
    # Fallback: read directly from frontend/.env
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
            break

assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ.get("DB_NAME", "night_finder")

_mc = MongoClient(MONGO_URL)
_db = _mc[DB_NAME]


# -------------- Fixtures -------------- #

@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def test_user(api):
    """Create a fresh test user via /api/auth/register.

    Uses a random suffix so re-runs don't collide.
    """
    email = f"test_reset_{uuid.uuid4().hex[:8]}@example.com"
    password = "OldPass!123"
    r = api.post(
        f"{BASE_URL}/api/auth/register",
        json={
            "email": email,
            "password": password,
            "name": "Reset Tester",
            "dob": "1995-06-15",
        },
    )
    assert r.status_code == 200, f"Register failed: {r.status_code} {r.text}"
    data = r.json()
    yield {"email": email, "password": password, "user_id": data["user"]["user_id"]}
    # Cleanup
    _db.users.delete_many({"email": email})
    _db.password_resets.delete_many({"email": email})


@pytest.fixture(autouse=True)
def _cleanup_between(test_user):
    """Clear password_resets for the module test email between tests to avoid
    inter-test rate-limit contamination."""
    _db.password_resets.delete_many({"email": test_user["email"]})
    yield


# -------------- Tests -------------- #

class TestForgotPassword:
    """POST /api/auth/forgot-password — privacy & modes."""

    def test_otp_mode_existing_email_returns_200(self, api, test_user):
        r = api.post(
            f"{BASE_URL}/api/auth/forgot-password",
            json={"email": test_user["email"], "mode": "otp"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("mode") == "otp"
        assert "message" in body
        # Verify persistence: one entry in password_resets
        cnt = _db.password_resets.count_documents(
            {"email": test_user["email"], "mode": "otp"}
        )
        assert cnt == 1, f"Expected 1 reset entry, found {cnt}"

    def test_otp_mode_unknown_email_returns_200_privacy(self, api):
        """Even for a non-existing email, we return 200 to avoid leaking."""
        unknown = f"nobody_{uuid.uuid4().hex[:8]}@example.com"
        r = api.post(
            f"{BASE_URL}/api/auth/forgot-password",
            json={"email": unknown, "mode": "otp"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("mode") == "otp"
        # No reset row should be created for unknown users
        cnt = _db.password_resets.count_documents({"email": unknown})
        assert cnt == 0

    def test_link_mode_returns_200(self, api, test_user):
        r = api.post(
            f"{BASE_URL}/api/auth/forgot-password",
            json={"email": test_user["email"], "mode": "link"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("mode") == "link"
        cnt = _db.password_resets.count_documents(
            {"email": test_user["email"], "mode": "link"}
        )
        assert cnt == 1


class TestRateLimit:
    """4 rapid forgot-password calls → all 200 but only 3 rows persisted."""

    def test_max_three_entries_per_15min(self, api, test_user):
        statuses = []
        for _ in range(4):
            r = api.post(
                f"{BASE_URL}/api/auth/forgot-password",
                json={"email": test_user["email"], "mode": "otp"},
            )
            statuses.append(r.status_code)
        assert all(s == 200 for s in statuses), f"Non-200: {statuses}"
        cnt = _db.password_resets.count_documents(
            {"email": test_user["email"]}
        )
        assert cnt == 3, f"Expected 3 persisted entries, got {cnt}"


class TestResetPasswordValidation:
    """Body validation on /api/auth/reset-password."""

    def test_missing_code_and_token(self, api, test_user):
        r = api.post(
            f"{BASE_URL}/api/auth/reset-password",
            json={"email": test_user["email"], "new_password": "NewPass!123"},
        )
        assert r.status_code == 400, r.text
        assert "Missing code or token" in r.text

    def test_invalid_code(self, api, test_user):
        r = api.post(
            f"{BASE_URL}/api/auth/reset-password",
            json={
                "email": test_user["email"],
                "code": "000000",
                "new_password": "NewPass!123",
            },
        )
        assert r.status_code == 400, r.text
        assert "invalide" in r.text.lower() or "expir" in r.text.lower()


class TestResetPasswordSuccessOTP:
    """Insert a valid OTP row directly → reset → verify login works → reuse fails."""

    def test_full_flow_otp(self, api, test_user):
        code = "543210"
        token_hash = hashlib.sha256(code.encode()).hexdigest()
        now = datetime.now(timezone.utc)
        _db.password_resets.insert_one({
            "reset_id": f"rst_{uuid.uuid4().hex[:12]}",
            "email": test_user["email"],
            "user_id": test_user["user_id"],
            "mode": "otp",
            "token_hash": token_hash,
            "created_at": now,
            "expires_at": now + timedelta(minutes=30),
            "used": False,
            "ip": None,
        })

        new_password = "BrandNew!456"
        r = api.post(
            f"{BASE_URL}/api/auth/reset-password",
            json={
                "email": test_user["email"],
                "code": code,
                "new_password": new_password,
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert "token" in body and isinstance(body["token"], str)
        assert body.get("user", {}).get("user_id") == test_user["user_id"]

        # Login with NEW password → should succeed
        login = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": test_user["email"], "password": new_password},
        )
        assert login.status_code == 200, login.text
        assert "token" in login.json()

        # Login with OLD password → should fail 401
        old_login = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": test_user["email"], "password": test_user["password"]},
        )
        assert old_login.status_code == 401

        # Reusing the same code → should fail
        reuse = api.post(
            f"{BASE_URL}/api/auth/reset-password",
            json={
                "email": test_user["email"],
                "code": code,
                "new_password": "AnotherPass!789",
            },
        )
        assert reuse.status_code == 400, reuse.text

        # Update test_user password so subsequent tests know current state
        test_user["password"] = new_password


class TestResetPasswordSuccessLink:
    """Same as OTP but with a magic-link token."""

    def test_full_flow_link(self, api, test_user):
        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        now = datetime.now(timezone.utc)
        _db.password_resets.insert_one({
            "reset_id": f"rst_{uuid.uuid4().hex[:12]}",
            "email": test_user["email"],
            "user_id": test_user["user_id"],
            "mode": "link",
            "token_hash": token_hash,
            "created_at": now,
            "expires_at": now + timedelta(minutes=30),
            "used": False,
            "ip": None,
        })

        new_password = "LinkReset!789"
        r = api.post(
            f"{BASE_URL}/api/auth/reset-password",
            json={
                "email": test_user["email"],
                "token": raw_token,
                "new_password": new_password,
            },
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Login with new password works
        login = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": test_user["email"], "password": new_password},
        )
        assert login.status_code == 200, login.text

        # Reuse same token → fail
        reuse = api.post(
            f"{BASE_URL}/api/auth/reset-password",
            json={
                "email": test_user["email"],
                "token": raw_token,
                "new_password": "yet another",
            },
        )
        assert reuse.status_code == 400

        test_user["password"] = new_password
