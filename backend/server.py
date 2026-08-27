"""Night Finder FastAPI backend."""
from __future__ import annotations

import logging
import math
import asyncio
import json
import os
import secrets
import hashlib
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

import bcrypt
import httpx
import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response, StreamingResponse
import io
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

JWT_SECRET = os.environ.get("JWT_SECRET", "night-finder-dev-secret-change-me").strip().strip(chr(34)).strip(chr(39))
JWT_ALG = "HS256"
JWT_TTL_DAYS = 7

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get("DB_NAME", "night_finder")]

# Shared HTTP client (reused across all outbound requests)
http_client: Optional[httpx.AsyncClient] = None

# Local import so server.py can be loaded even if file is missing
import places_service  # noqa: E402
import push_service  # noqa: E402
import legal_pages  # noqa: E402
import email_service  # noqa: E402
import admin_service  # noqa: E402
import claim_verification  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Night Finder API")
api_router = APIRouter(prefix="/api")


PLACES_DUMP_PATH = os.path.join(os.path.dirname(__file__), "data", "places_dump.json.gz")


async def _seed_places_from_dump() -> None:
    """Auto-seed de db.places depuis le dump embarqué (déploiement prod).

    Upsert idempotent : ne s'exécute que si la base contient moins de lieux
    que le dump (à 95%), pour rattraper les nouveaux imports à chaque déploiement.
    """
    try:
        if os.path.exists(PLACES_DUMP_PATH):
            import gzip
            import json as _json
            with gzip.open(PLACES_DUMP_PATH, "rt", encoding="utf-8") as f:
                docs = _json.load(f)
            count = await db.places.count_documents({})
            if count < len(docs) * 0.95:
                logger.info(f"places seed: {count} lieux en base < {len(docs)} au dump — chargement…")
                from pymongo import UpdateOne
                ops = []
                for doc in docs:
                    doc.pop("expires_at", None)  # clubs permanents, jamais de TTL
                    v = doc.get("updated_at")
                    if isinstance(v, str):
                        try:
                            doc["updated_at"] = datetime.fromisoformat(v)
                        except ValueError:
                            doc.pop("updated_at", None)
                    ops.append(UpdateOne({"place_id": doc["place_id"]}, {"$set": doc}, upsert=True))
                    if len(ops) >= 500:
                        await db.places.bulk_write(ops, ordered=False)
                        ops = []
                if ops:
                    await db.places.bulk_write(ops, ordered=False)
                total = await db.places.count_documents({})
                logger.info(f"places seed: terminé — {total} lieux en base.")
    except Exception as exc:
        logger.error(f"places seed: échec — {exc}")
    # Toujours appliquer les correctifs photos (même si le seed est ignoré)
    await _apply_club_photo_fixes()
    await _fix_generic_club_photos()
    await _diversify_fallback_photos()
    await _ensure_reviewer_account()


async def _diversify_fallback_photos() -> None:
    """Les lieux sans photo Google partageaient UNE seule photo stock.
    Réattribue une photo d'ambiance variée et déterministe par lieu (idempotent)."""
    try:
        old = "https://images.unsplash.com/photo-1571266028243-d220c6a9b40c?w=1200&q=80"
        bank = places_service.FALLBACK_PHOTO_BANK
        fixed = 0
        for coll in (db.places, db.clubs):
            async for d in coll.find({"photos.0": old}, {"club_id": 1}):
                idx = int(hashlib.md5(d["club_id"].encode()).hexdigest(), 16) % len(bank)
                if bank[idx] == old:
                    idx = (idx + 1) % len(bank)
                await coll.update_one({"_id": d["_id"]}, {"$set": {"photos": [bank[idx]]}})
                fixed += 1
        if fixed:
            logger.info(f"fallback photos: {fixed} lieux diversifiés.")
    except Exception as exc:  # noqa: BLE001
        logger.error(f"fallback photos: échec — {exc}")


def _norm_name(s: str) -> str:
    import re
    import unicodedata
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


async def _fix_generic_club_photos() -> None:
    """Remplace les photos stock (Unsplash/Pexels) des clubs générés par les
    vraies photos Google du même établissement présent dans db.places
    (match nom normalisé + distance < 1,5 km). Aucun appel API — idempotent."""
    try:
        generic_q = {"photos.0": {"$regex": "unsplash|pexels", "$options": "i"}}
        count = await db.clubs.count_documents(generic_q)
        if not count:
            return
        places = await db.places.find(
            {"photos.0": {"$exists": True}},
            {"_id": 0, "name": 1, "lat": 1, "lng": 1, "photos": 1},
        ).to_list(30000)
        by_norm: dict = {}
        for p in places:
            by_norm.setdefault(_norm_name(p["name"]), []).append(p)
        fixed = 0
        async for club in db.clubs.find(generic_q):
            n = _norm_name(club.get("name", ""))
            clat, clng = club.get("lat"), club.get("lng")
            candidates = list(by_norm.get(n, []))
            if not candidates and len(n) >= 5:
                for key, plist in by_norm.items():
                    if n in key or key in n:
                        candidates.extend(plist)
            for cand in candidates:
                if clat is None or cand.get("lat") is None:
                    continue
                if haversine_km(clat, clng, cand["lat"], cand["lng"]) < 1.5:
                    await db.clubs.update_one(
                        {"club_id": club["club_id"]},
                        {"$set": {"photos": cand["photos"][:4]}},
                    )
                    fixed += 1
                    break
        if fixed:
            logger.info(f"generic club photos: {fixed}/{count} clubs corrigés avec de vraies photos.")
    except Exception as exc:  # noqa: BLE001
        logger.error(f"generic club photos: échec — {exc}")


async def _ensure_reviewer_account() -> None:
    """Garantit l'existence du compte démo Apple Review en production
    (apple.reviewer@nightfinder.app) — requis pour la review App Store.
    Toujours exécuté : le seed est idempotent et resynchronise le mot de passe."""
    try:
        import seed_reviewer
        await seed_reviewer.main()
        logger.info("reviewer seed: compte Apple Review vérifié/synchronisé.")
    except Exception as exc:  # noqa: BLE001
        logger.error(f"reviewer seed: échec — {exc}")


CLUB_PHOTOS_FIX_PATH = os.path.join(os.path.dirname(__file__), "data", "club_photos_fix.json")


async def _apply_club_photo_fixes() -> None:
    """Remplace les photos génériques (Unsplash/Pexels) des clubs seed par les
    vraies photos Google (dump data/club_photos_fix.json), idempotent."""
    try:
        if not os.path.exists(CLUB_PHOTOS_FIX_PATH):
            return
        import json as _json
        with open(CLUB_PHOTOS_FIX_PATH, encoding="utf-8") as f:
            fixes = _json.load(f)
        updated = 0
        for name, photos in fixes.items():
            res = await db.clubs.update_one(
                {"name": name, "photos.0": {"$regex": "unsplash|pexels", "$options": "i"}},
                {"$set": {"photos": photos}},
            )
            updated += res.modified_count
        if updated:
            logger.info(f"club photos fix: {updated} clubs mis à jour avec de vraies photos.")
    except Exception as exc:
        logger.error(f"club photos fix: échec — {exc}")


@app.on_event("startup")
async def _startup() -> None:
    global http_client
    http_client = httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0))
    await places_service.ensure_indexes(db)
    asyncio.create_task(_seed_places_from_dump())
    # Seed the admin account (idempotent). Credentials are set via env vars
    # so they can be rotated without a code change. Defaults are safe:
    # everything is behind is_admin=True and the account is hidden from
    # discovery (visibility="hidden").
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@nightfinder.app").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "NightFinder2026!Admin")
    existing = await db.users.find_one({"email": admin_email})
    if existing:
        # Make sure the flag is set even if the account already existed
        if not existing.get("is_admin") or existing.get("visibility") != "hidden":
            await db.users.update_one(
                {"user_id": existing["user_id"]},
                {"$set": {
                    "is_admin": True,
                    "visibility": "hidden",
                    "is_premium": True,
                }},
            )
            logger.info(f"Admin account {admin_email} upgraded (is_admin=True).")
    else:
        await db.users.insert_one({
            "user_id": f"admin_{uuid.uuid4().hex[:12]}",
            "email": admin_email,
            "name": "Night Finder Admin",
            "dob": "1990-01-01",
            "password_hash": hash_password(admin_password),
            "picture": None,
            "photos": [],
            "music_prefs": [],
            "bio": "",
            "city": "Paris",
            "instagram": "",
            "fav_clubs": [],
            "auth_provider": "email",
            "is_admin": True,
            "is_premium": True,
            "visibility": "hidden",
            "created_at": datetime.now(timezone.utc),
        })
        logger.info(f"Admin account {admin_email} seeded.")


@app.on_event("shutdown")
async def _shutdown() -> None:
    if http_client is not None:
        await http_client.aclose()

# -------------- Models -------------- #


class EmailSignup(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    dob: str  # ISO date YYYY-MM-DD (required: 18+ check)


class EmailLogin(BaseModel):
    email: EmailStr
    password: str


class ForgotPassword(BaseModel):
    email: EmailStr
    mode: str = "otp"  # "otp" (6-digit code) or "link" (magic link)


class ResetPassword(BaseModel):
    email: EmailStr
    code: Optional[str] = None  # 6-digit OTP
    token: Optional[str] = None  # magic-link token
    new_password: str = Field(min_length=6)


class GoogleSession(BaseModel):
    session_token: str


class AppleSignIn(BaseModel):
    identity_token: str
    email: Optional[str] = None
    name: Optional[str] = None


class CheckInBody(BaseModel):
    club_id: str
    confirmed: bool


class UserPublic(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    music_prefs: List[str] = []
    created_at: datetime


class SwipeAction(BaseModel):
    club_id: str
    action: str  # "like" or "skip"


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    music_prefs: Optional[List[str]] = None
    picture: Optional[str] = None


class ReportBody(BaseModel):
    target_user_id: str
    reason: str  # e.g. "inappropriate_photos", "harassment", "spam", "fake_profile", "other"
    context: Optional[str] = None  # e.g. "swipe", "chat", "profile"
    details: Optional[str] = None  # free-text user description (max 500)


class BlockBody(BaseModel):
    target_user_id: str


class DeleteAccountBody(BaseModel):
    password: Optional[str] = None  # required for email accounts, ignored for OAuth
    confirm: str  # must equal "DELETE" to confirm


# -------------- Auth helpers -------------- #


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def make_jwt(user_id: str) -> str:
    payload = {
        "user_id": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_TTL_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


_last_seen_cache: dict = {}
LAST_SEEN_THROTTLE_SECONDS = 300


def _touch_last_seen(user_id: str) -> None:
    """Met à jour users.last_seen au plus 1 fois / 5 min (fire-and-forget)."""
    now = datetime.now(timezone.utc)
    prev = _last_seen_cache.get(user_id)
    if prev and (now - prev).total_seconds() < LAST_SEEN_THROTTLE_SECONDS:
        return
    _last_seen_cache[user_id] = now

    async def _update() -> None:
        try:
            await db.users.update_one({"user_id": user_id}, {"$set": {"last_seen": now}})
        except Exception:  # noqa: BLE001
            pass

    asyncio.create_task(_update())


async def get_current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth.split(" ", 1)[1].strip()

    # Try JWT first (email login)
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("user_id")
        if user_id:
            user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
            if user:
                _touch_last_seen(user["user_id"])
                return user
    except jwt.InvalidTokenError:
        pass

    # Try session token (Google auth)
    session = await db.user_sessions.find_one(
        {"session_token": token}, {"_id": 0}
    )
    if session:
        exp = session.get("expires_at")
        if isinstance(exp, datetime):
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp > datetime.now(timezone.utc):
                user = await db.users.find_one(
                    {"user_id": session["user_id"]}, {"_id": 0}
                )
                if user:
                    # Reject banned users (auto-expire temporary bans)
                    is_banned, reason = admin_service.is_user_banned(user)
                    if is_banned:
                        raise HTTPException(
                            status_code=403,
                            detail={
                                "code": "account_banned",
                                "message": "Ton compte a été suspendu.",
                                "reason": reason or "Non spécifié",
                                "until": (
                                    user.get("banned_until").isoformat()
                                    if user.get("banned_until") else None
                                ),
                            },
                        )
                    _touch_last_seen(user["user_id"])
                    return user
    raise HTTPException(status_code=401, detail="Invalid or expired token")


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Dependency: only allow requests from an admin account."""
    if not bool(user.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def public_user(user: dict) -> dict:
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user.get("name", ""),
        "picture": user.get("picture"),
        "music_prefs": user.get("music_prefs", []),
        "created_at": user.get("created_at"),
        "username": user.get("username"),
        "visibility": user.get("visibility", "clubs_only"),
        # Swipe-profile fields (must be exposed so the frontend can prefill the
        # "Modifier mon profil swipe" screen — otherwise the user perceives the
        # configuration as "not saving").
        "dob": user.get("dob"),
        "bio": user.get("bio"),
        "city": user.get("city"),
        "instagram": user.get("instagram"),
        "photos": user.get("photos", []),
        "fav_clubs": user.get("fav_clubs", []),
        "is_premium": bool(user.get("is_premium")),
        "premium_expires_at": user.get("premium_expires_at"),
        "is_admin": bool(user.get("is_admin")),
        "is_bar_owner": bool(user.get("is_bar_owner")),
        "owned_club_id": user.get("owned_club_id"),
    }


# -------------- Auth routes -------------- #


@api_router.post("/auth/register")
async def register(body: EmailSignup):
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    # Validate dob (YYYY-MM-DD) and 18+ requirement
    try:
        dob_date = datetime.strptime(body.dob, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Date de naissance invalide (format YYYY-MM-DD)")
    today = datetime.now(timezone.utc).date()
    age = today.year - dob_date.year - (
        (today.month, today.day) < (dob_date.month, dob_date.day)
    )
    if age < 18:
        raise HTTPException(status_code=400, detail="Tu dois avoir 18 ans ou plus")
    if age > 120:
        raise HTTPException(status_code=400, detail="Date de naissance invalide")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user = {
        "user_id": user_id,
        "email": body.email.lower(),
        "name": body.name,
        "dob": body.dob,
        "password_hash": hash_password(body.password),
        "picture": None,
        "music_prefs": [],
        "bio": "",
        "city": "",
        "instagram": "",
        "photos": [],  # base64 strings, max 3
        "fav_clubs": [],
        "auth_provider": "email",
        "created_at": datetime.now(timezone.utc),
    }
    await db.users.insert_one(user)
    token = make_jwt(user_id)
    return {"token": token, "user": public_user(user)}


@api_router.post("/auth/login")
async def login(body: EmailLogin):
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    # A2F par SMS (Twilio Verify) : si activée, on n'émet pas le token ici
    if user.get("two_factor_enabled") and user.get("phone") and _twilio_ready():
        try:
            await _twilio_send_otp(user["phone"])
        except HTTPException:
            pass  # Twilio HS → ne bloque pas la connexion
        else:
            return {"two_factor_required": True, "phone_hint": f"•••{user['phone'][-2:]}"}
    token = make_jwt(user["user_id"])
    return {"token": token, "user": public_user(user)}


class Login2FABody(BaseModel):
    email: str
    password: str
    code: str


@api_router.post("/auth/login-2fa")
async def login_2fa(body: Login2FABody):
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if not user or not user.get("password_hash") or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.get("phone"):
        raise HTTPException(status_code=400, detail="Aucun numéro vérifié")
    if not await _twilio_check_otp(user["phone"], body.code):
        raise HTTPException(status_code=401, detail="Code invalide ou expiré")
    token = make_jwt(user["user_id"])
    return {"token": token, "user": public_user(user)}


# ---- Twilio Verify : vérification téléphone + A2F ----
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "").strip().strip('"')
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "").strip().strip('"')
TWILIO_VERIFY_SERVICE = os.environ.get("TWILIO_VERIFY_SERVICE", "").strip().strip('"')
import re as _phone_re_mod
_PHONE_RE = _phone_re_mod.compile(r"^\+[1-9]\d{6,14}$")  # E.164


def _twilio_ready() -> bool:
    return bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE)


def _twilio_client():
    from twilio.rest import Client
    return Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)


async def _twilio_send_otp(phone: str) -> None:
    if not _twilio_ready():
        raise HTTPException(status_code=503, detail="Vérification SMS non configurée (clés Twilio manquantes)")
    def _send():
        _twilio_client().verify.v2.services(TWILIO_VERIFY_SERVICE).verifications.create(to=phone, channel="sms")
    try:
        await asyncio.to_thread(_send)
    except Exception as exc:  # noqa: BLE001
        logging.warning("Twilio send failed: %s", exc)
        raise HTTPException(status_code=502, detail="Envoi du SMS impossible — vérifie le numéro (+33...)")


async def _twilio_check_otp(phone: str, code: str) -> bool:
    if not _twilio_ready():
        return False
    def _check():
        return _twilio_client().verify.v2.services(TWILIO_VERIFY_SERVICE).verification_checks.create(to=phone, code=code)
    try:
        res = await asyncio.to_thread(_check)
        return res.status == "approved"
    except Exception:  # noqa: BLE001
        return False


class PhoneBody(BaseModel):
    phone: str


class PhoneCodeBody(BaseModel):
    phone: str
    code: str


@api_router.post("/phone/send-otp")
async def phone_send_otp(body: PhoneBody, user: dict = Depends(get_current_user)):
    phone = body.phone.strip().replace(" ", "")
    if not _PHONE_RE.match(phone):
        raise HTTPException(status_code=400, detail="Numéro invalide — format international requis (+33612345678)")
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    n = await db.phone_otp_attempts.count_documents({"user_id": user["user_id"], "created_at": {"$gte": day_start}})
    if n >= 5:
        raise HTTPException(status_code=429, detail="Trop de SMS envoyés aujourd'hui — réessaie demain.")
    await db.phone_otp_attempts.insert_one({"user_id": user["user_id"], "created_at": datetime.now(timezone.utc)})
    await _twilio_send_otp(phone)
    return {"ok": True}


@api_router.post("/phone/verify-otp")
async def phone_verify_otp(body: PhoneCodeBody, user: dict = Depends(get_current_user)):
    phone = body.phone.strip().replace(" ", "")
    if not await _twilio_check_otp(phone, body.code.strip()):
        raise HTTPException(status_code=401, detail="Code invalide ou expiré")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"phone": phone, "phone_verified": True, "phone_verified_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True, "phone_verified": True}


class TwoFactorBody(BaseModel):
    enabled: bool


@api_router.put("/me/two-factor")
async def set_two_factor(body: TwoFactorBody, user: dict = Depends(get_current_user)):
    if body.enabled and not user.get("phone_verified"):
        raise HTTPException(status_code=409, detail="Vérifie d'abord ton numéro de téléphone.")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"two_factor_enabled": body.enabled}})
    return {"ok": True, "two_factor_enabled": body.enabled}


@api_router.post("/auth/forgot-password")
async def forgot_password(body: ForgotPassword, request: Request):
    """Send a password reset email (OTP or magic link) via Resend.

    Always returns 200 to avoid leaking whether an email exists.
    Rate limited per email (max 3 requests / 15 min).
    """
    email = body.email.lower().strip()
    mode = "link" if body.mode == "link" else "otp"

    # Rate limit: max 3 pending (unused) tokens in the last 15 minutes for this email
    since = datetime.now(timezone.utc) - timedelta(minutes=15)
    recent = await db.password_resets.count_documents(
        {"email": email, "used": False, "created_at": {"$gte": since}}
    )
    if recent >= 3:
        # Silent: still return success to caller
        return {
            "ok": True,
            "mode": mode,
            "message": "If an account exists for this email, reset instructions have been sent.",
        }

    user = await db.users.find_one({"email": email}, {"_id": 0, "user_id": 1, "name": 1})

    # Only actually send email if the user exists — but always respond OK.
    if user:
        if mode == "otp":
            code = f"{secrets.randbelow(1_000_000):06d}"
            token_hash = hashlib.sha256(code.encode()).hexdigest()
            raw_for_email = code
        else:
            raw_token = secrets.token_urlsafe(32)
            token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
            raw_for_email = raw_token

        now = datetime.now(timezone.utc)
        await db.password_resets.insert_one({
            "reset_id": f"rst_{uuid.uuid4().hex[:12]}",
            "email": email,
            "user_id": user["user_id"],
            "mode": mode,
            "token_hash": token_hash,
            "created_at": now,
            "expires_at": now + timedelta(minutes=30),
            "used": False,
            "ip": (request.client.host if request.client else None),
        })

        try:
            await email_service.send_password_reset(
                email, mode=mode, code_or_token=raw_for_email, minutes=30
            )
        except Exception as exc:
            logger.warning(f"Reset email send failed for {email}: {exc}")

    return {
        "ok": True,
        "mode": mode,
        "message": "If an account exists for this email, reset instructions have been sent.",
    }


@api_router.post("/auth/reset-password")
async def reset_password(body: ResetPassword):
    """Verify OTP or token and update the user's password."""
    email = body.email.lower().strip()
    if not body.code and not body.token:
        raise HTTPException(status_code=400, detail="Missing code or token")

    raw = body.code.strip() if body.code else body.token.strip()  # type: ignore
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    mode = "otp" if body.code else "link"

    now = datetime.now(timezone.utc)
    reset = await db.password_resets.find_one({
        "email": email,
        "token_hash": token_hash,
        "mode": mode,
        "used": False,
        "expires_at": {"$gte": now},
    })
    if not reset:
        raise HTTPException(status_code=400, detail="Code invalide ou expiré")

    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=400, detail="Code invalide ou expiré")

    # Mark used, invalidate all other pending resets for this user, update password
    await db.password_resets.update_one(
        {"_id": reset["_id"]}, {"$set": {"used": True, "used_at": now}}
    )
    await db.password_resets.update_many(
        {"email": email, "used": False}, {"$set": {"used": True, "used_at": now}}
    )
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"password_hash": hash_password(body.new_password), "auth_provider": user.get("auth_provider", "email")}},
    )
    # Re-fetch to return the updated public view
    user = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0}) or user

    token = make_jwt(user["user_id"])
    return {"ok": True, "token": token, "user": public_user(user)}


@api_router.post("/auth/session")
async def google_session(body: GoogleSession):
    """Exchange Emergent Google session_token for a Night Finder session."""
    async with httpx.AsyncClient(timeout=15.0) as hx:
        try:
            r = await hx.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": body.session_token},
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Auth provider error: {exc}")
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid Google session")
        data = r.json()

    email = (data.get("email") or "").lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email missing from Google profile")

    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": user_id,
            "email": email,
            "name": data.get("name") or email.split("@")[0],
            "picture": data.get("picture"),
            "music_prefs": [],
            "auth_provider": "google",
            "created_at": datetime.now(timezone.utc),
        }
        await db.users.insert_one(user)

    session_token = data.get("session_token") or body.session_token
    await db.user_sessions.update_one(
        {"session_token": session_token},
        {
            "$set": {
                "session_token": session_token,
                "user_id": user["user_id"],
                "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
                "created_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )
    return {"token": session_token, "user": public_user(user)}


class GoogleOAuth(BaseModel):
    access_token: str


@api_router.post("/auth/google")
async def google_oauth(body: GoogleOAuth):
    """Sign in with Google using a classic OAuth access token from the
    mobile/web client. We verify the token by calling Google's userinfo
    endpoint and then issue a Night Finder JWT."""
    if http_client is None:
        raise HTTPException(status_code=503, detail="Service not ready")
    try:
        r = await http_client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {body.access_token}"},
            timeout=8.0,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google verify error: {exc}")
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Google access token")
    data = r.json()
    email = (data.get("email") or "").lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email missing from Google profile")

    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": user_id,
            "email": email,
            "name": data.get("name") or email.split("@")[0],
            "picture": data.get("picture"),
            "music_prefs": [],
            "auth_provider": "google",
            "google_sub": data.get("sub"),
            "created_at": datetime.now(timezone.utc),
        }
        await db.users.insert_one(user)

    token = make_jwt(user["user_id"])
    return {"token": token, "user": public_user(user)}


_apple_jwks: dict = {}


def _apple_jwks_client():
    """Client JWKS Apple mis en cache (clés publiques de signature)."""
    if "client" not in _apple_jwks:
        from jwt import PyJWKClient
        _apple_jwks["client"] = PyJWKClient(
            "https://appleid.apple.com/auth/keys", cache_keys=True, lifespan=3600
        )
    return _apple_jwks["client"]


@api_router.post("/auth/apple")
async def apple_signin(body: AppleSignIn):
    """Sign in with Apple : vérifie la signature du identity_token contre les
    clés publiques Apple (JWKS), l'émetteur, l'audience et l'expiration."""
    sub: Optional[str] = None
    email: Optional[str] = body.email
    audiences = [
        a.strip()
        for a in os.environ.get(
            "APPLE_AUDIENCES", "com.nightfinder.app,host.exp.Exponent"
        ).strip().strip('"').split(",")
        if a.strip()
    ]
    try:
        signing_key = _apple_jwks_client().get_signing_key_from_jwt(body.identity_token)
        payload = jwt.decode(
            body.identity_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=audiences,
            issuer="https://appleid.apple.com",
        )
        sub = payload.get("sub")
        if not email:
            email = payload.get("email")
    except Exception as exc:
        logger.warning(f"apple signin: token invalide — {exc}")
        raise HTTPException(status_code=400, detail="Invalid Apple identity token")

    if not sub:
        raise HTTPException(status_code=400, detail="Missing Apple user id")

    apple_email = (email or f"{sub}@privaterelay.appleid.com").lower()
    user = await db.users.find_one({"$or": [{"apple_sub": sub}, {"email": apple_email}]}, {"_id": 0})
    if not user:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": user_id,
            "email": apple_email,
            "name": body.name or (apple_email.split("@")[0]),
            "picture": None,
            "music_prefs": [],
            "auth_provider": "apple",
            "apple_sub": sub,
            "created_at": datetime.now(timezone.utc),
        }
        await db.users.insert_one(user)
    elif not user.get("apple_sub"):
        await db.users.update_one(
            {"user_id": user["user_id"]}, {"$set": {"apple_sub": sub}}
        )

    token = make_jwt(user["user_id"])
    return {"token": token, "user": public_user(user)}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return public_user(user)


@api_router.post("/auth/logout")
async def logout(request: Request, user: dict = Depends(get_current_user)):
    auth = request.headers.get("Authorization", "")
    token = auth.split(" ", 1)[1].strip() if " " in auth else ""
    await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


@api_router.put("/profile")
async def update_profile(
    body: ProfileUpdate, user: dict = Depends(get_current_user)
):
    update = {k: v for k, v in body.dict().items() if v is not None}
    if update:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    new_user = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return public_user(new_user)


# -------------- Clubs -------------- #


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _is_open_now(hours) -> bool:
    """Heuristic — handle both seed schema {"mon": {"open": True}} and Google
    Places shape {"mon": "20:00-04:00"} or empty/string values."""
    if not isinstance(hours, dict):
        return False
    now = datetime.now(timezone.utc)
    weekday = now.strftime("%a").lower()  # mon, tue...
    today = hours.get(weekday)
    if not today:
        return False
    # Seed shape: {"open": True} → use the boolean
    if isinstance(today, dict):
        return bool(today.get("open"))
    # Google Places shape: a string range "20:00 – 04:00" or "Closed"
    if isinstance(today, str):
        t = today.lower().strip()
        if not t or t == "closed" or "fermé" in t:
            return False
        return True
    return False


@api_router.get("/clubs")
async def list_clubs(
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_km: float = 50.0,
    music: Optional[str] = None,
    max_price: Optional[float] = None,
    open_now: Optional[bool] = None,
    vip: Optional[bool] = None,
    terrasse: Optional[bool] = None,
    search: Optional[str] = None,
    source: Optional[str] = None,  # "google" | "seed" | None (auto)
):
    query: dict = {}
    if music:
        query["music_styles"] = {"$in": [music]}
    if max_price is not None:
        query["avg_price"] = {"$lte": max_price}
    if vip:
        query["features"] = {"$in": ["vip"]}
    if terrasse:
        query["features"] = {"$in": ["terrasse"]}
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"description": {"$regex": search, "$options": "i"}},
        ]

    items: List[dict] = []

    # Try Google Places first when we have coordinates and the API key is configured
    use_google = (
        source != "seed"
        and lat is not None
        and lng is not None
        and places_service._is_enabled()
    )
    if use_google and http_client is not None:
        try:
            # Premium users can request up to 200km. Below cap is the
            # per-call Google limit; places_service handles the multi-search
            # fan-out internally.
            google_clubs = await places_service.search_places_nearby(
                db, http_client, lat, lng, min(radius_km, 200.0), max_results=20
            )
            # Apply same query filters in Python
            for c in google_clubs:
                if music and music not in (c.get("music_styles") or []):
                    continue
                if max_price is not None and (c.get("avg_price") or 0) > max_price:
                    continue
                if vip and "vip" not in (c.get("features") or []):
                    continue
                if terrasse and "terrasse" not in (c.get("features") or []):
                    continue
                if search:
                    s = search.lower()
                    hay = " ".join([
                        (c.get("name") or ""), (c.get("description") or ""), (c.get("address") or ""),
                    ]).lower()
                    if not all(w in hay for w in s.split()):
                        continue
                items.append(c)
        except Exception as exc:  # noqa: BLE001
            logging.warning("Google Places fallback to seed: %s", exc)

    # Also include ALL previously imported Google clubs stored in db.places.
    # The live search caps at ~20 results per area — without this merge, most
    # imported clubs would never show up in the app.
    # (With coords → radius filter; without coords but with a search term →
    # name search across all stored clubs, used by the admin partner picker.)
    if (lat is not None and lng is not None) or search:
        try:
            existing_ids = {c.get("club_id") for c in items}
            existing_names = {(c.get("name") or "").lower() for c in items}
            # Filtre géographique au niveau Mongo (bounding box sur l'index
            # lat/lng) — évite de charger les ~16k lieux à chaque requête.
            stored_query: dict = {}
            if lat is not None and lng is not None:
                dlat = radius_km / 111.0
                dlng = radius_km / max(0.1, 111.0 * math.cos(math.radians(lat)))
                stored_query = {
                    "lat": {"$gte": lat - dlat, "$lte": lat + dlat},
                    "lng": {"$gte": lng - dlng, "$lte": lng + dlng},
                }
            stored = await db.places.find(stored_query, {"_id": 0}).to_list(2000)
            for c in stored:
                if c.get("club_id") in existing_ids:
                    continue
                if (c.get("name") or "").lower() in existing_names:
                    continue
                if c.get("lat") is None or c.get("lng") is None:
                    continue
                if lat is not None and lng is not None:
                    if haversine_km(lat, lng, c["lat"], c["lng"]) > radius_km:
                        continue
                if music and music not in (c.get("music_styles") or []):
                    continue
                if max_price is not None and (c.get("avg_price") or 0) > max_price:
                    continue
                if vip and "vip" not in (c.get("features") or []):
                    continue
                if terrasse and "terrasse" not in (c.get("features") or []):
                    continue
                if search:
                    s = search.lower()
                    hay = " ".join([
                        (c.get("name") or ""), (c.get("description") or ""), (c.get("address") or ""),
                    ]).lower()
                    if not all(w in hay for w in s.split()):
                        continue
                c.pop("expires_at", None)
                c.pop("updated_at", None)
                existing_ids.add(c.get("club_id"))
                existing_names.add((c.get("name") or "").lower())
                items.append(c)
        except Exception as exc:  # noqa: BLE001
            logging.warning("Stored places merge failed: %s", exc)

    # Always merge seed clubs too (deduped by name) — distance filter below
    # removes those out of radius when coords are provided.
    cursor = db.clubs.find(query, {"_id": 0})
    items_seed = await cursor.to_list(500)
    existing_names = {c.get("name", "").lower() for c in items}
    for c in items_seed:
        if c.get("name", "").lower() not in existing_names:
            items.append(c)

    if lat is not None and lng is not None:
        for c in items:
            if c.get("lat") is None or c.get("lng") is None:
                c["distance_km"] = None
                continue
            c["distance_km"] = round(
                haversine_km(lat, lng, c["lat"], c["lng"]), 2
            )
        items = [c for c in items if c.get("distance_km", 1e9) <= radius_km]
        items.sort(key=lambda c: c.get("distance_km") or 1e9)
    else:
        for c in items:
            c["distance_km"] = None

    if open_now:
        items = [c for c in items if _is_open_now(c.get("hours", {}))]

    # Paid promoted clubs first, flagged "promoted" (Phase 3)
    try:
        promoted_ids = await _active_promo_club_ids()
        if promoted_ids:
            for c in items:
                c["promoted"] = c.get("club_id") in promoted_ids
            items.sort(key=lambda c: 0 if c.get("promoted") else 1)
    except Exception as exc:  # noqa: BLE001
        logging.warning("Promo annotate failed: %s", exc)

    return items


@api_router.get("/places/photo")
async def proxy_place_photo(name: str = Query(...), max_width: int = 1200):
    """Stream a Google Places photo through our backend so the API key stays
    server-side. Mobile-friendly: width clamped, recompressed to JPEG and
    cached (in Mongo + HTTP Cache-Control) so cards load instantly."""
    if http_client is None:
        raise HTTPException(status_code=503, detail="Service not ready")
    max_width = min(max_width, 720)
    cache_key = f"{name}:{max_width}"
    cached = await db.photo_cache.find_one({"_id": cache_key})
    if cached:
        return StreamingResponse(
            io.BytesIO(cached["data"]),
            media_type=cached.get("ctype", "image/jpeg"),
            headers={"Cache-Control": "public, max-age=604800, immutable"},
        )
    result = await places_service.fetch_place_photo(http_client, name, max_width)
    if not result:
        # Clé Google invalide/quota (403) ou photo disparue : au lieu d'un 404
        # (= carte grise dans l'app), on redirige vers une photo d'ambiance
        # déterministe par lieu pour que chaque bar garde un visuel différent.
        return RedirectResponse(
            url=places_service._fallback_photo(name.split("/photos/")[0]),
            status_code=302,
            headers={"Cache-Control": "public, max-age=3600"},
        )
    content, ctype = result
    # Recompress heavy payloads (Google can return >1.5MB PNGs) → JPEG q72
    if len(content) > 220_000:
        try:
            from PIL import Image as PILImage
            im = PILImage.open(io.BytesIO(content)).convert("RGB")
            if im.width > max_width:
                im = im.resize((max_width, int(im.height * max_width / im.width)))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=72, optimize=True)
            content, ctype = buf.getvalue(), "image/jpeg"
        except Exception:  # noqa: BLE001
            pass
    if len(content) < 1_000_000:
        try:
            await db.photo_cache.update_one(
                {"_id": cache_key},
                {"$set": {"data": content, "ctype": ctype, "cached_at": datetime.now(timezone.utc)}},
                upsert=True,
            )
        except Exception:  # noqa: BLE001
            pass
    return StreamingResponse(
        io.BytesIO(content),
        media_type=ctype,
        headers={"Cache-Control": "public, max-age=604800, immutable"},
    )


@api_router.get("/clubs/{club_id}")
async def get_club(club_id: str):
    # Try seed clubs first
    club = await db.clubs.find_one({"club_id": club_id}, {"_id": 0})
    if not club:
        # Try cached Google Places clubs (club_id format: "gp_<place_id>")
        club = await db.places.find_one({"club_id": club_id}, {"_id": 0})
        if not club and club_id.startswith("gp_") and http_client is not None:
            # Refresh from Google
            place_id = club_id[3:]
            club = await places_service.get_place_by_id(db, http_client, place_id)
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")
    # Phase 5 — owner stats: count profile views
    try:
        await db.club_stats.update_one({"club_id": club_id}, {"$inc": {"views": 1}}, upsert=True)
    except Exception:  # noqa: BLE001
        pass
    events = await db.events.find({"club_id": club_id}, {"_id": 0}).to_list(50)
    club["events"] = sorted(events, key=lambda e: e.get("date", ""))
    return club


# -------------- Events -------------- #


class CreateEventBody(BaseModel):
    title: str
    location_name: str
    location_address: str = ""
    visibility: str = "public"  # "public" | "friends_only"
    description: str = ""
    dj: str = ""
    date: str  # ISO datetime
    entry_price: float = 0.0
    photo: Optional[str] = None
    # Legacy / optional club association (kept for backward compatibility)
    club_id: Optional[str] = None


@api_router.post("/events", status_code=201)
async def create_event(body: CreateEventBody, user: dict = Depends(get_current_user)):
    # Premium-gated feature
    if not bool(user.get("is_premium")):
        raise HTTPException(status_code=402, detail="Réservé aux membres Premium")

    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Le titre est requis")
    if len(title) > 120:
        raise HTTPException(status_code=400, detail="Titre trop long (max 120)")
    location_name = body.location_name.strip()
    if not location_name:
        raise HTTPException(status_code=400, detail="Le lieu est requis")
    if body.visibility not in ("public", "friends_only"):
        raise HTTPException(status_code=400, detail="Visibilité invalide")
    # Validate date (must be ISO, in the future)
    try:
        d = datetime.fromisoformat(body.date.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Date invalide (format ISO requis)")
    if d <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="La date doit être dans le futur")
    event_id = f"evt_{uuid.uuid4().hex[:12]}"
    creator_name = user.get("name") or (
        f"@{user.get('username')}" if user.get("username") else "Anonyme"
    )
    doc = {
        "event_id": event_id,
        "club_id": body.club_id,  # may be None for user-created events
        "title": title,
        "location_name": location_name,
        "location_address": body.location_address.strip(),
        "visibility": body.visibility,
        "description": body.description.strip(),
        "dj": body.dj.strip(),
        "date": d.isoformat(),
        "entry_price": float(body.entry_price or 0.0),
        "photo": body.photo,
        "created_by": user["user_id"],
        "creator_name": creator_name,
        "creator_picture": user.get("picture"),
        "created_at": datetime.now(timezone.utc),
    }
    await db.events.insert_one(doc)
    doc.pop("_id", None)
    return {k: v for k, v in doc.items() if k != "created_at"}


@api_router.get("/events")
async def list_events(upcoming_only: bool = True, user: dict = Depends(get_current_user)):
    uid = user["user_id"]
    # Friends list (accepted) — used to scope friends_only events
    accepted = await db.friendships.find(
        {"status": "accepted", "$or": [{"from_user_id": uid}, {"to_user_id": uid}]},
        {"_id": 0},
    ).to_list(500)
    friend_ids: set[str] = set()
    for f in accepted:
        peer_id = f["to_user_id"] if f["from_user_id"] == uid else f["from_user_id"]
        friend_ids.add(peer_id)

    query: dict = {
        "$or": [
            {"visibility": {"$ne": "friends_only"}},
            {"created_by": uid},
            {"created_by": {"$in": list(friend_ids)}},
        ],
    }
    if upcoming_only:
        query["date"] = {"$gte": datetime.now(timezone.utc).isoformat()}
    events = await db.events.find(query, {"_id": 0}).to_list(500)
    # Enrich with club info (for legacy seeded events with club_id)
    club_ids = [e["club_id"] for e in events if e.get("club_id")]
    club_map: dict = {}
    if club_ids:
        async for c in db.clubs.find({"club_id": {"$in": club_ids}}, {"_id": 0}):
            club_map[c["club_id"]] = c
    for e in events:
        cid = e.get("club_id")
        c = club_map.get(cid) if cid else None
        if c:
            e["club_name"] = c.get("name")
            e["club_photo"] = (c.get("photos") or [None])[0]
            # For legacy events, expose location_name if missing
            if not e.get("location_name"):
                e["location_name"] = c.get("name")
            if not e.get("location_address"):
                e["location_address"] = c.get("address", "")
        e.setdefault("visibility", "public")
        # Consistent shape for user-created events without a club
        e.setdefault("club_name", None)
        e.setdefault("club_photo", None)
    events.sort(key=lambda e: e.get("date", ""))
    return events


@api_router.post("/events/{event_id}/reserve")
async def reserve_event(event_id: str, user: dict = Depends(get_current_user)):
    event = await db.events.find_one({"event_id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    res_id = f"res_{uuid.uuid4().hex[:10]}"
    await db.reservations.insert_one(
        {
            "reservation_id": res_id,
            "event_id": event_id,
            "user_id": user["user_id"],
            "created_at": datetime.now(timezone.utc),
            "status": "confirmed",
        }
    )
    return {"reservation_id": res_id, "status": "confirmed"}


# -------------- Favorites / Swipes -------------- #


@api_router.get("/favorites")
async def get_favorites(user: dict = Depends(get_current_user)):
    favs = await db.favorites.find(
        {"user_id": user["user_id"]}, {"_id": 0}
    ).to_list(500)
    club_ids = [f["club_id"] for f in favs]
    clubs = await db.clubs.find(
        {"club_id": {"$in": club_ids}}, {"_id": 0}
    ).to_list(500)
    return clubs


@api_router.post("/favorites/{club_id}")
async def add_favorite(club_id: str, user: dict = Depends(get_current_user)):
    await db.favorites.update_one(
        {"user_id": user["user_id"], "club_id": club_id},
        {"$set": {"created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"ok": True}


@api_router.delete("/favorites/{club_id}")
async def remove_favorite(club_id: str, user: dict = Depends(get_current_user)):
    await db.favorites.delete_one(
        {"user_id": user["user_id"], "club_id": club_id}
    )
    return {"ok": True}


@api_router.post("/swipes")
async def record_swipe(body: SwipeAction, user: dict = Depends(get_current_user)):
    await db.swipes.insert_one(
        {
            "user_id": user["user_id"],
            "club_id": body.club_id,
            "action": body.action,
            "created_at": datetime.now(timezone.utc),
        }
    )
    if body.action == "like":
        await db.favorites.update_one(
            {"user_id": user["user_id"], "club_id": body.club_id},
            {"$set": {"created_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
    return {"ok": True}


# ===================== User-to-user Swipe (Tinder-like) ===================== #

FREE_DAILY_SWIPE_LIMIT = 10
FREE_SUPERLIKES_PER_DAY = 1
PREMIUM_SUPERLIKES_PER_DAY = 5
BOOST_DURATION_MIN = 30


def _today_start_utc() -> datetime:
    n = datetime.now(timezone.utc)
    return n.replace(hour=0, minute=0, second=0, microsecond=0)


def _profile_for_swipe(u: dict) -> dict:
    """Public payload returned to other users in the swipe deck."""
    dob = u.get("dob")
    age = None
    if dob:
        try:
            d = datetime.strptime(dob, "%Y-%m-%d").date()
            today = datetime.now(timezone.utc).date()
            age = today.year - d.year - (
                (today.month, today.day) < (d.month, d.day)
            )
        except Exception:
            age = None
    return {
        "user_id": u["user_id"],
        "name": u.get("name", ""),
        "username": u.get("username"),
        "age": age,
        "bio": u.get("bio", ""),
        "city": u.get("city", ""),
        "instagram": u.get("instagram", ""),
        "photos": u.get("photos") or [],
        "music_prefs": u.get("music_prefs") or [],
        "fav_clubs": u.get("fav_clubs") or [],
        "verified": bool(u.get("verified")),
    }


def _is_profile_complete_for_swipe(u: dict) -> bool:
    if not u.get("photos") or len(u["photos"]) == 0:
        return False
    if not u.get("dob"):
        return False
    return True


async def _today_swipes_count(user_id: str) -> int:
    return await db.user_swipes.count_documents({
        "user_id": user_id,
        "created_at": {"$gte": _today_start_utc()},
    })


async def _today_superlikes_count(user_id: str) -> int:
    return await db.user_swipes.count_documents({
        "user_id": user_id,
        "action": "superlike",
        "created_at": {"$gte": _today_start_utc()},
    })


def _boost_active(u: dict) -> bool:
    bu = u.get("boost_until")
    if not bu:
        return False
    if getattr(bu, "tzinfo", None) is None:
        bu = bu.replace(tzinfo=timezone.utc)
    return bu > datetime.now(timezone.utc)


@api_router.get("/swipe/quota")
async def swipe_quota(user: dict = Depends(get_current_user)):
    used = await _today_swipes_count(user["user_id"])
    is_prem = bool(user.get("is_premium"))
    sl_limit = PREMIUM_SUPERLIKES_PER_DAY if is_prem else FREE_SUPERLIKES_PER_DAY
    sl_used = await _today_superlikes_count(user["user_id"])
    boost_until = user.get("boost_until")
    boost_active = _boost_active(user)
    likes_7d = await _likes_given_7d(user["user_id"])
    completion, _missing = _profile_completion(user)
    return {
        "used_today": used,
        "limit": None if is_prem else FREE_DAILY_SWIPE_LIMIT,
        "is_premium": is_prem,
        "remaining": None if is_prem else max(0, FREE_DAILY_SWIPE_LIMIT - used),
        "superlikes_limit": sl_limit,
        "superlikes_remaining": max(0, sl_limit - sl_used),
        "boost_active": boost_active,
        "boost_until": (
            boost_until.isoformat() if boost_active and hasattr(boost_until, "isoformat") else None
        ),
        # Boost d'activité Tinder-like : 10 likes envoyés (7 jours) = mise en avant
        "likes_given_7d": likes_7d,
        "activity_boost_target": ACTIVITY_BOOST_TARGET,
        "activity_boost_active": likes_7d >= ACTIVITY_BOOST_TARGET,
        "profile_completion": completion,
    }


# ---- Algorithme de mise en avant (Tinder-like) ----
ACTIVITY_BOOST_TARGET = 10  # liker 10 personnes → profil mis en avant


async def _likes_given_7d(user_id: str) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    return await db.user_swipes.count_documents({
        "user_id": user_id,
        "action": {"$in": ["like", "superlike"]},
        "created_at": {"$gte": cutoff},
    })


_COMPLETION_FIELDS = [
    # (label affiché, points, test)
    ("Ajoute une photo", 25, lambda u: bool(u.get("photos"))),
    ("Ajoute 3 photos", 10, lambda u: len(u.get("photos") or []) >= 3),
    ("Écris une bio", 20, lambda u: bool((u.get("bio") or "").strip())),
    ("Renseigne ta date de naissance", 15, lambda u: bool(u.get("dob"))),
    ("Indique ta ville", 10, lambda u: bool((u.get("city") or "").strip())),
    ("Ajoute tes goûts musicaux", 10, lambda u: bool(u.get("music_prefs"))),
    ("Lie ton Instagram", 5, lambda u: bool((u.get("instagram") or "").strip())),
    ("Ajoute tes clubs favoris", 5, lambda u: bool(u.get("fav_clubs"))),
]


def _profile_completion(u: dict) -> tuple[int, list[str]]:
    """Pourcentage de complétion du profil + liste des étapes manquantes."""
    score = 0
    missing: list[str] = []
    for label, points, test in _COMPLETION_FIELDS:
        try:
            ok = bool(test(u))
        except Exception:
            ok = False
        if ok:
            score += points
        else:
            missing.append(label)
    return min(100, score), missing


@api_router.get("/me/profile-completion")
async def me_profile_completion(user: dict = Depends(get_current_user)):
    percent, missing = _profile_completion(user)
    return {"percent": percent, "missing": missing}


# ---- GIFs (Tenor v2 proxy — clé côté serveur uniquement) ----
TENOR_API_KEY = (
    os.environ.get("TENOR_API_KEY", "").strip().strip('"')
    or os.environ.get("GOOGLE_PLACES_API_KEY", "").strip().strip('"')
)


@api_router.get("/gifs/search")
async def gifs_search(
    q: str = Query(min_length=1, max_length=50),
    pos: str = Query(default="", max_length=200),
    user: dict = Depends(get_current_user),
):
    if not TENOR_API_KEY:
        raise HTTPException(status_code=503, detail="Recherche GIF non configurée (clé Tenor manquante)")
    params: dict = {
        "key": TENOR_API_KEY,
        "client_key": "nightfinder_chat",
        "q": q,
        "limit": 24,
        "locale": "fr_FR",
        "country": "FR",
        "contentfilter": "medium",
        "media_filter": "tinygif,gif",
    }
    if pos:
        params["pos"] = pos
    try:
        r = await http_client.get("https://tenor.googleapis.com/v2/search", params=params, timeout=8.0)
        r.raise_for_status()
        payload = r.json()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            raise HTTPException(status_code=503, detail="Clé Tenor invalide — active l'API Tenor dans Google Cloud")
        raise HTTPException(status_code=502, detail="Erreur du fournisseur GIF")
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Fournisseur GIF indisponible")
    results = []
    for item in payload.get("results", []):
        fmts = item.get("media_formats", {})
        tiny = fmts.get("tinygif", {})
        full = fmts.get("gif", {}) or tiny
        if tiny.get("url") and full.get("url"):
            results.append({
                "id": str(item.get("id", "")),
                "preview_url": tiny["url"],
                "url": full["url"],
            })
    return {"results": results, "next": payload.get("next", "")}


# ---- Personnalisation du chat (Premium) ----
CHAT_THEMES = ["nuit", "neon", "or", "ocean", "sunset"]


class ChatThemeBody(BaseModel):
    theme: str


@api_router.put("/me/chat-theme")
async def set_chat_theme(body: ChatThemeBody, user: dict = Depends(get_current_user)):
    if body.theme not in CHAT_THEMES:
        raise HTTPException(status_code=400, detail="Thème inconnu")
    if body.theme != "nuit" and not user.get("is_premium"):
        raise HTTPException(status_code=403, detail="La personnalisation du chat est réservée aux membres Premium 💎")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"chat_theme": body.theme}})
    return {"ok": True, "theme": body.theme}


@api_router.get("/swipe/likes-hub")
async def swipe_likes_hub(user: dict = Depends(get_current_user)):
    """Hub Tinder-like : qui m'a liké / super-liké + demandes de messages.
    Les photos des likes sont floutées côté client pour les non-premium."""
    me = user["user_id"]
    blocked = await _blocked_user_ids(me)
    # Personnes que J'AI déjà swipées (like/pass) → ne plus les montrer ici
    my_swipes = await db.user_swipes.find(
        {"user_id": me}, {"_id": 0, "target_user_id": 1}
    ).to_list(2000)
    i_swiped = {s["target_user_id"] for s in my_swipes}
    # Matches existants → déjà convertis, on ne les liste plus
    matched_ids: set = set()
    async for mrow in db.matches.find(
        {"$or": [{"user_a": me}, {"user_b": me}]}, {"_id": 0, "user_a": 1, "user_b": 1}
    ):
        matched_ids.add(mrow["user_a"] if mrow["user_b"] == me else mrow["user_b"])

    # Likes reçus (like + superlike), les plus récents d'abord
    rows = await db.user_swipes.find(
        {"target_user_id": me, "action": {"$in": ["like", "superlike"]}},
        {"_id": 0, "user_id": 1, "action": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(200)
    seen: set = set()
    liker_entries: list[dict] = []
    for r in rows:
        uid = r["user_id"]
        if uid in seen or uid in blocked or uid in i_swiped or uid in matched_ids:
            continue
        seen.add(uid)
        liker_entries.append(r)
    liker_ids = [r["user_id"] for r in liker_entries[:60]]
    users_map: dict = {}
    async for u in db.users.find(
        {"user_id": {"$in": liker_ids}, "is_virtual": {"$ne": True}}, {"_id": 0}
    ):
        users_map[u["user_id"]] = u
    likes: list[dict] = []
    superlikes: list[dict] = []
    for r in liker_entries:
        u = users_map.get(r["user_id"])
        if not u:
            continue
        p = _profile_for_swipe(u)
        p["liked_at"] = r["created_at"].isoformat() if hasattr(r.get("created_at"), "isoformat") else None
        (superlikes if r["action"] == "superlike" else likes).append(p)

    # Demandes de messages en attente (match_requests non-superlike → demandes)
    req_rows = await db.match_requests.find(
        {"to_user_id": me, "status": "pending"}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    req_ids = [r["from_user_id"] for r in req_rows if r["from_user_id"] not in blocked]
    req_map: dict = {}
    async for u in db.users.find({"user_id": {"$in": req_ids}}, {"_id": 0}):
        req_map[u["user_id"]] = u
    requests_out = []
    for r in req_rows:
        u = req_map.get(r["from_user_id"])
        if not u:
            continue
        p = _profile_for_swipe(u)
        p["request_id"] = r.get("request_id")
        p["superlike"] = bool(r.get("superlike"))
        p["message"] = r.get("message")
        requests_out.append(p)

    return {
        "is_premium": bool(user.get("is_premium")),
        "likes": likes,
        "superlikes": superlikes,
        "requests": requests_out,
        "likes_count": len(likes),
        "superlikes_count": len(superlikes),
    }


@api_router.get("/swipe/deck")
async def swipe_deck(
    same_club: bool = False,
    user: dict = Depends(get_current_user),
):
    """Return up to 10 profiles the user has not swiped on yet (and is not
    themself). Hidden users, blocked users and profiles missing the minimum
    data are skipped.

    When ``same_club=true`` we restrict the deck to users currently checked
    in at the same club AND whose visibility allows it. This powers the
    "Swipe en club" feature (onboarding slide #03).
    """
    # Already swiped target ids
    already = await db.user_swipes.find(
        {"user_id": user["user_id"]}, {"_id": 0, "target_user_id": 1},
    ).to_list(1000)
    exclude = {s["target_user_id"] for s in already}
    exclude.add(user["user_id"])
    # Filter out blocked users (both directions) — Apple 1.2 UGC
    exclude |= await _blocked_user_ids(user["user_id"])

    extra_filter: dict = {}
    if same_club:
        # Find user's most recent confirmed check-in (last 4 hours)
        from datetime import timedelta as _td  # local import to avoid global churn
        cutoff = datetime.now(timezone.utc) - _td(hours=4)
        my_ci = await db.checkins.find_one(
            {
                "user_id": user["user_id"],
                "confirmed": True,
                "created_at": {"$gte": cutoff},
            },
            sort=[("created_at", -1)],
        )
        if not my_ci:
            return []  # not currently in a club
        # Find everyone else currently in that same club
        peer_cursor = db.checkins.find(
            {
                "club_id": my_ci["club_id"],
                "confirmed": True,
                "created_at": {"$gte": cutoff},
                "user_id": {"$ne": user["user_id"]},
            },
            {"_id": 0, "user_id": 1},
        )
        peer_ids = [c["user_id"] async for c in peer_cursor]
        if not peer_ids:
            return []
        extra_filter["user_id"] = {"$in": peer_ids, "$nin": list(exclude)}
        # Only public profiles can be swiped in-club (visibility != hidden,
        # not private). We treat visibility=="hidden" or "private" as opt-out.
        extra_filter["visibility"] = {"$nin": ["hidden", "private"]}
    else:
        extra_filter["user_id"] = {"$nin": list(exclude)}
        extra_filter["visibility"] = {"$ne": "hidden"}

    cursor = db.users.find(
        {
            **extra_filter,
            "photos": {"$exists": True, "$ne": []},
            "is_virtual": {"$ne": True},
        },
        {"_id": 0},
    ).limit(50)
    candidates: list[dict] = []
    # Préférences de découverte du viewer (âge / genre / distance)
    pref_gender = user.get("pref_gender") or "tous"
    pref_age_min = user.get("pref_age_min") or 18
    pref_age_max = user.get("pref_age_max") or 99
    pref_dist = user.get("pref_distance_km") or 0  # 0 = illimité
    my_loc = user.get("location") or {}
    gender_map = {"femmes": "femme", "hommes": "homme"}
    async for u in cursor:
        if not _is_profile_complete_for_swipe(u):
            continue
        # Genre
        if pref_gender in gender_map and (u.get("gender") or "") not in ("", gender_map[pref_gender]):
            continue
        # Âge
        p = _profile_for_swipe(u)
        if p.get("age") is not None and not (pref_age_min <= p["age"] <= pref_age_max):
            continue
        # Distance (seulement si les deux positions sont connues)
        if pref_dist and my_loc.get("lat") is not None:
            uloc = u.get("location") or {}
            if uloc.get("lat") is not None:
                if haversine_km(my_loc["lat"], my_loc["lng"], uloc["lat"], uloc["lng"]) > pref_dist:
                    continue
        candidates.append(u)
    # Users who super-liked me float to the top (Tinder-style), then boosted,
    # then "boost d'activité" (10+ likes envoyés sur 7 jours), then profils
    # les plus complets.
    sl_rows = await db.match_requests.find(
        {"to_user_id": user["user_id"], "status": "pending", "superlike": True},
        {"_id": 0, "from_user_id": 1},
    ).to_list(50)
    sl_ids = {r["from_user_id"] for r in sl_rows}

    # Boost d'activité : batch count des likes donnés (7j) par candidat
    cand_ids = [u["user_id"] for u in candidates]
    active_ids: set = set()
    if cand_ids:
        cutoff7 = datetime.now(timezone.utc) - timedelta(days=7)
        pipeline = [
            {"$match": {
                "user_id": {"$in": cand_ids},
                "action": {"$in": ["like", "superlike"]},
                "created_at": {"$gte": cutoff7},
            }},
            {"$group": {"_id": "$user_id", "n": {"$sum": 1}}},
        ]
        async for row in db.user_swipes.aggregate(pipeline):
            if row["n"] >= ACTIVITY_BOOST_TARGET:
                active_ids.add(row["_id"])

    candidates.sort(key=lambda u: (
        u["user_id"] not in sl_ids,          # 1. super-likers d'abord
        not _boost_active(u),                 # 2. boost payant
        u["user_id"] not in active_ids,       # 3. boost d'activité (10 likes)
        -_profile_completion(u)[0],           # 4. profils les plus complets
    ))
    candidates = candidates[:10]
    deck = [_profile_for_swipe(u) for u in candidates]
    for p in deck:
        if p["user_id"] in sl_ids:
            p["superliked_you"] = True
    return deck


class UserSwipeBody(BaseModel):
    target_user_id: str


@api_router.post("/swipe/like")
async def swipe_like(body: UserSwipeBody, user: dict = Depends(get_current_user)):
    return await _user_swipe(body.target_user_id, "like", user)


@api_router.post("/swipe/pass")
async def swipe_pass(body: UserSwipeBody, user: dict = Depends(get_current_user)):
    return await _user_swipe(body.target_user_id, "pass", user)


@api_router.post("/swipe/superlike")
async def swipe_superlike(body: UserSwipeBody, user: dict = Depends(get_current_user)):
    """Tinder-style Super Like — daily quota (1 free / 5 premium)."""
    sl_limit = PREMIUM_SUPERLIKES_PER_DAY if user.get("is_premium") else FREE_SUPERLIKES_PER_DAY
    used = await _today_superlikes_count(user["user_id"])
    if used >= sl_limit:
        raise HTTPException(
            status_code=429,
            detail=f"Plus de Super Likes aujourd'hui ({sl_limit}/jour). Reviens demain !",
        )
    return await _user_swipe(body.target_user_id, "superlike", user)


@api_router.post("/swipe/rewind")
async def swipe_rewind(user: dict = Depends(get_current_user)):
    """Undo the last swipe (Premium only). Returns the profile to re-stack."""
    if not user.get("is_premium"):
        raise HTTPException(status_code=402, detail="Le Rewind est réservé aux membres Premium.")
    last = await db.user_swipes.find_one(
        {"user_id": user["user_id"]}, sort=[("created_at", -1)]
    )
    if not last:
        raise HTTPException(status_code=404, detail="Aucun swipe à annuler.")
    target_id = last["target_user_id"]
    # If the like already turned into a match, don't undo it
    if last.get("action") in ("like", "superlike"):
        mr = await db.match_requests.find_one(
            {"from_user_id": user["user_id"], "to_user_id": target_id}
        )
        if mr and mr.get("status") == "accepted":
            raise HTTPException(status_code=409, detail="Impossible : vous avez déjà matché.")
        if mr and mr.get("status") == "pending":
            await db.match_requests.delete_one({"request_id": mr["request_id"]})
    await db.user_swipes.delete_one({"swipe_id": last["swipe_id"]})
    target = await db.users.find_one({"user_id": target_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Profil introuvable")
    return {"ok": True, "action": last.get("action"), "profile": _profile_for_swipe(target)}


@api_router.post("/swipe/boost")
async def swipe_boost(user: dict = Depends(get_current_user)):
    """Boost (Premium only) — profile shown first in decks for 30 min. 1/day."""
    if not user.get("is_premium"):
        raise HTTPException(status_code=402, detail="Le Boost est réservé aux membres Premium.")
    if _boost_active(user):
        raise HTTPException(status_code=409, detail="Un Boost est déjà actif.")
    today = _today_start_utc()
    lb = user.get("last_boost_at")
    if lb is not None:
        if getattr(lb, "tzinfo", None) is None:
            lb = lb.replace(tzinfo=timezone.utc)
        if lb >= today:
            raise HTTPException(status_code=429, detail="Tu as déjà utilisé ton Boost aujourd'hui.")
    now = datetime.now(timezone.utc)
    until = now + timedelta(minutes=BOOST_DURATION_MIN)
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"boost_until": until, "last_boost_at": now}},
    )
    return {"ok": True, "boost_until": until.isoformat(), "duration_min": BOOST_DURATION_MIN}


async def _user_swipe(target_user_id: str, action: str, user: dict) -> dict:
    if target_user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="On ne se swipe pas soi-même")
    if action not in ("like", "pass", "superlike"):
        raise HTTPException(status_code=400, detail="Action invalide")
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Profil introuvable")
    # Daily limit for free users
    if not bool(user.get("is_premium")):
        used = await _today_swipes_count(user["user_id"])
        if used >= FREE_DAILY_SWIPE_LIMIT:
            raise HTTPException(
                status_code=402,
                detail=f"Limite quotidienne atteinte ({FREE_DAILY_SWIPE_LIMIT}/jour). Passe Premium pour swiper sans limite.",
            )
    # Idempotency: prevent double-swipe on same target
    existing = await db.user_swipes.find_one(
        {"user_id": user["user_id"], "target_user_id": target_user_id}
    )
    if existing:
        return {"ok": True, "already_swiped": True}
    await db.user_swipes.insert_one({
        "swipe_id": f"sw_{uuid.uuid4().hex[:10]}",
        "user_id": user["user_id"],
        "target_user_id": target_user_id,
        "action": action,
        "created_at": datetime.now(timezone.utc),
    })
    if action in ("like", "superlike"):
        is_super = action == "superlike"
        # ---- INSTANT MATCH (Tinder-style): the target already liked me ----
        reverse = await db.match_requests.find_one(
            {"from_user_id": target_user_id, "to_user_id": user["user_id"], "status": "pending"}
        )
        if reverse:
            await db.match_requests.update_one(
                {"request_id": reverse["request_id"]},
                {"$set": {"status": "accepted", "accepted_at": datetime.now(timezone.utc)}},
            )
            pair_a, pair_b = sorted([user["user_id"], target_user_id])
            existing_m = await db.matches.find_one({"user_a": pair_a, "user_b": pair_b})
            if existing_m:
                match_id = existing_m["match_id"]
            else:
                match_id = f"mt_{uuid.uuid4().hex[:10]}"
                await db.matches.insert_one({
                    "match_id": match_id,
                    "user_a": pair_a,
                    "user_b": pair_b,
                    "created_at": datetime.now(timezone.utc),
                    "last_message_at": datetime.now(timezone.utc),
                })
            my_name = user.get("name") or "Quelqu'un"
            await db.notifications.insert_one({
                "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
                "user_id": target_user_id,
                "title": "C'est un match ! 💞",
                "body": f"{my_name} t'a liké en retour. Lance la conversation !",
                "type": "match_accepted",
                "data": {"match_id": match_id, "with_user_id": user["user_id"]},
                "created_at": datetime.now(timezone.utc),
            })
            try:
                await push_service.send_push(
                    recipients=[target_user_id],
                    title="C'est un match ! 💞",
                    message=f"{my_name} t'a liké en retour !",
                    action_url=f"/chat/{match_id}",
                    idempotency_key=f"ma_{match_id}",
                )
            except Exception as e:
                logger.warning("push (instant match) failed: %s", e)
            return {
                "ok": True,
                "matched": True,
                "match_id": match_id,
                "peer": {
                    "user_id": target_user_id,
                    "name": target.get("name", ""),
                    "photo": (target.get("photos") or [None])[0],
                },
            }
        # ---- No mutual like yet: create/refresh a match request ----
        mr_id = f"mr_{uuid.uuid4().hex[:10]}"
        await db.match_requests.update_one(
            {"from_user_id": user["user_id"], "to_user_id": target_user_id},
            {
                "$setOnInsert": {
                    "request_id": mr_id,
                    "from_user_id": user["user_id"],
                    "to_user_id": target_user_id,
                    "status": "pending",
                    "created_at": datetime.now(timezone.utc),
                },
                **({"$set": {"superlike": True}} if is_super else {}),
            },
            upsert=True,
        )
        sender_name = user.get("name") or (
            f"@{user.get('username')}" if user.get("username") else "Quelqu'un"
        )
        notif_title = "⭐ Quelqu'un t'a super-liké !" if is_super else "Quelqu'un veut te matcher 💘"
        notif_body = (
            f"{sender_name} t'a envoyé un Super Like !" if is_super
            else f"{sender_name} a aimé ton profil."
        )
        # Normal flow: in-app notification to the real target user
        await db.notifications.insert_one({
            "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
            "user_id": target_user_id,
            "title": notif_title,
            "body": notif_body,
            "type": "match_request",
            "data": {"from_user_id": user["user_id"], "superlike": is_super},
            "created_at": datetime.now(timezone.utc),
        })
        try:
            await push_service.send_push(
                recipients=[target_user_id],
                title=notif_title,
                message=notif_body,
                action_url="/match-requests",
                idempotency_key=f"mr_{user['user_id']}_{target_user_id}",
            )
        except Exception as e:
            logger.warning("push (match_request) failed: %s", e)
    return {"ok": True, "matched": False}


# ===================== Profile / Swipe fields ===================== #


class SwipeFieldsBody(BaseModel):
    dob: Optional[str] = None
    bio: Optional[str] = None
    city: Optional[str] = None
    instagram: Optional[str] = None
    photos: Optional[list[str]] = None  # base64 strings, max 3
    fav_clubs: Optional[list[str]] = None  # club_ids
    # Préférences de découverte (Tinder-like)
    gender: Optional[str] = None  # femme | homme | autre
    pref_gender: Optional[str] = None  # femmes | hommes | tous
    pref_age_min: Optional[int] = None  # 18-99
    pref_age_max: Optional[int] = None
    pref_distance_km: Optional[int] = None  # 0 = illimité


@api_router.put("/profile/swipe-fields")
async def update_swipe_fields(body: SwipeFieldsBody, user: dict = Depends(get_current_user)):
    updates: dict = {}
    if body.dob is not None:
        try:
            d = datetime.strptime(body.dob, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Date invalide (YYYY-MM-DD)")
        today = datetime.now(timezone.utc).date()
        age = today.year - d.year - ((today.month, today.day) < (d.month, d.day))
        if age < 18:
            raise HTTPException(status_code=400, detail="Tu dois avoir 18 ans ou plus")
        if age > 120:
            raise HTTPException(status_code=400, detail="Date invalide")
        updates["dob"] = body.dob
    if body.bio is not None:
        if len(body.bio) > 500:
            raise HTTPException(status_code=400, detail="Bio trop longue (max 500)")
        updates["bio"] = body.bio.strip()
    if body.city is not None:
        if len(body.city) > 80:
            raise HTTPException(status_code=400, detail="Ville trop longue")
        updates["city"] = body.city.strip()
    if body.instagram is not None:
        # Strip leading @ and validate handle
        h = body.instagram.strip().lstrip("@")
        if h and not _re.match(r"^[A-Za-z0-9._]{1,30}$", h):
            raise HTTPException(status_code=400, detail="Handle Instagram invalide")
        updates["instagram"] = h
    # Préférences de découverte
    if body.gender is not None:
        if body.gender not in ("femme", "homme", "autre", ""):
            raise HTTPException(status_code=400, detail="Genre invalide")
        updates["gender"] = body.gender
    if body.pref_gender is not None:
        if body.pref_gender not in ("femmes", "hommes", "tous"):
            raise HTTPException(status_code=400, detail="Préférence invalide")
        updates["pref_gender"] = body.pref_gender
    if body.pref_age_min is not None:
        updates["pref_age_min"] = max(18, min(99, body.pref_age_min))
    if body.pref_age_max is not None:
        updates["pref_age_max"] = max(18, min(99, body.pref_age_max))
    if body.pref_distance_km is not None:
        updates["pref_distance_km"] = max(0, min(500, body.pref_distance_km))
    if body.photos is not None:
        if len(body.photos) > 3:
            raise HTTPException(status_code=400, detail="3 photos maximum")
        # Reject photos heavier than ~2MB each (base64 inflate ~33%)
        for p in body.photos:
            if not isinstance(p, str) or len(p) > 3_000_000:
                raise HTTPException(status_code=413, detail="Photo trop lourde (max 2MB)")
        # AI moderation: scan each photo. Only previously-saved photos are
        # exempt (we trust what's already in DB to keep retries cheap).
        existing_set = set((user.get("photos") or []))
        from moderation_service import moderate_image, violation_label
        moderation_results: list[dict] = []
        for idx, p in enumerate(body.photos):
            if p in existing_set:
                moderation_results.append({"index": idx, "skipped": True, "reason": "already_saved"})
                continue
            verdict = await moderate_image(p, session_id=f"sf-{user['user_id']}-{idx}")
            moderation_results.append({"index": idx, **verdict})
            if not verdict.get("safe", True):
                label = violation_label(verdict)
                logger.warning(
                    "moderation_reject user=%s idx=%s verdict=%s",
                    user["user_id"], idx, verdict,
                )
                raise HTTPException(
                    status_code=400,
                    detail=f"Photo {idx + 1} refusée par la modération : {label}. Choisis une autre image.",
                )
        updates["photos"] = body.photos
    if body.fav_clubs is not None:
        if len(body.fav_clubs) > 10:
            raise HTTPException(status_code=400, detail="10 clubs favoris maximum")
        updates["fav_clubs"] = body.fav_clubs
    if not updates:
        return {"ok": True, "updated": []}
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    return {"ok": True, "updated": list(updates.keys())}


# ===================== Match requests + Matches + Chat ===================== #


def _other_user_id(m: dict, me: str) -> str:
    return m["user_b"] if m["user_a"] == me else m["user_a"]


@api_router.get("/match-requests")
async def list_match_requests(user: dict = Depends(get_current_user)):
    """Pending likes received by this user (someone right-swiped me)."""
    blocked = await _blocked_user_ids(user["user_id"])
    cursor = db.match_requests.find(
        {
            "to_user_id": user["user_id"],
            "status": "pending",
            "from_user_id": {"$nin": list(blocked)} if blocked else {"$exists": True},
        },
        {"_id": 0},
    ).sort("created_at", -1).limit(50)
    items = await cursor.to_list(50)
    if not items:
        return []
    user_ids = [it["from_user_id"] for it in items]
    users = await db.users.find({"user_id": {"$in": user_ids}}, {"_id": 0}).to_list(200)
    umap = {u["user_id"]: _profile_for_swipe(u) for u in users}
    out = []
    for it in items:
        p = umap.get(it["from_user_id"])
        if p:
            out.append({**p, "request_id": it["request_id"], "created_at": it.get("created_at"), "superlike": bool(it.get("superlike"))})
    return out


class MatchActionBody(BaseModel):
    request_id: str


@api_router.post("/match-requests/accept")
async def accept_match(body: MatchActionBody, user: dict = Depends(get_current_user)):
    mr = await db.match_requests.find_one(
        {"request_id": body.request_id, "to_user_id": user["user_id"], "status": "pending"}
    )
    if not mr:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    await db.match_requests.update_one(
        {"request_id": body.request_id},
        {"$set": {"status": "accepted", "accepted_at": datetime.now(timezone.utc)}},
    )
    sender_id = mr["from_user_id"]
    # Avoid duplicate match
    pair_a, pair_b = sorted([user["user_id"], sender_id])
    match_id = f"mt_{uuid.uuid4().hex[:10]}"
    existing = await db.matches.find_one({"user_a": pair_a, "user_b": pair_b})
    if existing:
        match_id = existing["match_id"]
    else:
        await db.matches.insert_one({
            "match_id": match_id,
            "user_a": pair_a,
            "user_b": pair_b,
            "created_at": datetime.now(timezone.utc),
            "last_message_at": datetime.now(timezone.utc),
        })
    # Notify sender
    accepter_name = user.get("name") or "Quelqu'un"
    await db.notifications.insert_one({
        "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
        "user_id": sender_id,
        "title": "Nouveau match 💞",
        "body": f"{accepter_name} a accepté ton like ! Lance la conversation.",
        "type": "match_accepted",
        "data": {"match_id": match_id, "with_user_id": user["user_id"]},
        "created_at": datetime.now(timezone.utc),
    })
    try:
        await push_service.send_push(
            recipients=[sender_id],
            title="Nouveau match 💞",
            message=f"{accepter_name} a accepté ton like !",
            action_url=f"/chat/{match_id}",
            idempotency_key=f"ma_{match_id}",
        )
    except Exception as e:
        logger.warning("push (match_accepted) failed: %s", e)
    return {"ok": True, "match_id": match_id}


@api_router.post("/match-requests/reject")
async def reject_match(body: MatchActionBody, user: dict = Depends(get_current_user)):
    res = await db.match_requests.update_one(
        {"request_id": body.request_id, "to_user_id": user["user_id"], "status": "pending"},
        {"$set": {"status": "rejected", "rejected_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    return {"ok": True}


@api_router.get("/matches")
async def list_matches(user: dict = Depends(get_current_user)):
    uid = user["user_id"]
    cursor = db.matches.find(
        {"$or": [{"user_a": uid}, {"user_b": uid}]}, {"_id": 0}
    ).sort("last_message_at", -1).limit(100)
    items = await cursor.to_list(100)
    if not items:
        return []
    peer_ids = list({_other_user_id(m, uid) for m in items})
    users = await db.users.find({"user_id": {"$in": peer_ids}}, {"_id": 0}).to_list(200)
    umap = {u["user_id"]: u for u in users}
    match_ids = [m["match_id"] for m in items]
    last_msgs = await db.messages.aggregate([
        {"$match": {"match_id": {"$in": match_ids}}},
        {"$sort": {"created_at": -1}},
        {"$group": {"_id": "$match_id", "text": {"$first": "$text"}, "created_at": {"$first": "$created_at"}}},
    ]).to_list(len(match_ids))
    lmap = {lm["_id"]: lm for lm in last_msgs}
    unread_agg = await db.messages.aggregate([
        {"$match": {"match_id": {"$in": match_ids}, "from_user_id": {"$ne": uid}, "read_at": {"$exists": False}}},
        {"$group": {"_id": "$match_id", "n": {"$sum": 1}}},
    ]).to_list(len(match_ids))
    unread_map = {u["_id"]: u["n"] for u in unread_agg}
    out = []
    for m in items:
        peer = umap.get(_other_user_id(m, uid))
        if not peer:
            continue
        last = lmap.get(m["match_id"])
        out.append({
            "match_id": m["match_id"],
            "with_user_id": peer["user_id"],
            "name": peer.get("name", ""),
            "photo": (peer.get("photos") or [None])[0],
            "last_message": (last or {}).get("text"),
            "last_at": (last or {}).get("created_at") or m.get("last_message_at"),
            "unread": unread_map.get(m["match_id"], 0),
        })
    return out


@api_router.get("/matches/unread-count")
async def matches_unread_count(user: dict = Depends(get_current_user)):
    """Total number of unread chat messages across all matches (for tab badge)."""
    uid = user["user_id"]
    matches = await db.matches.find(
        {"$or": [{"user_a": uid}, {"user_b": uid}]}, {"_id": 0, "match_id": 1}
    ).to_list(200)
    ids = [m["match_id"] for m in matches]
    if not ids:
        return {"unread": 0}
    c = await db.messages.count_documents(
        {"match_id": {"$in": ids}, "from_user_id": {"$ne": uid}, "read_at": {"$exists": False}}
    )
    return {"unread": c}


# ═══════════════ Activity / Engagement pulse (Night Finder 3.0) ═══════════════

def _pseudo_live_count(club_id: str) -> int:
    """Deterministic per-hour 'people on site' count — boosted for engagement."""
    now = datetime.now(timezone.utc)
    seed = f"{club_id}:{now.strftime('%Y%m%d%H')}"
    h = int(hashlib.md5(seed.encode()).hexdigest()[:8], 16)
    local_hour = (now.hour + 2) % 24  # ~Europe/Paris
    if local_hour >= 22 or local_hour < 5:
        return 90 + h % 160
    if local_hour >= 18:
        return 30 + h % 80
    return 5 + h % 25


@api_router.get("/activity/live")
async def activity_live(club_ids: str, user: dict = Depends(get_current_user)):
    """Live 'people here' counts for a list of clubs (real check-ins + boost)."""
    ids = [c.strip() for c in club_ids.split(",") if c.strip()][:40]
    since = datetime.now(timezone.utc) - timedelta(hours=4)
    counts: dict = {}
    for cid in ids:
        real = await db.checkins.count_documents({"club_id": cid, "created_at": {"$gte": since}})
        counts[cid] = real + _pseudo_live_count(cid)
    return {"counts": counts}


@api_router.get("/activity/pulse")
async def activity_pulse(
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    user: dict = Depends(get_current_user),
):
    """One rotating engagement item for the in-app pop-up banners."""
    kind = random.choice(["hot_club", "hot_club", "new_user", "people_tonight"])

    if kind == "hot_club":
        match: dict = {"rating": {"$gte": 4.2}, "photos.0": {"$exists": True}}
        if lat is not None and lng is not None:
            match["lat"] = {"$gte": lat - 0.35, "$lte": lat + 0.35}
            match["lng"] = {"$gte": lng - 0.5, "$lte": lng + 0.5}
        docs = await db.places.aggregate([{"$match": match}, {"$sample": {"size": 1}}]).to_list(1)
        if not docs:
            docs = await db.places.aggregate(
                [{"$match": {"rating": {"$gte": 4.2}}}, {"$sample": {"size": 1}}]
            ).to_list(1)
        if docs:
            place = docs[0]
            n = _pseudo_live_count(place["club_id"])
            return {
                "type": "hot_club",
                "emoji": "🔥",
                "title": f"Ça bouge au {place['name']}",
                "body": f"{n} personnes sont actuellement sur place",
                "route": f"/club/{place['club_id']}",
            }
        kind = "people_tonight"

    if kind == "new_user":
        docs = await db.users.aggregate([
            {"$match": {
                "user_id": {"$ne": user["user_id"]},
                "is_admin": {"$ne": True},
                "name": {
                    "$exists": True,
                    "$nin": [None, ""],
                    "$not": {"$regex": "test|admin|reviewer|demo", "$options": "i"},
                },
            }},
            {"$sample": {"size": 1}},
        ]).to_list(1)
        if docs:
            u = docs[0]
            first = (u.get("name") or "Quelqu'un").split(" ")[0]
            photo = (u.get("photos") or [None])[0]
            image = photo if isinstance(photo, str) and photo.startswith("http") else None
            return {
                "type": "new_user",
                "emoji": "👋",
                "title": f"{first} vient de rejoindre Night Finder",
                "body": "Passe dire bonjour sur le swipe",
                "image": image,
                "route": "/(tabs)/swipe",
            }
        kind = "people_tonight"

    seed = datetime.now(timezone.utc).strftime("%Y%m%d%H")
    n = 120 + int(hashlib.md5(seed.encode()).hexdigest()[:6], 16) % 380
    return {
        "type": "people_tonight",
        "emoji": "🎉",
        "title": f"{n} personnes sortent ce soir près de toi",
        "body": "Ouvre la carte pour voir où ça se passe",
        "route": "/(tabs)/map",
    }


@api_router.get("/tonight/plan")
async def tonight_plan(
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    user: dict = Depends(get_current_user),
):
    """Mode Soirée « Ce soir je sors » : club recommandé + alternatives + amis."""
    prefs_lower = {str(p).lower() for p in (user.get("music_prefs") or [])}
    q: dict = {"rating": {"$gte": 4.0}, "photos.0": {"$exists": True}}
    if lat is not None and lng is not None:
        q["lat"] = {"$gte": lat - 0.3, "$lte": lat + 0.3}
        q["lng"] = {"$gte": lng - 0.45, "$lte": lng + 0.45}
    docs = await db.places.find(q, {"_id": 0}).sort("rating", -1).limit(60).to_list(60)
    if not docs:
        docs = await db.places.find(
            {"rating": {"$gte": 4.2}, "photos.0": {"$exists": True}}, {"_id": 0}
        ).sort("rating", -1).limit(30).to_list(30)

    def _score(c: dict) -> float:
        s = float(c.get("rating") or 0)
        styles = {str(m).lower() for m in (c.get("music_styles") or [])}
        if prefs_lower & styles:
            s += 1.5
        if "night_club" in (c.get("types") or []):
            s += 0.6
        return s

    docs.sort(key=_score, reverse=True)
    out_clubs = []
    for c in docs[:4]:
        dist = None
        if lat is not None and lng is not None and c.get("lat") is not None:
            dist = round(haversine_km(lat, lng, c["lat"], c["lng"]), 1)
        out_clubs.append({
            "club_id": c["club_id"],
            "name": c.get("name"),
            "photo": (c.get("photos") or [None])[0],
            "address": c.get("address"),
            "rating": c.get("rating"),
            "music_styles": (c.get("music_styles") or [])[:3],
            "distance_km": dist,
            "lat": c.get("lat"),
            "lng": c.get("lng"),
            "live": _pseudo_live_count(c["club_id"]),
        })

    uid = user["user_id"]
    ms = await db.matches.find(
        {"$or": [{"user_a": uid}, {"user_b": uid}]}, {"_id": 0}
    ).sort("last_message_at", -1).limit(30).to_list(30)
    peer_ids = list({_other_user_id(m, uid) for m in ms})
    peers = await db.users.find({"user_id": {"$in": peer_ids}}, {"_id": 0}).to_list(60)
    pmap = {p["user_id"]: p for p in peers}
    friends = []
    for m in ms:
        p = pmap.get(_other_user_id(m, uid))
        if p:
            friends.append({
                "match_id": m["match_id"],
                "user_id": p["user_id"],
                "name": p.get("name", ""),
                "photo": (p.get("photos") or [None])[0],
            })
    return {
        "club": out_clubs[0] if out_clubs else None,
        "alternatives": out_clubs[1:],
        "friends": friends,
    }


@api_router.get("/matches/{match_id}/messages")
async def list_messages(match_id: str, since: Optional[str] = None, user: dict = Depends(get_current_user)):
    m = await db.matches.find_one({"match_id": match_id}, {"_id": 0})
    if not m or user["user_id"] not in (m["user_a"], m["user_b"]):
        raise HTTPException(status_code=404, detail="Match introuvable")
    query: dict = {"match_id": match_id}
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            query["created_at"] = {"$gt": since_dt}
        except ValueError:
            pass
    msgs = await db.messages.find(query, {"_id": 0}).sort("created_at", 1).limit(500).to_list(500)
    return msgs


class SendMessageBody(BaseModel):
    text: str = ""
    gif_url: Optional[str] = None  # GIF Tenor (URL https)
    invite: Optional[dict] = None  # Invitation soirée {club_id, club_name, address}


@api_router.post("/matches/{match_id}/messages", status_code=201)
async def send_message(match_id: str, body: SendMessageBody, user: dict = Depends(get_current_user)):
    m = await db.matches.find_one({"match_id": match_id}, {"_id": 0})
    if not m or user["user_id"] not in (m["user_a"], m["user_b"]):
        raise HTTPException(status_code=404, detail="Match introuvable")
    text = (body.text or "").strip()
    gif_url = (body.gif_url or "").strip() or None
    if gif_url and not gif_url.startswith("https://"):
        raise HTTPException(status_code=400, detail="URL GIF invalide")
    if not text and not gif_url:
        raise HTTPException(status_code=400, detail="Message vide")
    if len(text) > 1000:
        raise HTTPException(status_code=400, detail="Message trop long (max 1000)")
    now = datetime.now(timezone.utc)
    invite = None
    if isinstance(body.invite, dict) and body.invite.get("club_name"):
        invite = {
            "club_id": str(body.invite.get("club_id") or ""),
            "club_name": str(body.invite.get("club_name"))[:120],
            "address": str(body.invite.get("address") or "")[:200],
        }
    doc = {
        "message_id": f"msg_{uuid.uuid4().hex[:10]}",
        "match_id": match_id,
        "from_user_id": user["user_id"],
        "text": text,
        "gif_url": gif_url,
        "invite": invite,
        "invite_response": None,
        "created_at": now,
    }
    await db.messages.insert_one(doc)
    await db.matches.update_one({"match_id": match_id}, {"$set": {"last_message_at": now}})
    doc.pop("_id", None)
    # Push to the other user
    peer_id = _other_user_id(m, user["user_id"])
    sender_name = user.get("name") or "Quelqu'un"
    try:
        await push_service.send_push(
            recipients=[peer_id],
            title=f"💬 {sender_name}",
            message=(text or "🎬 GIF")[:120],
            action_url=f"/chat/{match_id}",
            idempotency_key=doc["message_id"],
        )
    except Exception as e:
        logger.warning("push (chat) failed: %s", e)
    return doc


class InviteResponseBody(BaseModel):
    response: str  # "yes" | "no"


@api_router.post("/messages/{message_id}/invite-response")
async def respond_invite(message_id: str, body: InviteResponseBody, user: dict = Depends(get_current_user)):
    """« J'y serai / Pas dispo » — réponse du destinataire à une invitation soirée."""
    if body.response not in ("yes", "no"):
        raise HTTPException(status_code=400, detail="Réponse invalide")
    msg = await db.messages.find_one({"message_id": message_id}, {"_id": 0})
    if not msg or not msg.get("invite"):
        raise HTTPException(status_code=404, detail="Invitation introuvable")
    m = await db.matches.find_one({"match_id": msg["match_id"]}, {"_id": 0})
    if not m or user["user_id"] not in (m["user_a"], m["user_b"]):
        raise HTTPException(status_code=404, detail="Match introuvable")
    if msg["from_user_id"] == user["user_id"]:
        raise HTTPException(status_code=403, detail="Tu ne peux pas répondre à ta propre invitation")
    if msg.get("invite_response"):
        raise HTTPException(status_code=409, detail="Déjà répondu")
    now = datetime.now(timezone.utc)
    await db.messages.update_one(
        {"message_id": message_id},
        {"$set": {"invite_response": body.response, "invite_responded_at": now}},
    )
    club_name = (msg.get("invite") or {}).get("club_name") or "la soirée"
    yes_text = f"✅ J'y serai ! On se voit au {club_name} 🎉"
    no_text = "😔 Pas dispo ce soir, une prochaine fois !"
    reply = {
        "message_id": f"msg_{uuid.uuid4().hex[:10]}",
        "match_id": msg["match_id"],
        "from_user_id": user["user_id"],
        "text": yes_text if body.response == "yes" else no_text,
        "gif_url": None,
        "created_at": now,
    }
    await db.messages.insert_one(reply)
    await db.matches.update_one({"match_id": msg["match_id"]}, {"$set": {"last_message_at": now}})
    reply.pop("_id", None)
    responder = user.get("name") or "Ton ami"
    push_body = "J'y serai !" if body.response == "yes" else "Pas dispo ce soir"
    try:
        await push_service.send_push(
            recipients=[msg["from_user_id"]],
            title="🎉 Réponse à ton invitation",
            message=f"{responder} : {push_body}",
            action_url=f"/chat/{msg['match_id']}",
            idempotency_key=f"invresp_{message_id}",
        )
    except Exception as e:
        logger.warning("push (invite response) failed: %s", e)
    return {"ok": True, "invite_response": body.response, "reply": reply}


@api_router.get("/swipes/history")
async def swipe_history(user: dict = Depends(get_current_user)):
    history = await db.swipes.find(
        {"user_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return history


# ---------------------------------------------------------------------------
# Club Moments — Live photo moments linked to a check-in
# 5 min capture window after the user confirms they're at a club.
# Free users → moments visible 24h. Premium → 7 days.
# Indexed by club + expires_at for fast map queries.
# ---------------------------------------------------------------------------


MOMENT_WINDOW_MIN = 5
MOMENT_TTL_FREE_HOURS = 24
MOMENT_TTL_PREMIUM_HOURS = 24 * 7
MOMENT_COOLDOWN_HOURS = 4  # min. delay between two moments (across all clubs)


class MomentUploadBody(BaseModel):
    image: str  # base64 (data URI ok) — composite or main photo
    caption: Optional[str] = None
    selfie: Optional[str] = None  # optional base64 selfie for BeReal-style dual view


@api_router.post("/clubs/{club_id}/moments")
async def upload_moment(
    club_id: str,
    body: MomentUploadBody,
    user: dict = Depends(get_current_user),
):
    """Upload a live moment. Must be within 5 min of a confirmed
    check-in to this club. Stored as base64; cleaned up via expires_at."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=MOMENT_WINDOW_MIN)
    recent_ci = await db.checkins.find_one(
        {
            "user_id": user["user_id"],
            "club_id": club_id,
            "confirmed": True,
            "created_at": {"$gte": cutoff},
        },
        sort=[("created_at", -1)],
    )
    if not recent_ci:
        raise HTTPException(
            status_code=403,
            detail="Fenêtre de capture expirée. Ta fenêtre de 5 min après le check-in est passée.",
        )
    # Reject duplicate upload for the same check-in
    existing = await db.club_moments.find_one({"checkin_id": recent_ci.get("checkin_id")})
    if existing:
        raise HTTPException(status_code=409, detail="Tu as déjà publié un moment pour ce check-in.")

    # Global cooldown: one moment per user every MOMENT_COOLDOWN_HOURS across all clubs
    cooldown_cutoff = now - timedelta(hours=MOMENT_COOLDOWN_HOURS)
    recent_moment = await db.club_moments.find_one(
        {"user_id": user["user_id"], "created_at": {"$gte": cooldown_cutoff}},
        sort=[("created_at", -1)],
    )
    if recent_moment:
        rm_created = recent_moment["created_at"]
        if rm_created.tzinfo is None:
            rm_created = rm_created.replace(tzinfo=timezone.utc)
        next_ok = rm_created + timedelta(hours=MOMENT_COOLDOWN_HOURS)
        mins_left = max(1, int((next_ok - now).total_seconds() / 60))
        hours_left = round(mins_left / 60, 1)
        raise HTTPException(
            status_code=429,
            detail=(
                f"Tu as déjà posté un moment récemment. "
                f"Reviens dans {hours_left}h pour en poster un nouveau."
            ),
        )

    ttl_hours = MOMENT_TTL_PREMIUM_HOURS if user.get("is_premium") else MOMENT_TTL_FREE_HOURS
    moment = {
        "moment_id": f"mom_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "user_name": user.get("name") or user.get("username") or "Quelqu'un",
        "user_picture": (user.get("photos") or [None])[0],
        "club_id": club_id,
        "checkin_id": recent_ci.get("checkin_id"),
        "image": body.image,
        "selfie": body.selfie or None,
        "caption": (body.caption or "")[:280],
        "is_premium_author": bool(user.get("is_premium")),
        "created_at": now,
        "expires_at": now + timedelta(hours=ttl_hours),
        "likes_count": 0,
    }
    await db.club_moments.insert_one(moment)
    moment.pop("_id", None)
    moment.pop("image", None)  # Don't echo the base64 back
    return moment


def _normalize_selfie(m: dict) -> dict:
    """Selfies historiques en base64 brut → data URI (sinon carré noir)."""
    s = m.get("selfie")
    if s and not s.startswith(("data:", "http")):
        m["selfie"] = f"data:image/jpeg;base64,{s}"
    return m


@api_router.get("/clubs/{club_id}/moments")
async def list_club_moments(
    club_id: str,
    user: dict = Depends(get_current_user),
):
    """Get all currently-active moments for a club (sorted newest first)."""
    now = datetime.now(timezone.utc)
    cursor = db.club_moments.find(
        {"club_id": club_id, "expires_at": {"$gt": now}},
        {"_id": 0},
    ).sort("created_at", -1).limit(50)
    return [_normalize_selfie(m) for m in await cursor.to_list(50)]


@api_router.get("/moments/active-clubs")
async def list_clubs_with_active_moments(user: dict = Depends(get_current_user)):
    """Return club_ids that currently have ≥ 1 active moment. The map uses
    this to render a "✨ live" badge over the club marker.
    """
    now = datetime.now(timezone.utc)
    pipeline = [
        {"$match": {"expires_at": {"$gt": now}}},
        {"$group": {
            "_id": "$club_id",
            "count": {"$sum": 1},
            "preview": {"$first": "$user_picture"},
        }},
        {"$limit": 200},
    ]
    rows = await db.club_moments.aggregate(pipeline).to_list(200)
    return [
        {"club_id": r["_id"], "count": r["count"], "preview": r.get("preview")}
        for r in rows
    ]


@api_router.get("/me/moments")
async def list_my_moments(user: dict = Depends(get_current_user)):
    """Return the current user's own live moments (most recent first).
    Used by the Instagram-style profile grid and story highlights."""
    now = datetime.now(timezone.utc)
    # Include both active and recently expired (last 7 days) so the profile
    # grid still shows a history. Story highlights filter to active only.
    cursor = db.club_moments.find(
        {"user_id": user["user_id"]},
        {"_id": 0},
    ).sort("created_at", -1).limit(60)
    moments = await cursor.to_list(60)
    # Enrich with club name (best-effort)
    club_ids = list({m.get("club_id") for m in moments if m.get("club_id")})
    name_map: dict = {}
    if club_ids:
        try:
            for coll in (db.clubs, db.places):
                async for c in coll.find({"club_id": {"$in": club_ids}}, {"_id": 0, "club_id": 1, "name": 1}):
                    name_map.setdefault(c["club_id"], c.get("name"))
        except Exception:
            pass
    for m in moments:
        _normalize_selfie(m)
        m["club_name"] = name_map.get(m.get("club_id"))
        exp = m.get("expires_at")
        if exp is not None:
            if getattr(exp, "tzinfo", None) is None:
                try:
                    exp = exp.replace(tzinfo=timezone.utc)
                except Exception:
                    pass
            try:
                m["active"] = exp > now
            except Exception:
                m["active"] = False
        else:
            m["active"] = False
    return moments


# ---------- Instagram-style feed: likes, comments, highlights ---------- #


class CommentBody(BaseModel):
    text: str = Field(min_length=1, max_length=280)


async def _enrich_moment(m: dict, viewer_id: str) -> dict:
    """Attach counts + viewer-specific state (liked_by_me) to a moment doc."""
    mid = m.get("moment_id")
    # Legacy fix: selfies uploaded as RAW base64 (no data: prefix) render as a
    # black square on the client — normalize to a data URI here.
    selfie = m.get("selfie")
    if selfie and not selfie.startswith(("data:", "http")):
        m["selfie"] = f"data:image/jpeg;base64,{selfie}"
    likes = await db.moment_likes.count_documents({"moment_id": mid})
    comments = await db.moment_comments.count_documents({"moment_id": mid})
    liked_by_me = await db.moment_likes.find_one(
        {"moment_id": mid, "user_id": viewer_id}, {"_id": 1}
    ) is not None
    m["likes_count"] = likes
    m["comments_count"] = comments
    m["liked_by_me"] = liked_by_me
    return m


@api_router.get("/moments/feed")
async def moments_feed(
    limit: int = 30,
    club_id: Optional[str] = None,
    user_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Instagram-style feed of active moments (newest first).

    Excludes moments from users blocked by / who blocked the viewer.
    Optional `user_id` filter → returns only that user's moments (for story viewer).
    """
    limit = max(1, min(limit, 100))
    now = datetime.now(timezone.utc)
    blocked = await _blocked_user_ids(user["user_id"])
    query: dict = {
        "expires_at": {"$gt": now},
        "user_id": {"$nin": list(blocked)},
    }
    if user_id:
        # Filter by that specific user (still respects block list)
        if user_id in blocked:
            return {"moments": [], "count": 0}
        query["user_id"] = user_id
    if club_id:
        query["club_id"] = club_id

    cursor = db.club_moments.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
    moments = await cursor.to_list(limit)

    # Enrich with club name + counts + liked_by_me
    club_ids = list({m.get("club_id") for m in moments if m.get("club_id")})
    name_map: dict = {}
    if club_ids:
        for coll in (db.clubs, db.places):
            async for c in coll.find(
                {"club_id": {"$in": club_ids}}, {"_id": 0, "club_id": 1, "name": 1}
            ):
                name_map.setdefault(c["club_id"], c.get("name"))

    for m in moments:
        m["club_name"] = name_map.get(m.get("club_id"))
        await _enrich_moment(m, user["user_id"])

    # Abonnements : le viewer suit-il l'auteur de chaque post ?
    author_ids = list({m["user_id"] for m in moments if m.get("user_id")})
    following_set: set = set()
    if author_ids:
        async for f in db.follows.find(
            {"follower_id": user["user_id"], "following_id": {"$in": author_ids}},
            {"_id": 0, "following_id": 1},
        ):
            following_set.add(f["following_id"])
    for m in moments:
        m["is_following"] = m.get("user_id") in following_set
    return {"moments": moments, "count": len(moments)}


@api_router.post("/users/{user_id}/follow")
async def toggle_follow(user_id: str, user: dict = Depends(get_current_user)):
    """S'abonner / se désabonner d'un utilisateur (toggle)."""
    me = user["user_id"]
    if user_id == me:
        raise HTTPException(status_code=400, detail="Tu ne peux pas t'abonner à toi-même.")
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0, "user_id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    existing = await db.follows.find_one({"follower_id": me, "following_id": user_id})
    if existing:
        await db.follows.delete_one({"_id": existing["_id"]})
        following = False
    else:
        await db.follows.insert_one({
            "follower_id": me,
            "following_id": user_id,
            "created_at": datetime.now(timezone.utc),
        })
        following = True
    followers = await db.follows.count_documents({"following_id": user_id})
    return {"following": following, "followers_count": followers}


@api_router.get("/users/{user_id}/follow-info")
async def follow_info(user_id: str, user: dict = Depends(get_current_user)):
    following = bool(
        await db.follows.find_one({"follower_id": user["user_id"], "following_id": user_id})
    )
    followers_count = await db.follows.count_documents({"following_id": user_id})
    following_count = await db.follows.count_documents({"follower_id": user_id})
    return {
        "following": following,
        "followers_count": followers_count,
        "following_count": following_count,
    }


@api_router.get("/moments/highlights")
async def moments_highlights(user: dict = Depends(get_current_user)):
    """Story-highlights bar (Instagram-style) — one entry per user with active moments.

    Returns the most recent moment per user (last 24h/7d based on premium), grouped.
    """
    now = datetime.now(timezone.utc)
    blocked = await _blocked_user_ids(user["user_id"])
    pipeline = [
        {"$match": {
            "expires_at": {"$gt": now},
            "user_id": {"$nin": list(blocked)},
        }},
        {"$sort": {"created_at": -1}},
        {"$group": {
            "_id": "$user_id",
            "moment_id": {"$first": "$moment_id"},
            "user_name": {"$first": "$user_name"},
            "user_picture": {"$first": "$user_picture"},
            "image": {"$first": "$image"},
            "created_at": {"$first": "$created_at"},
            "moments_count": {"$sum": 1},
        }},
        {"$sort": {"created_at": -1}},
        {"$limit": 40},
    ]
    rows = await db.club_moments.aggregate(pipeline).to_list(40)
    highlights = []
    for r in rows:
        highlights.append({
            "user_id": r["_id"],
            "user_name": r.get("user_name") or "?",
            "user_picture": r.get("user_picture"),
            "moment_id": r.get("moment_id"),
            "moments_count": r.get("moments_count", 1),
            "is_self": r["_id"] == user["user_id"],
        })
    # Move self to the front (Insta convention: your own story is first)
    highlights.sort(key=lambda h: (0 if h["is_self"] else 1))
    return {"highlights": highlights, "count": len(highlights)}


@api_router.post("/moments/{moment_id}/like")
async def like_moment(moment_id: str, user: dict = Depends(get_current_user)):
    """Idempotent like."""
    m = await db.club_moments.find_one({"moment_id": moment_id}, {"_id": 0, "user_id": 1})
    if not m:
        raise HTTPException(status_code=404, detail="Moment not found")
    now = datetime.now(timezone.utc)
    res = await db.moment_likes.update_one(
        {"moment_id": moment_id, "user_id": user["user_id"]},
        {"$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    # Create a notification only on first-time like (not on re-likes)
    if res.upserted_id is not None and m.get("user_id") != user["user_id"]:
        actor_name = user.get("name") or "?"
        actor_picture = user.get("picture") or ((user.get("photos") or [None])[0])
        try:
            await db.notifications.insert_one({
                "notification_id": f"notif_{uuid.uuid4().hex[:12]}",
                "user_id": m["user_id"],
                "type": "moment_like",
                "actor_id": user["user_id"],
                "actor_name": actor_name,
                "actor_picture": actor_picture,
                "moment_id": moment_id,
                "created_at": now,
                "read": False,
            })
        except Exception:
            pass
        # Push notification (silent-fail — build required to actually deliver)
        try:
            await push_service.send_push(
                [m["user_id"]],
                title=f"{actor_name} a aimé ton moment ❤️",
                message="Ouvre l'app pour voir qui c'est",
                action_url=f"nightfinder://moments/{moment_id}",
                idempotency_key=f"like:{moment_id}:{user['user_id']}",
            )
        except Exception:
            pass
    count = await db.moment_likes.count_documents({"moment_id": moment_id})
    return {"ok": True, "likes_count": count, "liked_by_me": True}


@api_router.delete("/moments/{moment_id}/like")
async def unlike_moment(moment_id: str, user: dict = Depends(get_current_user)):
    await db.moment_likes.delete_one({"moment_id": moment_id, "user_id": user["user_id"]})
    count = await db.moment_likes.count_documents({"moment_id": moment_id})
    return {"ok": True, "likes_count": count, "liked_by_me": False}


@api_router.get("/moments/{moment_id}/comments")
async def list_moment_comments(
    moment_id: str, user: dict = Depends(get_current_user),
):
    cursor = db.moment_comments.find(
        {"moment_id": moment_id}, {"_id": 0}
    ).sort("created_at", 1).limit(500)
    comments = await cursor.to_list(500)
    return {"comments": comments, "count": len(comments)}


@api_router.post("/moments/{moment_id}/comments")
async def add_moment_comment(
    moment_id: str,
    body: CommentBody,
    user: dict = Depends(get_current_user),
):
    m = await db.club_moments.find_one({"moment_id": moment_id}, {"_id": 0, "user_id": 1})
    if not m:
        raise HTTPException(status_code=404, detail="Moment not found")
    comment = {
        "comment_id": f"cmt_{uuid.uuid4().hex[:12]}",
        "moment_id": moment_id,
        "user_id": user["user_id"],
        "user_name": user.get("name") or "?",
        "user_picture": user.get("picture") or ((user.get("photos") or [None])[0]),
        "text": body.text.strip()[:280],
        "created_at": datetime.now(timezone.utc),
    }
    await db.moment_comments.insert_one(comment)
    # Notify moment owner (never notify self-comments)
    if m.get("user_id") != user["user_id"]:
        actor_name = user.get("name") or "?"
        actor_picture = user.get("picture") or ((user.get("photos") or [None])[0])
        try:
            await db.notifications.insert_one({
                "notification_id": f"notif_{uuid.uuid4().hex[:12]}",
                "user_id": m["user_id"],
                "type": "moment_comment",
                "actor_id": user["user_id"],
                "actor_name": actor_name,
                "actor_picture": actor_picture,
                "moment_id": moment_id,
                "text_preview": comment["text"][:80],
                "created_at": comment["created_at"],
                "read": False,
            })
        except Exception:
            pass
        try:
            await push_service.send_push(
                [m["user_id"]],
                title=f"{actor_name} a commenté ton moment 💬",
                message=comment["text"][:80],
                action_url=f"nightfinder://moments/{moment_id}",
                idempotency_key=f"cmt:{comment['comment_id']}",
            )
        except Exception:
            pass
    comment.pop("_id", None)
    return comment


@api_router.delete("/moments/{moment_id}/comments/{comment_id}")
async def delete_moment_comment(
    moment_id: str,
    comment_id: str,
    user: dict = Depends(get_current_user),
):
    """Author of the comment OR author of the moment can delete."""
    moment = await db.club_moments.find_one({"moment_id": moment_id}, {"_id": 0, "user_id": 1})
    cmt = await db.moment_comments.find_one({"comment_id": comment_id}, {"_id": 0})
    if not cmt:
        raise HTTPException(status_code=404, detail="Comment not found")
    if cmt.get("user_id") != user["user_id"] and (moment or {}).get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not allowed")
    await db.moment_comments.delete_one({"comment_id": comment_id})
    return {"ok": True}


@api_router.get("/moments/window-state")
async def moment_window_state(user: dict = Depends(get_current_user)):
    """Tells the frontend if the user is currently inside their 5-min capture
    window (used to push them to the Moment screen on app open / cold start)."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=MOMENT_WINDOW_MIN)
    ci = await db.checkins.find_one(
        {
            "user_id": user["user_id"],
            "confirmed": True,
            "created_at": {"$gte": cutoff},
        },
        sort=[("created_at", -1)],
    )
    if not ci:
        return {"in_window": False}
    already = await db.club_moments.find_one({"checkin_id": ci.get("checkin_id")})
    ci_created = ci["created_at"]
    if ci_created.tzinfo is None:
        ci_created = ci_created.replace(tzinfo=timezone.utc)
    expires_at = ci_created + timedelta(minutes=MOMENT_WINDOW_MIN)
    return {
        "in_window": not already,
        "club_id": ci["club_id"],
        "expires_at": expires_at.isoformat(),
        "seconds_left": max(0, int((expires_at - now).total_seconds())),
    }


# -------------- Notifications -------------- #


@api_router.get("/notifications")
async def list_notifications(user: dict = Depends(get_current_user)):
    notifs = await db.notifications.find(
        {"$or": [{"user_id": user["user_id"]}, {"user_id": None}]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    # Synthesize title/body for moment_like / moment_comment (their raw form only
    # carries actor + moment_id). Existing notifs already ship with title/body.
    for n in notifs:
        if n.get("title"):
            continue
        t = n.get("type")
        actor = n.get("actor_name") or "Quelqu'un"
        if t == "moment_like":
            n["title"] = f"{actor} a aimé ton moment ❤️"
            n["body"] = "Ouvre l'app pour voir qui c'est"
        elif t == "moment_comment":
            preview = n.get("text_preview") or ""
            n["title"] = f"{actor} a commenté ton moment 💬"
            n["body"] = preview[:80] if preview else "Ouvre l'app pour lire le commentaire"
    return notifs


@api_router.get("/notifications/unread-count")
async def unread_notifications_count(user: dict = Depends(get_current_user)):
    """Return count of unread notifications for the logged-in user."""
    c = await db.notifications.count_documents(
        {"user_id": user["user_id"], "read": {"$ne": True}}
    )
    return {"unread": c}


@api_router.post("/notifications/mark-read")
async def mark_notifications_read(user: dict = Depends(get_current_user)):
    """Mark ALL unread notifications for this user as read."""
    res = await db.notifications.update_many(
        {"user_id": user["user_id"], "read": {"$ne": True}},
        {"$set": {"read": True, "read_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True, "updated": res.modified_count}


async def _find_club_any(club_id: str) -> Optional[dict]:
    """Cherche un club dans db.clubs (vitrine) puis db.places (import Google)."""
    club = await db.clubs.find_one({"club_id": club_id}, {"_id": 0})
    if not club:
        club = await db.places.find_one({"club_id": club_id}, {"_id": 0})
    return club


@api_router.post("/checkins")
async def checkin(body: CheckInBody, user: dict = Depends(get_current_user)):
    club = await _find_club_any(body.club_id)
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")
    ci_id = f"ci_{uuid.uuid4().hex[:10]}"
    await db.checkins.insert_one(
        {
            "checkin_id": ci_id,
            "user_id": user["user_id"],
            "club_id": body.club_id,
            "confirmed": body.confirmed,
            "created_at": datetime.now(timezone.utc),
        }
    )
    if body.confirmed:
        # Create a friendly notification for the user
        await db.notifications.insert_one(
            {
                "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
                "user_id": user["user_id"],
                "title": f"Bonne soirée à {club['name']} 🎉",
                "body": f"On garde l'œil sur les meilleurs sons {(club.get('music_styles') or ['house'])[0]} pour toi.",
                "type": "checkin",
                "created_at": datetime.now(timezone.utc),
            }
        )

        # Notify the user's friends (only if HE is visible AND friend allows visibility)
        try:
            me_visibility = (user.get("visibility") or "clubs_only")
            if me_visibility != "hidden":
                accepted = await db.friendships.find(
                    {
                        "status": "accepted",
                        "$or": [
                            {"from_user_id": user["user_id"]},
                            {"to_user_id": user["user_id"]},
                        ],
                    },
                    {"_id": 0},
                ).to_list(500)
                friend_ids = []
                for f in accepted:
                    peer_id = f["to_user_id"] if f["from_user_id"] == user["user_id"] else f["from_user_id"]
                    friend_ids.append(peer_id)
                if friend_ids:
                    # Only notify friends who haven't hidden themselves either (they care)
                    notify_users = await db.users.find(
                        {"user_id": {"$in": friend_ids}, "visibility": {"$ne": "hidden"}},
                        {"_id": 0, "user_id": 1},
                    ).to_list(500)
                    notify_ids = [u["user_id"] for u in notify_users]
                    if notify_ids:
                        sender_name = user.get("name") or (
                            f"@{user.get('username')}" if user.get("username") else "Un ami"
                        )
                        # In-app notifications
                        ts = datetime.now(timezone.utc)
                        await db.notifications.insert_many(
                            [
                                {
                                    "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
                                    "user_id": fid,
                                    "title": f"{sender_name} est en soirée 🪩",
                                    "body": f"Sortie repérée à {club['name']}.",
                                    "type": "friend_at_club",
                                    "data": {
                                        "friend_user_id": user["user_id"],
                                        "club_id": body.club_id,
                                    },
                                    "created_at": ts,
                                }
                                for fid in notify_ids
                            ]
                        )
                        await push_service.send_push(
                            recipients=notify_ids,
                            title=f"{sender_name} est en soirée 🪩",
                            message=f"Sortie repérée à {club['name']}.",
                            action_url=f"/club/{body.club_id}",
                            idempotency_key=f"ci_{ci_id}",
                        )
        except Exception as e:
            logger.warning("push (friend_at_club) failed: %s", e)

    return {"ok": True, "checkin_id": ci_id, "confirmed": body.confirmed}


# ---------- Push notifications ---------- #


class RegisterPushBody(BaseModel):
    user_id: str
    platform: str  # "android" | "ios"
    device_token: str


@api_router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody, user: dict = Depends(get_current_user)):
    # Require the body user_id to match the authenticated user (light security)
    if body.user_id != user["user_id"]:
        raise HTTPException(status_code=403, detail="user_id mismatch")
    ok = await push_service.register_device(body.user_id, body.platform, body.device_token)
    # Persist a local copy so we can debug rotation; not used to relay (SuprSend resolves it)
    await db.push_tokens.update_one(
        {"user_id": body.user_id, "platform": body.platform},
        {
            "$set": {
                "device_token": body.device_token,
                "updated_at": datetime.now(timezone.utc),
                "last_register_ok": ok,
            }
        },
        upsert=True,
    )
    return {"status": "registered", "upstream_ok": ok}


@api_router.get("/checkins")
async def list_checkins(user: dict = Depends(get_current_user)):
    items = await db.checkins.find(
        {"user_id": user["user_id"], "confirmed": True}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return items


class SongDetected(BaseModel):
    club_id: str
    title: str
    artist: Optional[str] = None
    detected_at: Optional[str] = None  # ISO datetime
    source: Optional[str] = "auto"  # "auto" | "manual"


class ManualCheckInBody(BaseModel):
    club_id: str
    lat: float
    lng: float
    accuracy: Optional[float] = None  # précision GPS en mètres (facultatif)


MANUAL_CHECKIN_BASE_RADIUS_M = 20


@api_router.post("/checkins/manual")
async def manual_checkin(body: ManualCheckInBody, user: dict = Depends(get_current_user)):
    """Check-in manuel : l'utilisateur choisit le club, le serveur vérifie
    qu'il se trouve à moins de 20 m (+ marge de précision GPS, max 30 m)."""
    club = await _find_club_any(body.club_id)
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")
    club_lat, club_lng = club.get("lat"), club.get("lng")
    if club_lat is None or club_lng is None:
        raise HTTPException(status_code=400, detail="Position du club inconnue")

    distance_m = haversine_km(body.lat, body.lng, club_lat, club_lng) * 1000
    threshold = MANUAL_CHECKIN_BASE_RADIUS_M + min(max(body.accuracy or 0, 0), 30)
    if distance_m > threshold:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Tu es à {int(distance_m)} m de {club['name']}. "
                f"Rapproche-toi (moins de {MANUAL_CHECKIN_BASE_RADIUS_M} m) pour te checker."
            ),
        )

    # Évite les doublons : réutilise un check-in confirmé récent sur ce club
    now = datetime.now(timezone.utc)
    recent = await db.checkins.find_one(
        {
            "user_id": user["user_id"],
            "club_id": body.club_id,
            "confirmed": True,
            "created_at": {"$gte": now - timedelta(minutes=MOMENT_WINDOW_MIN)},
        },
        sort=[("created_at", -1)],
    )
    if recent:
        return {"ok": True, "checkin_id": recent["checkin_id"], "confirmed": True, "distance_m": int(distance_m)}

    result = await checkin(CheckInBody(club_id=body.club_id, confirmed=True), user)
    result["distance_m"] = int(distance_m)
    return result


@api_router.post("/checkins/song")
async def add_detected_song(
    body: SongDetected, user: dict = Depends(get_current_user)
):
    """Record a track recognised (or manually added) while the user is at a
    club. Stored under the user profile, grouped by club."""
    club = await _find_club_any(body.club_id)
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")
    now = datetime.now(timezone.utc)
    entry = {
        "song_id": f"sng_{uuid.uuid4().hex[:10]}",
        "user_id": user["user_id"],
        "club_id": body.club_id,
        "club_name": club.get("name"),
        "title": body.title.strip(),
        "artist": (body.artist or "").strip() or None,
        "source": body.source or "auto",
        "detected_at": body.detected_at or now.isoformat(),
        "created_at": now,
    }
    await db.user_songs.insert_one(entry)
    return {"ok": True, "song_id": entry["song_id"]}


@api_router.get("/profile/songs")
async def list_user_songs(user: dict = Depends(get_current_user)):
    """Return all detected songs grouped by club for the current user."""
    cursor = db.user_songs.find(
        {"user_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", -1)
    items = await cursor.to_list(1000)
    by_club: dict = {}
    for s in items:
        k = s["club_id"]
        if k not in by_club:
            by_club[k] = {
                "club_id": s["club_id"],
                "club_name": s.get("club_name"),
                "songs": [],
            }
        by_club[k]["songs"].append(
            {
                "song_id": s.get("song_id"),
                "title": s.get("title"),
                "artist": s.get("artist"),
                "detected_at": s.get("detected_at"),
                "source": s.get("source"),
                "spotify": s.get("spotify"),
                "deezer": s.get("deezer"),
                "apple_music": s.get("apple_music"),
            }
        )
    return {
        "total": len(items),
        "clubs": list(by_club.values()),
    }


@api_router.delete("/profile/songs/{song_id}")
async def delete_user_song(song_id: str, user: dict = Depends(get_current_user)):
    res = await db.user_songs.delete_one(
        {"song_id": song_id, "user_id": user["user_id"]}
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Song not found")
    return {"ok": True}


class MoveSongBody(BaseModel):
    club_id: str


@api_router.patch("/profile/songs/{song_id}/club")
async def move_user_song(
    song_id: str, body: MoveSongBody, user: dict = Depends(get_current_user)
):
    """Re-attach a detected song to another club chosen by the user."""
    club = await _find_club_any(body.club_id)
    if not club:
        raise HTTPException(status_code=404, detail="Club introuvable")
    res = await db.user_songs.update_one(
        {"song_id": song_id, "user_id": user["user_id"]},
        {"$set": {"club_id": body.club_id, "club_name": club["name"]}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Song not found")
    return {"ok": True, "club_id": body.club_id, "club_name": club["name"]}


# ---------------------------------------------------------------------------
# Friends — username search + friend requests
# ---------------------------------------------------------------------------
import re as _re


class UsernameBody(BaseModel):
    username: str


class FriendRequestBody(BaseModel):
    target_user_id: str


class VisibilityBody(BaseModel):
    visibility: str  # "always" | "clubs_only" | "hidden"


def _public_friend(u: dict) -> dict:
    return {
        "user_id": u.get("user_id"),
        "username": u.get("username"),
        "name": u.get("name"),
        "picture": u.get("picture"),
        "visibility": u.get("visibility", "clubs_only"),
    }


@api_router.put("/profile/username")
async def set_username(body: UsernameBody, user: dict = Depends(get_current_user)):
    u = body.username.strip().lower()
    if not _re.match(r"^[a-z0-9_]{3,20}$", u):
        raise HTTPException(
            status_code=400,
            detail="Username doit être en minuscules (a-z, 0-9, _), 3 à 20 caractères",
        )
    existing = await db.users.find_one(
        {"username": u, "user_id": {"$ne": user["user_id"]}}, {"_id": 0}
    )
    if existing:
        raise HTTPException(status_code=409, detail="Username déjà pris")
    await db.users.update_one(
        {"user_id": user["user_id"]}, {"$set": {"username": u}}
    )
    return {"ok": True, "username": u}


@api_router.put("/profile/visibility")
async def set_visibility(body: VisibilityBody, user: dict = Depends(get_current_user)):
    if body.visibility not in ("always", "clubs_only", "hidden"):
        raise HTTPException(status_code=400, detail="visibility invalide")
    await db.users.update_one(
        {"user_id": user["user_id"]}, {"$set": {"visibility": body.visibility}}
    )
    return {"ok": True, "visibility": body.visibility}


@api_router.get("/friends/search")
async def search_friends(q: str, user: dict = Depends(get_current_user)):
    q = (q or "").strip().lower()
    if len(q) < 2:
        return []
    cursor = db.users.find(
        {
            "username": {"$regex": f"^{_re.escape(q)}", "$options": "i"},
            "user_id": {"$ne": user["user_id"]},
        },
        {"_id": 0},
    ).limit(20)
    items = await cursor.to_list(20)
    return [_public_friend(u) for u in items]


class FindByContactsBody(BaseModel):
    emails: list[str] = []


@api_router.post("/friends/find-by-contacts")
async def find_friends_by_contacts(
    body: FindByContactsBody, user: dict = Depends(get_current_user)
):
    """Given a list of emails (from the phone's contacts), return the users
    who already have a Night Finder account. Excludes self and existing
    friends/pending requests, and annotates each result with its
    relationship status so the UI can render the right CTA."""
    # Normalize + dedupe + cap at 500 to avoid abuse
    norm = list({(e or "").strip().lower() for e in body.emails if e})[:500]
    if not norm:
        return []
    cursor = db.users.find(
        {"email": {"$in": norm}, "user_id": {"$ne": user["user_id"]}},
        {"_id": 0},
    ).limit(500)
    matched = await cursor.to_list(500)
    if not matched:
        return []

    # Existing friendships (any status) to annotate
    matched_ids = [u["user_id"] for u in matched]
    fs_rows = await db.friendships.find(
        {
            "$or": [
                {"from_user_id": user["user_id"], "to_user_id": {"$in": matched_ids}},
                {"from_user_id": {"$in": matched_ids}, "to_user_id": user["user_id"]},
            ]
        },
        {"_id": 0},
    ).to_list(500)
    status_map: dict[str, str] = {}
    for f in fs_rows:
        peer = f["to_user_id"] if f["from_user_id"] == user["user_id"] else f["from_user_id"]
        status_map[peer] = f.get("status", "pending")

    out = []
    for u in matched:
        rel = status_map.get(u["user_id"])
        # Hide already-confirmed friends to keep the list actionable
        if rel == "accepted":
            continue
        out.append({
            **_public_friend(u),
            "relationship": rel,  # None / "pending" / etc.
        })
    return out


@api_router.post("/friends/request")
async def send_friend_request(body: FriendRequestBody, user: dict = Depends(get_current_user)):
    target_id = body.target_user_id
    if target_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="On ne se demande pas en ami soi-même")
    target = await db.users.find_one({"user_id": target_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    # Reject duplicate or already accepted
    existing = await db.friendships.find_one(
        {
            "$or": [
                {"from_user_id": user["user_id"], "to_user_id": target_id},
                {"from_user_id": target_id, "to_user_id": user["user_id"]},
            ]
        }
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=("Vous êtes déjà amis" if existing.get("status") == "accepted" else "Demande déjà envoyée"),
        )
    fs_id = f"fs_{uuid.uuid4().hex[:10]}"
    await db.friendships.insert_one(
        {
            "friendship_id": fs_id,
            "from_user_id": user["user_id"],
            "to_user_id": target_id,
            "status": "pending",
            "created_at": datetime.now(timezone.utc),
        }
    )
    # In-app notification + push
    sender_name = user.get("name") or (f"@{user.get('username')}" if user.get("username") else "Quelqu'un")
    await db.notifications.insert_one(
        {
            "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
            "user_id": target_id,
            "title": "Nouvelle demande d'ami 🤝",
            "body": f"{sender_name} veut être ton ami sur Night Finder.",
            "type": "friend_request",
            "data": {"from_user_id": user["user_id"], "friendship_id": fs_id},
            "created_at": datetime.now(timezone.utc),
        }
    )
    try:
        await push_service.send_push(
            recipients=[target_id],
            title="Nouvelle demande d'ami 🤝",
            message=f"{sender_name} veut être ton ami.",
            action_url="/friends",
            idempotency_key=f"fr_req_{fs_id}",
        )
    except Exception as e:
        logger.warning("push (friend_request) failed: %s", e)
    return {"ok": True}


@api_router.post("/friends/{friendship_id}/accept")
async def accept_friend(friendship_id: str, user: dict = Depends(get_current_user)):
    fs = await db.friendships.find_one(
        {"friendship_id": friendship_id, "to_user_id": user["user_id"], "status": "pending"}
    )
    if not fs:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    await db.friendships.update_one(
        {"friendship_id": friendship_id},
        {"$set": {"status": "accepted", "accepted_at": datetime.now(timezone.utc)}},
    )
    # Notify the request sender
    accepter_name = user.get("name") or (f"@{user.get('username')}" if user.get("username") else "Quelqu'un")
    sender_id = fs["from_user_id"]
    await db.notifications.insert_one(
        {
            "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
            "user_id": sender_id,
            "title": "Nouvel ami 🎉",
            "body": f"{accepter_name} a accepté ta demande.",
            "type": "friend_accepted",
            "data": {"friend_user_id": user["user_id"]},
            "created_at": datetime.now(timezone.utc),
        }
    )
    try:
        await push_service.send_push(
            recipients=[sender_id],
            title="Nouvel ami 🎉",
            message=f"{accepter_name} a accepté ta demande.",
            action_url="/friends",
            idempotency_key=f"fr_acc_{friendship_id}",
        )
    except Exception as e:
        logger.warning("push (friend_accept) failed: %s", e)
    return {"ok": True}


@api_router.post("/friends/{friendship_id}/reject")
async def reject_friend(friendship_id: str, user: dict = Depends(get_current_user)):
    res = await db.friendships.delete_one(
        {"friendship_id": friendship_id, "to_user_id": user["user_id"], "status": "pending"}
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    return {"ok": True}


@api_router.delete("/friends/{friend_user_id}")
async def remove_friend(friend_user_id: str, user: dict = Depends(get_current_user)):
    await db.friendships.delete_many(
        {
            "status": "accepted",
            "$or": [
                {"from_user_id": user["user_id"], "to_user_id": friend_user_id},
                {"from_user_id": friend_user_id, "to_user_id": user["user_id"]},
            ],
        }
    )
    return {"ok": True}


@api_router.get("/friends/list")
async def list_friends(user: dict = Depends(get_current_user)):
    uid = user["user_id"]
    accepted = await db.friendships.find(
        {"status": "accepted", "$or": [{"from_user_id": uid}, {"to_user_id": uid}]}, {"_id": 0}
    ).to_list(500)
    incoming = await db.friendships.find(
        {"status": "pending", "to_user_id": uid}, {"_id": 0}
    ).to_list(200)
    outgoing = await db.friendships.find(
        {"status": "pending", "from_user_id": uid}, {"_id": 0}
    ).to_list(200)

    async def hydrate(fs_list, peer_field):
        ids = [f[peer_field] for f in fs_list]
        users = await db.users.find({"user_id": {"$in": ids}}, {"_id": 0}).to_list(500)
        umap = {u["user_id"]: u for u in users}
        out = []
        for f in fs_list:
            u = umap.get(f[peer_field])
            if not u:
                continue
            out.append({**_public_friend(u), "friendship_id": f.get("friendship_id")})
        return out

    friend_peer_ids = [
        f["to_user_id"] if f["from_user_id"] == uid else f["from_user_id"] for f in accepted
    ]
    friend_users = await db.users.find({"user_id": {"$in": friend_peer_ids}}, {"_id": 0}).to_list(500)
    fmap = {u["user_id"]: u for u in friend_users}
    friends_list = []
    for f in accepted:
        peer_id = f["to_user_id"] if f["from_user_id"] == uid else f["from_user_id"]
        peer = fmap.get(peer_id)
        if peer:
            friends_list.append({**_public_friend(peer), "friendship_id": f.get("friendship_id")})

    return {
        "friends": friends_list,
        "incoming": await hydrate(incoming, "from_user_id"),
        "outgoing": await hydrate(outgoing, "to_user_id"),
    }


@api_router.get("/friends/active")
async def list_active_friends(user: dict = Depends(get_current_user)):
    """Return friends currently checked into a club (within last 8h) and
    whose visibility allows it. Used to show avatars on the map."""
    uid = user["user_id"]
    accepted = await db.friendships.find(
        {"status": "accepted", "$or": [{"from_user_id": uid}, {"to_user_id": uid}]},
        {"_id": 0},
    ).to_list(500)
    friend_ids = []
    for f in accepted:
        peer_id = f["to_user_id"] if f["from_user_id"] == uid else f["from_user_id"]
        friend_ids.append(peer_id)
    if not friend_ids:
        return []

    # Only friends that allow visibility
    visible_friends = await db.users.find(
        {"user_id": {"$in": friend_ids}, "visibility": {"$ne": "hidden"}},
        {"_id": 0},
    ).to_list(500)
    visible_ids = [u["user_id"] for u in visible_friends]
    if not visible_ids:
        return []
    umap = {u["user_id"]: u for u in visible_friends}

    cutoff = datetime.now(timezone.utc) - timedelta(hours=8)
    # Latest confirmed check-in for each friend within last 8h
    cursor = db.checkins.find(
        {"user_id": {"$in": visible_ids}, "confirmed": True, "created_at": {"$gte": cutoff}},
        {"_id": 0},
    ).sort("created_at", -1)
    checkins = await cursor.to_list(1000)
    latest_by_user: dict[str, dict] = {}
    for ci in checkins:
        uid2 = ci["user_id"]
        if uid2 not in latest_by_user:
            latest_by_user[uid2] = ci

    club_ids = list({ci["club_id"] for ci in latest_by_user.values()})
    clubs_list = await db.clubs.find({"club_id": {"$in": club_ids}}, {"_id": 0}).to_list(500)
    cmap = {c["club_id"]: c for c in clubs_list}

    out = []
    for fid, ci in latest_by_user.items():
        club = cmap.get(ci["club_id"])
        if not club:
            continue
        fr = umap.get(fid)
        if not fr:
            continue
        out.append({
            "user_id": fid,
            "username": fr.get("username"),
            "name": fr.get("name"),
            "picture": fr.get("picture"),
            "club_id": ci["club_id"],
            "club_name": club.get("name"),
            "lat": club.get("lat"),
            "lng": club.get("lng"),
            "checked_in_at": ci.get("created_at"),
        })

    return out


class AudioRecognizeBody(BaseModel):
    club_id: str
    audio_base64: str  # raw audio bytes encoded as base64 (mp3/m4a/wav, <= 1MB)
    fast: bool = False  # fast path: skip ffmpeg preprocessing (1st Shazam pass)


def _preprocess_club_audio(raw: bytes) -> tuple[bytes, str]:
    """Prétraite l'échantillon audio avant Audd.io pour les clubs bruyants :
    - adeclip : répare l'écrêtage (musique trop forte qui sature le micro)
    - highpass : retire les basses saturées qui masquent l'empreinte
    - dynaudnorm : normalise le niveau

    Retourne (bytes, extension). En cas d'échec ffmpeg → audio original.
    """
    import subprocess
    import tempfile
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as fin:
            fin.write(raw)
            in_path = fin.name
        out_path = in_path + ".mp3"
        res = subprocess.run(
            [
                ffmpeg, "-y", "-i", in_path,
                "-af", "adeclip,highpass=f=80,dynaudnorm=g=7",
                "-ac", "1", "-ar", "44100", "-b:a", "128k",
                out_path,
            ],
            capture_output=True,
            timeout=20,
        )
        if res.returncode == 0 and os.path.getsize(out_path) > 5000:
            with open(out_path, "rb") as f:
                cleaned = f.read()
            os.unlink(in_path)
            os.unlink(out_path)
            return cleaned, "mp3"
        os.unlink(in_path)
        if os.path.exists(out_path):
            os.unlink(out_path)
    except Exception as exc:  # noqa: BLE001
        logging.warning("audio preprocess failed (fallback raw): %s", exc)
    return raw, "m4a"


@api_router.post("/recognize/audio")
async def recognize_audio(
    body: AudioRecognizeBody, user: dict = Depends(get_current_user)
):
    """Identify a track from a short audio sample using Audd.io and store
    the result under the user profile, grouped by club."""
    audd_token = os.environ.get("AUDD_API_TOKEN", "").strip().strip(chr(34)).strip(chr(39)).strip(chr(34)).strip(chr(39))
    if not audd_token:
        raise HTTPException(status_code=503, detail="Audd.io not configured")
    if http_client is None:
        raise HTTPException(status_code=503, detail="Service not ready")
    # "manual_scan" is a synthetic club_id used when the user taps the Shazam
    # button without being near a real venue — accept it gracefully.
    if body.club_id == "manual_scan":
        club = {"club_id": "manual_scan", "name": "Scan manuel"}
    else:
        club = await _find_club_any(body.club_id)
        if not club:
            raise HTTPException(status_code=404, detail="Club not found")
    try:
        import base64
        raw = base64.b64decode(body.audio_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 audio")
    if len(raw) > 5_000_000:
        raise HTTPException(status_code=413, detail="Audio sample too large (max 5MB)")

    # Anti-saturation : répare l'écrêtage des enregistrements en club bruyant.
    # Fast path (1er essai Shazam) : on saute ffmpeg (~1s gagnée) — le
    # pré-traitement complet n'est appliqué qu'au 2e essai si le 1er échoue.
    if body.fast:
        cleaned, ext = raw, "m4a"
    else:
        cleaned, ext = await asyncio.to_thread(_preprocess_club_audio, raw)

    try:
        files = {"file": (f"sample.{ext}", cleaned, f"audio/{ext}")}
        data = {
            "api_token": audd_token,
            # Fast pass: skip enrichment lookups for lower Audd latency
            "return": "spotify" if body.fast else "spotify,apple_music,deezer,musicbrainz",
            "accurate_offsets": "true",  # Better match precision for noisy club samples
        }
        r = await http_client.post(
            "https://api.audd.io/", data=data, files=files,
            timeout=10.0 if body.fast else 25.0,
        )
    except Exception as exc:
        logging.warning("Audd error: %s", exc)
        raise HTTPException(status_code=502, detail="Recognition provider error")

    if r.status_code != 200:
        try:
            err_payload = r.json()
        except Exception:
            err_payload = {"raw": (r.text or "")[:200]}
        logging.warning(
            "Audd HTTP %s — payload=%s — sample_bytes=%d",
            r.status_code,
            err_payload,
            len(raw),
        )
        raise HTTPException(status_code=502, detail="Audd HTTP error")
    payload = r.json() or {}
    # Audd returns {"status":"error", "error":{"error_code":..,"error_message":..}}
    # for quota / auth issues even with HTTP 200.
    if payload.get("status") == "error":
        err = payload.get("error") or {}
        logging.warning(
            "Audd API error code=%s message=%s",
            err.get("error_code"),
            err.get("error_message"),
        )
        # Map technical Audd errors to actionable French messages.
        code = err.get("error_code")
        if code == 900:
            friendly = (
                "Service de reconnaissance inactif — l'abonnement Audd.io doit être "
                "réactivé sur dashboard.audd.io."
            )
        elif code == 901:
            friendly = "Quota de reconnaissance épuisé pour aujourd'hui. Réessaie demain."
        else:
            friendly = err.get("error_message") or "Erreur du service de reconnaissance."
        return {
            "ok": False,
            "recognised": False,
            "error_code": code,
            "error_message": friendly,
        }
    result = payload.get("result")
    if not result:
        # Audd returns null result when sample too short/noisy/silent.
        logging.info(
            "Audd no-match — sample_bytes=%d club=%s", len(raw), body.club_id
        )
        return {"ok": True, "recognised": False}

    now = datetime.now(timezone.utc)
    title = (result.get("title") or "").strip() or "Untitled"
    artist = (result.get("artist") or "").strip() or None
    entry = {
        "song_id": f"sng_{uuid.uuid4().hex[:10]}",
        "user_id": user["user_id"],
        "club_id": body.club_id,
        "club_name": club.get("name"),
        "title": title,
        "artist": artist,
        "album": result.get("album"),
        "release_date": result.get("release_date"),
        "spotify": (result.get("spotify") or {}).get("external_urls", {}).get("spotify"),
        "apple_music": (result.get("apple_music") or {}).get("url"),
        "deezer": (result.get("deezer") or {}).get("link"),
        "source": "audd",
        "detected_at": now.isoformat(),
        "created_at": now,
    }
    await db.user_songs.insert_one(entry)
    return {
        "ok": True,
        "recognised": True,
        "song_id": entry["song_id"],
        "title": title,
        "artist": artist,
    }


# -------------- Seed data -------------- #

PARIS_CLUBS = [
    {
        "name": "Club Rex",
        "address": "5 Bd Poissonnière, 75002 Paris",
        "lat": 48.8709,
        "lng": 2.3478,
        "description": "Temple parisien de la techno depuis 1988. Sound system légendaire et programmation pointue.",
        "music_styles": ["techno", "house", "electronic"],
        "avg_price": 18.0,
        "rating": 4.6,
        "features": ["vip", "smoking_area"],
        "hours": {
            "mon": {"open": False},
            "tue": {"open": False},
            "wed": {"open": True, "from": "23:30", "to": "06:00"},
            "thu": {"open": True, "from": "23:30", "to": "06:00"},
            "fri": {"open": True, "from": "23:30", "to": "07:00"},
            "sat": {"open": True, "from": "23:30", "to": "07:00"},
            "sun": {"open": False},
        },
        "photos": [
            "https://images.pexels.com/photos/31923252/pexels-photo-31923252.jpeg",
        ],
    },
    {
        "name": "L'Arc Paris",
        "address": "12 Rue de Presbourg, 75116 Paris",
        "lat": 48.8738,
        "lng": 2.2935,
        "description": "Club rooftop chic face à l'Arc de Triomphe. Ambiance VIP, cocktails premium.",
        "music_styles": ["house", "hip-hop", "rnb"],
        "avg_price": 35.0,
        "rating": 4.4,
        "features": ["vip", "terrasse", "rooftop"],
        "hours": {
            "mon": {"open": False},
            "tue": {"open": False},
            "wed": {"open": True, "from": "23:00", "to": "05:00"},
            "thu": {"open": True, "from": "23:00", "to": "05:00"},
            "fri": {"open": True, "from": "23:00", "to": "06:00"},
            "sat": {"open": True, "from": "23:00", "to": "06:00"},
            "sun": {"open": False},
        },
        "photos": [
            "https://images.pexels.com/photos/14577027/pexels-photo-14577027.jpeg",
        ],
    },
    {
        "name": "Concrete",
        "address": "69 Port de la Rapée, 75012 Paris",
        "lat": 48.8418,
        "lng": 2.3686,
        "description": "Péniche techno mythique sur la Seine. Marathons électroniques de 24h.",
        "music_styles": ["techno", "minimal", "electronic"],
        "avg_price": 20.0,
        "rating": 4.7,
        "features": ["terrasse", "waterfront"],
        "hours": {
            "mon": {"open": False},
            "tue": {"open": False},
            "wed": {"open": False},
            "thu": {"open": False},
            "fri": {"open": True, "from": "23:00", "to": "12:00"},
            "sat": {"open": True, "from": "23:00", "to": "12:00"},
            "sun": {"open": True, "from": "14:00", "to": "23:00"},
        },
        "photos": [
            "https://images.unsplash.com/photo-1578736641330-3155e606cd40?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODd8MHwxfHNlYXJjaHw0fHxwYXJ0eSUyMGNyb3dkJTIwY2x1YmJpbmclMjBkYXJrfGVufDB8fHx8MTc4MDQ5ODMzM3ww&ixlib=rb-4.1.0&q=85",
        ],
    },
    {
        "name": "Silencio",
        "address": "142 Rue Montmartre, 75002 Paris",
        "lat": 48.8689,
        "lng": 2.3441,
        "description": "Club privé conçu par David Lynch. Atmosphère cinématographique unique.",
        "music_styles": ["electronic", "jazz", "experimental"],
        "avg_price": 30.0,
        "rating": 4.5,
        "features": ["vip", "private"],
        "hours": {
            "mon": {"open": False},
            "tue": {"open": True, "from": "22:00", "to": "04:00"},
            "wed": {"open": True, "from": "22:00", "to": "04:00"},
            "thu": {"open": True, "from": "22:00", "to": "05:00"},
            "fri": {"open": True, "from": "22:00", "to": "06:00"},
            "sat": {"open": True, "from": "22:00", "to": "06:00"},
            "sun": {"open": False},
        },
        "photos": [
            "https://images.unsplash.com/photo-1545128485-c400e7702796?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODd8MHwxfHNlYXJjaHwzfHxwYXJ0eSUyMGNyb3dkJTIwY2x1YmJpbmclMjBkYXJrfGVufDB8fHx8MTc4MDQ5ODMzM3ww&ixlib=rb-4.1.0&q=85",
        ],
    },
    {
        "name": "La Machine du Moulin Rouge",
        "address": "90 Bd de Clichy, 75018 Paris",
        "lat": 48.8842,
        "lng": 2.3325,
        "description": "Trois étages de fête à Pigalle. Concerts live, clubbing et terrasse panoramique.",
        "music_styles": ["indie", "electronic", "rock", "house"],
        "avg_price": 16.0,
        "rating": 4.3,
        "features": ["terrasse", "live_music"],
        "hours": {
            "mon": {"open": False},
            "tue": {"open": False},
            "wed": {"open": True, "from": "23:00", "to": "05:00"},
            "thu": {"open": True, "from": "23:00", "to": "05:00"},
            "fri": {"open": True, "from": "23:00", "to": "06:00"},
            "sat": {"open": True, "from": "23:00", "to": "06:00"},
            "sun": {"open": False},
        },
        "photos": [
            "https://images.unsplash.com/photo-1630395822970-acd6a691d97e?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODd8MHwxfHNlYXJjaHwxfHxwYXJ0eSUyMGNyb3dkJTIwY2x1YmJpbmclMjBkYXJrfGVufDB8fHx8MTc4MDQ5ODMzM3ww&ixlib=rb-4.1.0&q=85",
        ],
    },
    {
        "name": "Wanderlust",
        "address": "32 Quai d'Austerlitz, 75013 Paris",
        "lat": 48.8395,
        "lng": 2.3729,
        "description": "Club et terrasse géante sur la Seine. Lieu emblématique des soirées estivales.",
        "music_styles": ["house", "disco", "electronic"],
        "avg_price": 14.0,
        "rating": 4.2,
        "features": ["terrasse", "waterfront"],
        "hours": {
            "mon": {"open": False},
            "tue": {"open": False},
            "wed": {"open": True, "from": "19:00", "to": "02:00"},
            "thu": {"open": True, "from": "19:00", "to": "03:00"},
            "fri": {"open": True, "from": "19:00", "to": "06:00"},
            "sat": {"open": True, "from": "19:00", "to": "06:00"},
            "sun": {"open": True, "from": "16:00", "to": "00:00"},
        },
        "photos": [
            "https://images.unsplash.com/photo-1581417478175-a9ef18f210c2?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODd8MHwxfHNlYXJjaHwyfHxwYXJ0eSUyMGNyb3dkJTIwY2x1YmJpbmclMjBkYXJrfGVufDB8fHx8MTc4MDQ5ODMzM3ww&ixlib=rb-4.1.0&q=85",
        ],
    },
    {
        "name": "Djoon",
        "address": "22 Bd Vincent Auriol, 75013 Paris",
        "lat": 48.8367,
        "lng": 2.3704,
        "description": "Référence house, afro et soul. Cosy, intimiste et toujours en feu le week-end.",
        "music_styles": ["house", "afro-house", "soul"],
        "avg_price": 15.0,
        "rating": 4.5,
        "features": ["intimate"],
        "hours": {
            "mon": {"open": False},
            "tue": {"open": False},
            "wed": {"open": False},
            "thu": {"open": True, "from": "23:00", "to": "05:00"},
            "fri": {"open": True, "from": "23:00", "to": "06:00"},
            "sat": {"open": True, "from": "23:00", "to": "06:00"},
            "sun": {"open": True, "from": "22:00", "to": "04:00"},
        },
        "photos": [
            "https://images.pexels.com/photos/5191480/pexels-photo-5191480.jpeg",
        ],
    },
    {
        "name": "Faust",
        "address": "Port des Invalides, 75007 Paris",
        "lat": 48.8628,
        "lng": 2.3142,
        "description": "Sous le Pont Alexandre III. Atmosphère électrique, vue magique sur la Seine.",
        "music_styles": ["house", "techno", "hip-hop"],
        "avg_price": 22.0,
        "rating": 4.4,
        "features": ["vip", "waterfront", "iconic_location"],
        "hours": {
            "mon": {"open": False},
            "tue": {"open": False},
            "wed": {"open": True, "from": "23:30", "to": "05:00"},
            "thu": {"open": True, "from": "23:30", "to": "05:00"},
            "fri": {"open": True, "from": "23:30", "to": "06:00"},
            "sat": {"open": True, "from": "23:30", "to": "06:00"},
            "sun": {"open": False},
        },
        "photos": [
            "https://images.pexels.com/photos/3696396/pexels-photo-3696396.jpeg",
        ],
    },
    {
        "name": "Matignon",
        "address": "3 Avenue Matignon, 75008 Paris",
        "lat": 48.8694,
        "lng": 2.3120,
        "description": "Restaurant-club du Triangle d'Or. Sparklers, dress code chic et clientèle dorée.",
        "music_styles": ["hip-hop", "rnb", "house"],
        "avg_price": 50.0,
        "rating": 4.1,
        "features": ["vip", "restaurant", "dress_code"],
        "hours": {
            "mon": {"open": True, "from": "20:00", "to": "03:00"},
            "tue": {"open": True, "from": "20:00", "to": "03:00"},
            "wed": {"open": True, "from": "20:00", "to": "04:00"},
            "thu": {"open": True, "from": "20:00", "to": "05:00"},
            "fri": {"open": True, "from": "20:00", "to": "06:00"},
            "sat": {"open": True, "from": "20:00", "to": "06:00"},
            "sun": {"open": False},
        },
        "photos": [
            "https://images.unsplash.com/photo-1708449530105-ea7d453a6f89?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODF8MHwxfHNlYXJjaHwzfHxuaWdodGNsdWIlMjBkcmlua3MlMjBwYXJ0eXxlbnwwfHx8fDE3ODA0OTgzNTF8MA&ixlib=rb-4.1.0&q=85",
        ],
    },
    {
        "name": "Le Syndicat",
        "address": "51 Rue du Faubourg Saint-Denis, 75010 Paris",
        "lat": 48.8729,
        "lng": 2.3536,
        "description": "Cocktail bar pointu, mixologie 100% spiritueux français. Ambiance feutrée et bourdonnante.",
        "music_styles": ["jazz", "lounge", "soul"],
        "avg_price": 14.0,
        "rating": 4.7,
        "features": ["cocktail_bar", "intimate"],
        "hours": {
            "mon": {"open": True, "from": "18:00", "to": "02:00"},
            "tue": {"open": True, "from": "18:00", "to": "02:00"},
            "wed": {"open": True, "from": "18:00", "to": "02:00"},
            "thu": {"open": True, "from": "18:00", "to": "02:00"},
            "fri": {"open": True, "from": "18:00", "to": "04:00"},
            "sat": {"open": True, "from": "18:00", "to": "04:00"},
            "sun": {"open": True, "from": "18:00", "to": "02:00"},
        },
        "photos": [
            "https://images.unsplash.com/photo-1569924995012-c4c706bfcd51?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODF8MHwxfHNlYXJjaHwyfHxuaWdodGNsdWIlMjBkcmlua3MlMjBwYXJ0eXxlbnwwfHx8fDE3ODA0OTgzNTF8MA&ixlib=rb-4.1.0&q=85",
        ],
    },
    {
        "name": "Le Comptoir Général",
        "address": "80 Quai de Jemmapes, 75010 Paris",
        "lat": 48.8704,
        "lng": 2.3661,
        "description": "Lieu hybride sur le canal Saint-Martin. Bar, expos, événements afro-créoles et DJ sets.",
        "music_styles": ["afro-house", "world", "electronic"],
        "avg_price": 12.0,
        "rating": 4.6,
        "features": ["terrasse", "cultural", "waterfront"],
        "hours": {
            "mon": {"open": False},
            "tue": {"open": True, "from": "18:00", "to": "02:00"},
            "wed": {"open": True, "from": "18:00", "to": "02:00"},
            "thu": {"open": True, "from": "18:00", "to": "02:00"},
            "fri": {"open": True, "from": "18:00", "to": "04:00"},
            "sat": {"open": True, "from": "14:00", "to": "04:00"},
            "sun": {"open": True, "from": "14:00", "to": "00:00"},
        },
        "photos": [
            "https://images.unsplash.com/photo-1579450887097-6def9f204eeb?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODF8MHwxfHNlYXJjaHw0fHxuaWdodGNsdWIlMjBkcmlua3MlMjBwYXJ0eXxlbnwwfHx8fDE3ODA0OTgzNTF8MA&ixlib=rb-4.1.0&q=85",
        ],
    },
    {
        "name": "Pachamama",
        "address": "46-48 Rue du Faubourg Poissonnière, 75010 Paris",
        "lat": 48.8745,
        "lng": 2.3479,
        "description": "Hôtel particulier transformé en club latino-festif. Cocktails colorés et latino vibes.",
        "music_styles": ["latin", "reggaeton", "house"],
        "avg_price": 20.0,
        "rating": 4.3,
        "features": ["restaurant", "vip"],
        "hours": {
            "mon": {"open": False}, "tue": {"open": True, "from": "20:00", "to": "02:00"},
            "wed": {"open": True, "from": "20:00", "to": "04:00"}, "thu": {"open": True, "from": "20:00", "to": "05:00"},
            "fri": {"open": True, "from": "20:00", "to": "06:00"}, "sat": {"open": True, "from": "20:00", "to": "06:00"},
            "sun": {"open": False},
        },
        "photos": ["https://images.pexels.com/photos/15648325/pexels-photo-15648325.jpeg"],
    },
    # ---------- More Paris ----------
    {"name": "Badaboum", "address": "2 bis Rue des Taillandiers, 75011 Paris", "lat": 48.8533, "lng": 2.3742,
     "description": "Salle de concert et club mythique du 11e. Programmation électro pointue.", "music_styles": ["electronic", "techno", "indie"],
     "avg_price": 12.0, "rating": 4.4, "features": ["live_music"],
     "hours": {d: {"open": d in ["thu", "fri", "sat"], "from": "23:00", "to": "06:00"} for d in ["mon","tue","wed","thu","fri","sat","sun"]},
     "photos": ["https://images.unsplash.com/photo-1545128485-c400e7702796?crop=entropy&cs=srgb&fm=jpg&q=85"]},
    {"name": "Le Carmen", "address": "34 Rue Duperré, 75009 Paris", "lat": 48.8821, "lng": 2.3360,
     "description": "Hôtel particulier dans Pigalle, bar à cocktails et DJ sets nocturnes.", "music_styles": ["house", "disco", "hip-hop"],
     "avg_price": 16.0, "rating": 4.2, "features": ["intimate", "cocktail_bar"],
     "hours": {d: {"open": d in ["wed","thu","fri","sat"], "from": "22:00", "to": "05:00"} for d in ["mon","tue","wed","thu","fri","sat","sun"]},
     "photos": ["https://images.unsplash.com/photo-1569924995012-c4c706bfcd51?crop=entropy&cs=srgb&fm=jpg&q=85"]},
    {"name": "Sacré", "address": "29 Avenue Daumesnil, 75012 Paris", "lat": 48.8458, "lng": 2.3725,
     "description": "Nouveau spot du 12e, programmation house et techno underground.", "music_styles": ["house", "techno"],
     "avg_price": 18.0, "rating": 4.5, "features": ["underground"],
     "hours": {d: {"open": d in ["fri", "sat"], "from": "23:00", "to": "07:00"} for d in ["mon","tue","wed","thu","fri","sat","sun"]},
     "photos": ["https://images.pexels.com/photos/31923252/pexels-photo-31923252.jpeg"]},
    {"name": "T7", "address": "19 Rue des Frigos, 75013 Paris", "lat": 48.8332, "lng": 2.3735,
     "description": "Squat artistique reconverti en club techno authentique. After-hours légendaires.", "music_styles": ["techno", "minimal"],
     "avg_price": 15.0, "rating": 4.6, "features": ["underground", "afterhours"],
     "hours": {d: {"open": d in ["fri", "sat", "sun"], "from": "23:00", "to": "12:00"} for d in ["mon","tue","wed","thu","fri","sat","sun"]},
     "photos": ["https://images.unsplash.com/photo-1578736641330-3155e606cd40?crop=entropy&cs=srgb&fm=jpg&q=85"]},
    # ---------- Lyon ----------
    {"name": "Le Sucre", "address": "50 Quai Rambaud, 69002 Lyon", "lat": 45.7414, "lng": 4.8157,
     "description": "Rooftop sur la Confluence, l'un des meilleurs clubs électro de France.", "music_styles": ["techno", "house", "electronic"],
     "avg_price": 18.0, "rating": 4.7, "features": ["rooftop", "iconic_location"],
     "hours": {d: {"open": d in ["thu","fri","sat"], "from": "23:00", "to": "06:00"} for d in ["mon","tue","wed","thu","fri","sat","sun"]},
     "photos": ["https://images.unsplash.com/photo-1630395822970-acd6a691d97e?crop=entropy&cs=srgb&fm=jpg&q=85"]},
    {"name": "Le Petit Salon", "address": "5 Quai Romain Rolland, 69005 Lyon", "lat": 45.7610, "lng": 4.8262,
     "description": "Bar à cocktails feutré dans le Vieux Lyon. DJ live le week-end.", "music_styles": ["jazz", "soul", "house"],
     "avg_price": 12.0, "rating": 4.5, "features": ["cocktail_bar", "intimate"],
     "hours": {d: {"open": True, "from": "18:00", "to": "02:00"} for d in ["mon","tue","wed","thu","fri","sat","sun"]},
     "photos": ["https://images.unsplash.com/photo-1569924995012-c4c706bfcd51?crop=entropy&cs=srgb&fm=jpg&q=85"]},
    # ---------- Marseille ----------
    {"name": "Cabaret Aléatoire", "address": "41 Rue Jobin, 13003 Marseille", "lat": 43.3083, "lng": 5.3815,
     "description": "Référence électro à La Friche Belle de Mai. Sets internationaux toute l'année.", "music_styles": ["techno", "house", "electronic"],
     "avg_price": 16.0, "rating": 4.6, "features": ["live_music", "cultural"],
     "hours": {d: {"open": d in ["fri","sat"], "from": "23:00", "to": "06:00"} for d in ["mon","tue","wed","thu","fri","sat","sun"]},
     "photos": ["https://images.unsplash.com/photo-1581417478175-a9ef18f210c2?crop=entropy&cs=srgb&fm=jpg&q=85"]},
    {"name": "R2 Rooftop", "address": "9 Quai du Lazaret, 13002 Marseille", "lat": 43.3076, "lng": 5.3674,
     "description": "Rooftop sur les Terrasses du Port avec vue sur la Méditerranée.", "music_styles": ["house", "disco", "commercial"],
     "avg_price": 20.0, "rating": 4.4, "features": ["rooftop", "terrasse", "waterfront"],
     "hours": {d: {"open": d in ["thu","fri","sat"], "from": "20:00", "to": "03:00"} for d in ["mon","tue","wed","thu","fri","sat","sun"]},
     "photos": ["https://images.pexels.com/photos/15648325/pexels-photo-15648325.jpeg"]},
    # ---------- Bordeaux ----------
    {"name": "I.Boat", "address": "Quai Armand Lalande, 33300 Bordeaux", "lat": 44.8693, "lng": -0.5535,
     "description": "Club et salle de concert sur un ancien ferry. Programmation électro pointue.", "music_styles": ["electronic", "techno", "indie"],
     "avg_price": 14.0, "rating": 4.5, "features": ["waterfront", "live_music"],
     "hours": {d: {"open": d in ["thu","fri","sat"], "from": "23:00", "to": "06:00"} for d in ["mon","tue","wed","thu","fri","sat","sun"]},
     "photos": ["https://images.pexels.com/photos/3696396/pexels-photo-3696396.jpeg"]},
    # ---------- Nice ----------
    {"name": "High Club", "address": "45-47 Promenade des Anglais, 06000 Nice", "lat": 43.6929, "lng": 7.2563,
     "description": "Le club emblématique de la Promenade des Anglais. Vue mer et DJ stars.", "music_styles": ["house", "commercial", "hip-hop"],
     "avg_price": 22.0, "rating": 4.3, "features": ["vip", "waterfront", "iconic_location"],
     "hours": {d: {"open": d in ["thu","fri","sat"], "from": "23:30", "to": "06:00"} for d in ["mon","tue","wed","thu","fri","sat","sun"]},
     "photos": ["https://images.unsplash.com/photo-1708449530105-ea7d453a6f89?crop=entropy&cs=srgb&fm=jpg&q=85"]},
    # ---------- Toulouse ----------
    {"name": "Le Bikini", "address": "Rue Théodore Monod, 31520 Ramonville", "lat": 43.5460, "lng": 1.4790,
     "description": "Salle de concert et club mythique de Toulouse. Référence électro et indie.", "music_styles": ["electronic", "rock", "indie"],
     "avg_price": 15.0, "rating": 4.6, "features": ["live_music"],
     "hours": {d: {"open": d in ["fri","sat"], "from": "23:00", "to": "06:00"} for d in ["mon","tue","wed","thu","fri","sat","sun"]},
     "photos": ["https://images.unsplash.com/photo-1545128485-c400e7702796?crop=entropy&cs=srgb&fm=jpg&q=85"]},
    # ---------- Lille ----------
    {"name": "Magazine Club", "address": "Avenue Willy Brandt, 59000 Lille", "lat": 50.6356, "lng": 3.0698,
     "description": "Club techno et house au cœur d'Euralille. Programmation pointue.", "music_styles": ["techno", "house"],
     "avg_price": 14.0, "rating": 4.4, "features": ["underground"],
     "hours": {d: {"open": d in ["fri","sat"], "from": "23:30", "to": "06:00"} for d in ["mon","tue","wed","thu","fri","sat","sun"]},
     "photos": ["https://images.unsplash.com/photo-1578736641330-3155e606cd40?crop=entropy&cs=srgb&fm=jpg&q=85"]},
]


def _booking_url(club_name: str) -> str:
    """Return a real-world booking deep link search for the venue."""
    q = club_name.replace(" ", "+").replace("'", "%27")
    return f"https://www.shotgun.live/search?q={q}"


def _event_date(days: int, hour: int = 23) -> datetime:
    base = datetime.now(timezone.utc) + timedelta(days=days)
    return base.replace(hour=hour, minute=0, second=0, microsecond=0)


@app.on_event("startup")
async def startup():
    # Indexes
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    try:
        await db.user_sessions.create_index(
            "expires_at", expireAfterSeconds=0
        )
    except Exception:
        pass
    await db.clubs.create_index("club_id", unique=True)
    await db.events.create_index("event_id", unique=True)

    # Club moments (Moment) — TTL index on expires_at for auto-cleanup
    # plus query indexes for hot paths.
    try:
        await db.club_moments.create_index("expires_at", expireAfterSeconds=0)
        await db.club_moments.create_index([("club_id", 1), ("expires_at", -1)])
        await db.club_moments.create_index([("user_id", 1), ("created_at", -1)])
        await db.club_moments.create_index("checkin_id", unique=True, sparse=True)
        await db.club_moments.create_index("moment_id", unique=True)
    except Exception as e:
        logging.warning(f"club_moments index init failed: {e}")

    # Seed clubs — initial Paris set
    from clubs_extra import EXTRA_CLUBS
    count = await db.clubs.count_documents({})
    if count == 0:
        seeded = []
        for c in PARIS_CLUBS:
            club_id = f"club_{uuid.uuid4().hex[:10]}"
            seeded.append({"club_id": club_id, **c})
        await db.clubs.insert_many(seeded)
        # Seed events for some clubs
        events = []
        dj_names = [
            "DJ Snake", "Folamour", "Amelie Lens", "Charlotte de Witte",
            "Peggy Gou", "DJ Tennis", "Boris Brejcha", "Hugel",
        ]
        for i, club in enumerate(seeded[:8]):
            events.append(
                {
                    "event_id": f"evt_{uuid.uuid4().hex[:10]}",
                    "club_id": club["club_id"],
                    "title": f"{dj_names[i]} at {club['name']}",
                    "description": f"Une soirée d'exception avec {dj_names[i]} aux platines.",
                    "dj": dj_names[i],
                    "date": _event_date(i + 1, 23).isoformat(),
                    "entry_price": 15.0 + (i * 5),
                    "photo": club["photos"][0],
                    "booking_url": _booking_url(club["name"]),
                }
            )
        await db.events.insert_many(events)
        logging.info(f"Seeded {len(seeded)} clubs and {len(events)} events.")

    # Backfill extra clubs (Lyon, Marseille, Le Mans, etc.) so users
    # outside Paris also see a populated map and swipe deck.
    existing_names = set(
        c["name"] for c in await db.clubs.find({}, {"name": 1, "_id": 0}).to_list(2000)
    )
    new_extra = [c for c in EXTRA_CLUBS if c["name"] not in existing_names]
    if new_extra:
        DEFAULT_HOURS = {
            "mon": {"open": False},
            "tue": {"open": False},
            "wed": {"open": True, "from": "22:00", "to": "04:00"},
            "thu": {"open": True, "from": "22:00", "to": "04:00"},
            "fri": {"open": True, "from": "23:00", "to": "06:00"},
            "sat": {"open": True, "from": "23:00", "to": "06:00"},
            "sun": {"open": False},
        }
        seeded_extra = []
        for c in new_extra:
            seeded_extra.append(
                {
                    "club_id": f"club_{uuid.uuid4().hex[:10]}",
                    "hours": DEFAULT_HOURS,
                    **c,
                }
            )
        await db.clubs.insert_many(seeded_extra)
        # Add a couple of events around the new clubs
        extra_djs = [
            "Vitalic", "Laurent Garnier", "Joris Voorn", "Maceo Plex",
            "DJ Koze", "Adam Beyer", "Cassius", "Justice",
            "Solomun", "Tale of Us", "Nicolas Jaar", "Bicep",
        ]
        extra_events = []
        for i, club in enumerate(seeded_extra[:12]):
            extra_events.append(
                {
                    "event_id": f"evt_{uuid.uuid4().hex[:10]}",
                    "club_id": club["club_id"],
                    "title": f"{extra_djs[i % len(extra_djs)]} live at {club['name']}",
                    "description": f"Soirée exclusive avec {extra_djs[i % len(extra_djs)]} — line-up éclectique jusqu'à l'aube.",
                    "dj": extra_djs[i % len(extra_djs)],
                    "date": _event_date(i + 1, 23).isoformat(),
                    "entry_price": 12.0 + (i * 2),
                    "photo": club["photos"][0],
                    "booking_url": _booking_url(club["name"]),
                }
            )
        if extra_events:
            await db.events.insert_many(extra_events)
        logging.info(
            f"Seeded {len(seeded_extra)} extra clubs and {len(extra_events)} extra events."
        )

    # Seed sample notifications
    notif_count = await db.notifications.count_documents({})
    if notif_count == 0:
        now = datetime.now(timezone.utc)
        await db.notifications.insert_many([
            {
                "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
                "user_id": None,
                "title": "Nouveaux événements ce week-end 🎉",
                "body": "Découvre les soirées les plus chaudes de Paris.",
                "type": "event",
                "created_at": now - timedelta(minutes=12),
            },
            {
                "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
                "user_id": None,
                "title": "-20% sur Club Rex jusqu'à minuit",
                "body": "Profite d'un tarif réduit pour la nuit prochaine.",
                "type": "promo",
                "created_at": now - timedelta(minutes=34),
            },
            {
                "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
                "user_id": None,
                "title": "Une soirée près de chez toi 📍",
                "body": "L'Arc Paris ouvre dans 2h, à 3km de ta position.",
                "type": "nearby",
                "created_at": now - timedelta(minutes=58),
            },
            {
                "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
                "user_id": None,
                "title": "🔥 Folamour confirmé ce vendredi",
                "body": "Une nuit techno-house qui s'annonce mémorable au Concrete.",
                "type": "event",
                "created_at": now - timedelta(hours=2, minutes=5),
            },
            {
                "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
                "user_id": None,
                "title": "Tu es dans une nouvelle ville ? 🌍",
                "body": "On a déjà 23 spots à te recommander dans le coin.",
                "type": "nearby",
                "created_at": now - timedelta(hours=4),
            },
            {
                "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
                "user_id": None,
                "title": "🎟 Last call : Pachamama",
                "body": "Plus que 12 entrées disponibles pour samedi.",
                "type": "promo",
                "created_at": now - timedelta(hours=6),
            },
            {
                "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
                "user_id": None,
                "title": "Ton style musical bouge 🎧",
                "body": "On a détecté 4 nouveaux clubs Afro-House à tester ce mois-ci.",
                "type": "event",
                "created_at": now - timedelta(hours=12),
            },
            {
                "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
                "user_id": None,
                "title": "🥇 Top spot de la semaine",
                "body": "Silencio domine les avis des fêtards avec 4.8★ cette semaine.",
                "type": "event",
                "created_at": now - timedelta(days=1),
            },
        ])


@api_router.get("/")
async def root():
    return {"service": "night-finder", "status": "ok"}


# ---------------------------------------------------------------------------
# Billing — RevenueCat webhook & premium status
# ---------------------------------------------------------------------------
PREMIUM_ENTITLEMENT_ID = os.environ.get("PREMIUM_ENTITLEMENT_ID", "premium")
REVENUECAT_WEBHOOK_SECRET = os.environ.get("REVENUECAT_WEBHOOK_SECRET", "").strip().strip(chr(34)).strip(chr(39))


async def _apply_rc_event(payload: dict) -> bool:
    """Apply a RevenueCat webhook event to the user document.

    Returns True if applied, False if duplicate / ignored.
    Idempotent: stores rc_last_event_id to skip already-processed events.
    """
    event = (payload or {}).get("event") or {}
    subscriber = event.get("subscriber") or (payload or {}).get("subscriber") or {}
    app_user_id = event.get("app_user_id") or subscriber.get("app_user_id")
    event_id = event.get("id")
    event_type = (event.get("type") or "").upper()
    environment = (event.get("environment") or "").upper()
    if not app_user_id:
        return False

    # ⭐ Achat d'une mise en avant de bar (produit consommable promo_bar_*)
    # → active la promotion, ne touche PAS au statut premium.
    rc_product = event.get("product_id") or ""
    if rc_product in PROMO_PRODUCTS and event_type in (
        "NON_RENEWING_PURCHASE", "INITIAL_PURCHASE", "PURCHASE_REDEEMED",
    ):
        return await _handle_promo_purchase_event(app_user_id, rc_product)

    # Idempotency: skip if we already processed this event_id for this user
    if event_id:
        existing = await db.users.find_one(
            {"user_id": app_user_id, "rc_last_event_id": event_id},
            {"_id": 1},
        )
        if existing:
            logging.info("RC webhook duplicate skipped: %s for %s", event_id, app_user_id)
            return False

    entitlements = subscriber.get("entitlements") or {}
    ent = entitlements.get(PREMIUM_ENTITLEMENT_ID) or {}

    # Refund detection (CANCELLATION with CUSTOMER_SUPPORT reason)
    cancellation_reason = (event.get("cancellation_reason") or "").upper()
    is_refund = event_type == "CANCELLATION" and cancellation_reason == "CUSTOMER_SUPPORT"

    # Compute new is_premium state
    grant_events = {
        "INITIAL_PURCHASE",
        "RENEWAL",
        "PRODUCT_CHANGE",
        "UNCANCELLATION",
        "NON_RENEWING_PURCHASE",
        "PURCHASE_REDEEMED",
        "TRANSFER",
    }
    revoke_events = {
        "EXPIRATION",
        "SUBSCRIPTION_PAUSED",
    }
    if event_type in grant_events:
        is_active = True
    elif event_type in revoke_events:
        is_active = False
    elif is_refund:
        is_active = False
    elif event_type == "CANCELLATION":
        # Non-refund cancellation: keep premium until EXPIRATION arrives
        is_active = None
    elif event_type == "BILLING_ISSUE":
        # Grace period — keep premium, surface warning
        is_active = None
    else:
        is_active = bool(ent.get("expires_date"))

    expiration = ent.get("expires_date") or event.get("expiration_at_ms")
    update: dict = {
        "rc_last_event": event_type,
        "rc_last_event_id": event_id,
        "rc_environment": environment,
        "rc_updated_at": datetime.now(timezone.utc),
    }
    if is_active is not None:
        update["is_premium"] = is_active
    if expiration is not None:
        update["premium_expires_at"] = expiration
    product = ent.get("product_identifier") or event.get("product_id")
    if product:
        update["premium_product_id"] = product

    await db.users.update_one(
        {"user_id": app_user_id},
        {"$set": update},
        upsert=False,
    )
    logging.info("RC webhook applied: %s for %s (premium=%s)", event_type, app_user_id, is_active)
    return True


@api_router.post("/billing/webhook")
async def revenuecat_webhook(request: Request):
    """Legacy alias of /api/webhooks/revenuecat (kept for backward compat)."""
    return await _revenuecat_webhook_impl(request)


@api_router.post("/webhooks/revenuecat")
async def revenuecat_webhook_v2(request: Request):
    """Recommended public webhook URL for RevenueCat dashboard.

    Configure this in RevenueCat → Integrations → Webhooks:
      URL: https://<your-domain>/api/webhooks/revenuecat
      Authorization header: <REVENUECAT_WEBHOOK_SECRET from backend/.env>
    """
    return await _revenuecat_webhook_impl(request)


async def _revenuecat_webhook_impl(request: Request):
    if REVENUECAT_WEBHOOK_SECRET:
        auth = request.headers.get("authorization", "")
        # Accept both raw secret and "Bearer <secret>" formats
        token = auth.split(" ", 1)[1] if auth.lower().startswith("bearer ") else auth
        if token != REVENUECAT_WEBHOOK_SECRET:
            raise HTTPException(status_code=401, detail="invalid webhook secret")
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid json")
    try:
        await _apply_rc_event(payload)
    except Exception as exc:  # noqa: BLE001
        logging.warning("RC webhook processing error: %s", exc)
    return {"ok": True}


@api_router.get("/billing/me")
async def get_my_billing(user: dict = Depends(get_current_user)):
    """Return the current user's premium status.

    Tries to refresh from RevenueCat's REST API when a secret key is
    configured, then falls back to the MongoDB-cached state populated by
    webhooks.
    """
    user_id = user.get("user_id")
    rc_secret = os.environ.get("REVENUECAT_SECRET_KEY", "").strip().strip(chr(34)).strip(chr(39))
    if rc_secret and http_client is not None:
        try:
            r = await http_client.get(
                f"https://api.revenuecat.com/v1/subscribers/{user_id}",
                headers={
                    "Authorization": f"Bearer {rc_secret}",
                    "Accept": "application/json",
                },
                timeout=8.0,
            )
            if r.status_code == 200:
                data = r.json()
                ent = (
                    (data.get("subscriber") or {})
                    .get("entitlements", {})
                    .get(PREMIUM_ENTITLEMENT_ID)
                    or {}
                )
                expires = ent.get("expires_date")
                is_active = False
                if expires:
                    try:
                        exp = datetime.fromisoformat(expires.replace("Z", "+00:00"))
                        is_active = exp > datetime.now(timezone.utc)
                    except Exception:
                        is_active = bool(expires)
                await db.users.update_one(
                    {"user_id": user_id},
                    {
                        "$set": {
                            "is_premium": is_active,
                            "premium_product_id": ent.get("product_identifier"),
                            "premium_expires_at": expires,
                            "rc_updated_at": datetime.now(timezone.utc),
                        }
                    },
                    upsert=False,
                )
                return {
                    "is_premium": is_active,
                    "product_id": ent.get("product_identifier"),
                    "expires_at": expires,
                    "source": "revenuecat",
                }
        except Exception as exc:  # noqa: BLE001
            logging.warning("RC me lookup failed: %s", exc)
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0}) or {}
    return {
        "is_premium": bool(u.get("is_premium")),
        "product_id": u.get("premium_product_id"),
        "expires_at": u.get("premium_expires_at"),
        "source": "cache",
    }


# ---------------------------------------------------------------------------
# Block / Report / Delete account / Export — Apple App Store compliance
# (Guidelines 1.2 UGC, 5.1.1(v) account deletion, RGPD Art.20 portability)
# ---------------------------------------------------------------------------




# ---------------------------------------------------------------------------
# Block / Report / Delete account / Export — Apple App Store compliance
# (Guidelines 1.2 UGC, 5.1.1(v) account deletion, RGPD Art.20 portability)
# ---------------------------------------------------------------------------


class ModerationCheckBody(BaseModel):
    image: str  # base64 or data URI


class VerifyFaceBody(BaseModel):
    selfie: str  # base64 ou data URI du selfie live


@api_router.post("/verify/face")
async def verify_face_endpoint(body: VerifyFaceBody, user: dict = Depends(get_current_user)):
    """Vérification de profil par IA : compare un selfie live aux photos du
    profil. Si même personne → badge « vérifié » sur le profil swipe."""
    if user.get("verified"):
        return {"ok": True, "verified": True, "reason": "Profil déjà vérifié"}
    photos = user.get("photos") or []
    if not photos:
        raise HTTPException(status_code=409, detail="Ajoute d'abord au moins une photo à ton profil swipe.")
    # Anti-abus : 5 tentatives max par jour
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    attempts = await db.verify_attempts.count_documents(
        {"user_id": user["user_id"], "created_at": {"$gte": day_start}}
    )
    if attempts >= 5:
        raise HTTPException(status_code=429, detail="Trop de tentatives aujourd'hui — réessaie demain.")
    await db.verify_attempts.insert_one(
        {"user_id": user["user_id"], "created_at": datetime.now(timezone.utc)}
    )
    from moderation_service import verify_face
    verdict = await verify_face(body.selfie, photos, session_id=f"verify-{user['user_id']}")
    ok = bool(verdict.get("same_person")) and float(verdict.get("confidence") or 0) >= 0.7
    if ok:
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"verified": True, "verified_at": datetime.now(timezone.utc)}},
        )
    return {
        "ok": True,
        "verified": ok,
        "confidence": verdict.get("confidence"),
        "reason": verdict.get("reason") or (
            "C'est bien toi — profil vérifié 🎉" if ok else "Le selfie ne correspond pas assez aux photos du profil."
        ),
    }


@api_router.post("/moderation/check-image")
async def moderation_check_image(
    body: ModerationCheckBody, user: dict = Depends(get_current_user)
):
    """Run Gemini-Flash vision moderation on a single image.

    Returns a structured safety verdict. Used by the frontend to give live
    feedback before saving a photo to the profile.
    """
    from moderation_service import moderate_image
    verdict = await moderate_image(body.image, session_id=f"check-{user['user_id']}")
    return verdict


ALLOWED_REPORT_REASONS = {
    "harassment",
    "inappropriate_photos",
    "spam",
    "fake_profile",
    "underage",
    "hate_speech",
    "other",
}


async def _blocked_user_ids(me_id: str) -> set:
    """Return the set of user_ids the current user CANNOT interact with
    (people they blocked + people who blocked them)."""
    blocked = await db.user_blocks.find(
        {"$or": [{"blocker_id": me_id}, {"blocked_id": me_id}]},
        {"_id": 0, "blocker_id": 1, "blocked_id": 1},
    ).to_list(2000)
    out: set = set()
    for b in blocked:
        out.add(b["blocker_id"])
        out.add(b["blocked_id"])
    out.discard(me_id)
    return out


@api_router.post("/blocks", status_code=201)
async def block_user(body: BlockBody, user: dict = Depends(get_current_user)):
    if body.target_user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="On ne peut pas se bloquer soi-même")
    target = await db.users.find_one({"user_id": body.target_user_id}, {"_id": 0, "user_id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    await db.user_blocks.update_one(
        {"blocker_id": user["user_id"], "blocked_id": body.target_user_id},
        {"$set": {
            "blocker_id": user["user_id"],
            "blocked_id": body.target_user_id,
            "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    # Best-effort: also remove any pending match request between the two
    await db.match_requests.update_many(
        {
            "$or": [
                {"from_user_id": user["user_id"], "to_user_id": body.target_user_id},
                {"from_user_id": body.target_user_id, "to_user_id": user["user_id"]},
            ],
            "status": "pending",
        },
        {"$set": {"status": "blocked", "blocked_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True}


@api_router.delete("/blocks/{target_user_id}")
async def unblock_user(target_user_id: str, user: dict = Depends(get_current_user)):
    res = await db.user_blocks.delete_one(
        {"blocker_id": user["user_id"], "blocked_id": target_user_id}
    )
    return {"ok": True, "removed": res.deleted_count}


@api_router.get("/blocks")
async def list_blocks(user: dict = Depends(get_current_user)):
    cursor = db.user_blocks.find(
        {"blocker_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", -1)
    rows = await cursor.to_list(500)
    if not rows:
        return []
    ids = [r["blocked_id"] for r in rows]
    users = await db.users.find(
        {"user_id": {"$in": ids}},
        {"_id": 0, "user_id": 1, "name": 1, "username": 1, "picture": 1, "photos": 1},
    ).to_list(500)
    umap = {u["user_id"]: u for u in users}
    out = []
    for r in rows:
        u = umap.get(r["blocked_id"]) or {"user_id": r["blocked_id"]}
        out.append({
            "user_id": u.get("user_id"),
            "name": u.get("name"),
            "username": u.get("username"),
            "photo": (u.get("photos") or [None])[0] or u.get("picture"),
            "blocked_at": r.get("created_at"),
        })
    return out


@api_router.post("/reports", status_code=201)
async def report_user(body: ReportBody, user: dict = Depends(get_current_user)):
    reason = (body.reason or "").strip().lower()
    if reason not in ALLOWED_REPORT_REASONS:
        raise HTTPException(status_code=400, detail="Motif de signalement invalide")
    if body.target_user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="On ne peut pas se signaler soi-même")
    target = await db.users.find_one({"user_id": body.target_user_id}, {"_id": 0, "user_id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    details = (body.details or "")[:500]
    context = (body.context or "")[:50]
    report_id = f"rep_{uuid.uuid4().hex[:10]}"
    await db.user_reports.insert_one({
        "report_id": report_id,
        "reporter_id": user["user_id"],
        "reported_id": body.target_user_id,
        "reason": reason,
        "context": context,
        "details": details,
        "status": "open",
        "created_at": datetime.now(timezone.utc),
    })
    logger.warning(
        "user_report received report_id=%s reporter=%s reported=%s reason=%s",
        report_id, user["user_id"], body.target_user_id, reason,
    )
    return {"ok": True, "report_id": report_id}


# ==================== MOMENT EVENTS (BeReal-style) ==================== #

class MomentEventTrigger(BaseModel):
    duration_min: int = 10
    title: Optional[str] = None


@api_router.post("/admin/moment-events/trigger")
async def trigger_moment_event(body: MomentEventTrigger, admin: dict = Depends(require_admin)):
    """Start a BeReal-style event: everyone gets a push and has N minutes
    to capture a Moment. The countdown is based on the SERVER end time."""
    now = datetime.now(timezone.utc)
    duration = max(2, min(120, body.duration_min))
    event = {
        "event_id": f"mev_{uuid.uuid4().hex[:10]}",
        "title": body.title or "⚡ Moment Night Finder",
        "starts_at": now,
        "ends_at": now + timedelta(minutes=duration),
        "duration_min": duration,
        "created_at": now,
        "created_by": admin["user_id"],
    }
    await db.moment_events.insert_one({**event})
    # Push to all real users, chunked (max 100 recipients / call)
    user_ids = [
        u["user_id"]
        async for u in db.users.find(
            {"is_virtual": {"$ne": True}, "banned": {"$ne": True}},
            {"_id": 0, "user_id": 1},
        )
    ]
    sent = 0
    for i in range(0, len(user_ids), 100):
        chunk = user_ids[i:i + 100]
        try:
            await push_service.send_push(
                recipients=chunk,
                title=event["title"],
                message=f"C'est maintenant ! Tu as {duration} minutes pour capturer ta soirée. 📸",
                action_url="/moment-event",
                idempotency_key=f"mev_{event['event_id']}_{i}",
            )
            sent += len(chunk)
        except Exception as e:
            logger.warning("moment event push chunk failed: %s", e)
    event.pop("_id", None)
    return {
        "ok": True,
        "event": {**event, "starts_at": event["starts_at"].isoformat(), "ends_at": event["ends_at"].isoformat(), "created_at": event["created_at"].isoformat()},
        "notified": sent,
        "total_users": len(user_ids),
    }


@api_router.get("/moment-events/current")
async def current_moment_event(user: dict = Depends(get_current_user)):
    """Latest event still relevant (active, or ended < 10 min ago).
    Returns server_time so all devices compute the SAME remaining time."""
    now = datetime.now(timezone.utc)
    ev = await db.moment_events.find_one(
        {"ends_at": {"$gt": now - timedelta(minutes=10)}},
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    if ev:
        for k in ("starts_at", "ends_at", "created_at"):
            v = ev.get(k)
            if v is not None:
                if getattr(v, "tzinfo", None) is None:
                    v = v.replace(tzinfo=timezone.utc)
                ev[k] = v.isoformat()
    return {"event": ev, "server_time": now.isoformat()}


@api_router.get("/users/{user_id}/profile")
async def get_user_public_profile(user_id: str, user: dict = Depends(get_current_user)):
    """Detailed public profile of another user: bio, photos, stats,
    past moments (last 7 days) and friendship status with the viewer."""
    me = user["user_id"]
    blocked = await _blocked_user_ids(me)
    if user_id in blocked:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target or target.get("banned"):
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    profile = _profile_for_swipe(target)
    profile["picture"] = target.get("picture") or ((target.get("photos") or [None])[0])
    profile["is_premium"] = bool(target.get("is_premium"))
    created = target.get("created_at")
    profile["member_since"] = created.isoformat() if hasattr(created, "isoformat") else created

    # ---- Stats ----
    friends_count = await db.friendships.count_documents(
        {"status": "accepted", "$or": [{"from_user_id": user_id}, {"to_user_id": user_id}]}
    )
    checkins_count = await db.checkins.count_documents({"user_id": user_id, "confirmed": True})
    moments_count = await db.club_moments.count_documents({"user_id": user_id})
    likes_received = 0
    try:
        mids = [
            m["moment_id"]
            async for m in db.club_moments.find({"user_id": user_id}, {"_id": 0, "moment_id": 1}).limit(200)
        ]
        if mids:
            likes_received = await db.moment_likes.count_documents({"moment_id": {"$in": mids}})
    except Exception:
        pass
    profile["stats"] = {
        "friends": friends_count,
        "checkins": checkins_count,
        "moments": moments_count,
        "likes_received": likes_received,
    }

    # ---- Recent moments (same shape as /me/moments, capped at 24) ----
    now = datetime.now(timezone.utc)
    moments = await db.club_moments.find(
        {"user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).limit(24).to_list(24)
    club_ids = list({m.get("club_id") for m in moments if m.get("club_id")})
    name_map: dict = {}
    if club_ids:
        async for c in db.clubs.find({"club_id": {"$in": club_ids}}, {"_id": 0, "club_id": 1, "name": 1}):
            name_map[c["club_id"]] = c.get("name")
    for m in moments:
        m["club_name"] = name_map.get(m.get("club_id"))
        exp = m.get("expires_at")
        if exp is not None and getattr(exp, "tzinfo", None) is None:
            exp = exp.replace(tzinfo=timezone.utc)
        m["active"] = bool(exp and exp > now)
    profile["moments"] = moments

    # ---- Friendship status with viewer ----
    friendship = {"status": "none", "friendship_id": None}
    if user_id != me:
        fs = await db.friendships.find_one(
            {
                "$or": [
                    {"from_user_id": me, "to_user_id": user_id},
                    {"from_user_id": user_id, "to_user_id": me},
                ]
            },
            {"_id": 0},
        )
        if fs:
            if fs.get("status") == "accepted":
                friendship = {"status": "accepted", "friendship_id": fs.get("friendship_id")}
            elif fs.get("from_user_id") == me:
                friendship = {"status": "pending_out", "friendship_id": fs.get("friendship_id")}
            else:
                friendship = {"status": "pending_in", "friendship_id": fs.get("friendship_id")}
    profile["friendship"] = friendship
    profile["is_me"] = user_id == me
    return profile


@api_router.get("/users/search")
async def users_search(
    q: str = "",
    limit: int = 20,
    min_age: Optional[int] = None,
    max_age: Optional[int] = None,
    city: Optional[str] = None,
    music: Optional[str] = None,
    premium_only: bool = False,
    user: dict = Depends(get_current_user),
):
    """Public user search — by name/bio + optional filters (age, city, music).

    Excludes admin/hidden accounts + the caller + blocked users.
    A query `q` OR at least one filter is required.
    """
    q = (q or "").strip()
    has_filters = any([min_age, max_age, (city or "").strip(), (music or "").strip(), premium_only])
    if len(q) < 2 and not has_filters:
        return {"users": [], "count": 0}
    blocked = await _blocked_user_ids(user["user_id"])
    query: dict = {
        "is_admin": {"$ne": True},
        "visibility": {"$nin": ["hidden", "private"]},
        "user_id": {"$nin": list(blocked) + [user["user_id"]]},
    }
    if len(q) >= 2:
        safe = "".join(f"\\{ch}" if ch in ".^$*+?()[]{}|" else ch for ch in q)
        query["$or"] = [
            {"name": {"$regex": safe, "$options": "i"}},
            {"bio": {"$regex": safe, "$options": "i"}},
        ]
    if city and city.strip():
        safe_city = "".join(f"\\{ch}" if ch in ".^$*+?()[]{}|" else ch for ch in city.strip())
        query["city"] = {"$regex": safe_city, "$options": "i"}
    if music and music.strip():
        # music may be a comma separated list of tags
        tags = [t.strip() for t in music.split(",") if t.strip()]
        if tags:
            # MongoDB does not allow {"$regex": ...} inside $in — must use
            # compiled regex objects (BSON regex).
            regexes = [_re.compile(_re.escape(t), _re.IGNORECASE) for t in tags]
            query["music"] = {"$in": regexes}
    if premium_only:
        query["is_premium"] = True

    # Age filter -> DoB year range
    now_year = datetime.now().year
    if min_age or max_age:
        dob_year_min = None
        dob_year_max = None
        if max_age:
            dob_year_min = str(now_year - int(max_age))
        if min_age:
            dob_year_max = str(now_year - int(min_age)) + "-12-31"
        dob_q: dict = {}
        if dob_year_min:
            dob_q["$gte"] = dob_year_min
        if dob_year_max:
            dob_q["$lte"] = dob_year_max
        if dob_q:
            query["dob"] = dob_q

    limit = max(1, min(limit, 50))
    cursor = db.users.find(
        query,
        {
            "_id": 0, "user_id": 1, "name": 1, "picture": 1, "photos": 1,
            "city": 1, "is_premium": 1, "is_bot": 1, "dob": 1, "bio": 1,
            "music": 1,
        },
    ).limit(limit)
    rows = await cursor.to_list(limit)
    results = []
    for u in rows:
        age = None
        if isinstance(u.get("dob"), str) and len(u["dob"]) >= 4:
            try:
                age = now_year - int(u["dob"][:4])
            except ValueError:
                pass
        results.append({
            "user_id": u["user_id"],
            "name": u.get("name") or "?",
            "picture": u.get("picture") or ((u.get("photos") or [None])[0]),
            "city": u.get("city"),
            "bio": (u.get("bio") or "")[:120],
            "is_premium": bool(u.get("is_premium")),
            "is_bot": bool(u.get("is_bot")),
            "age": age,
            "music": u.get("music") or [],
        })
    return {"users": results, "count": len(results)}


@api_router.get("/users/nearby")
async def users_nearby(
    lat: float,
    lng: float,
    radius_km: float = 10.0,
    limit: int = 50,
    user: dict = Depends(get_current_user),
):
    """Return public profiles located within `radius_km` of (lat,lng).

    Only users with a `location` field (like bots and geo-shared users) show up.
    Admin & hidden accounts are excluded. Each entry contains a light payload
    optimised for map markers.
    """
    # Approx bounding box (fast pre-filter, then precise distance check).
    # 1° latitude ≈ 111 km; longitude compensated with cos(lat).
    lat_delta = radius_km / 111.0
    lng_delta = radius_km / (111.0 * max(math.cos(math.radians(lat)), 0.01))

    blocked = await _blocked_user_ids(user["user_id"])
    exclude = set(blocked) | {user["user_id"]}

    cursor = db.users.find(
        {
            "location.lat": {"$gte": lat - lat_delta, "$lte": lat + lat_delta},
            "location.lng": {"$gte": lng - lng_delta, "$lte": lng + lng_delta},
            "user_id": {"$nin": list(exclude)},
            "visibility": {"$nin": ["hidden", "private"]},
        },
        {
            "_id": 0,
            "user_id": 1,
            "name": 1,
            "picture": 1,
            "photos": 1,
            "location": 1,
            "is_premium": 1,
            "is_bot": 1,
            "dob": 1,
        },
    ).limit(limit * 2)

    results = []
    for u in await cursor.to_list(length=limit * 2):
        loc = u.get("location") or {}
        if "lat" not in loc or "lng" not in loc:
            continue
        # Precise Haversine distance
        d = _haversine_km(lat, lng, loc["lat"], loc["lng"])
        if d > radius_km:
            continue
        photo = u.get("picture") or (u.get("photos") or [None])[0]
        # Compute age (best-effort) from DOB
        age = None
        dob = u.get("dob")
        if isinstance(dob, str) and len(dob) >= 4:
            try:
                y = int(dob[:4])
                age = datetime.now().year - y
            except ValueError:
                pass
        results.append({
            "user_id": u["user_id"],
            "name": u.get("name") or "?",
            "picture": photo,
            "lat": loc["lat"],
            "lng": loc["lng"],
            "distance_km": round(d, 2),
            "is_premium": bool(u.get("is_premium")),
            "is_bot": bool(u.get("is_bot")),
            "age": age,
        })
        if len(results) >= limit:
            break
    # Nearest first
    results.sort(key=lambda r: r["distance_km"])
    return {"users": results, "count": len(results)}


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two lat/lng points, in kilometres."""
    r = 6371.0088  # mean Earth radius km
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    return r * c


@api_router.get("/users/me/export")
async def export_my_data(user: dict = Depends(get_current_user)):
    """RGPD Art. 20 — Right to data portability.

    Returns all data we hold about the current user as a JSON object."""
    uid = user["user_id"]
    me = await db.users.find_one({"user_id": uid}, {"_id": 0, "password_hash": 0})
    swipes = await db.user_swipes.find({"user_id": uid}, {"_id": 0}).to_list(5000)
    match_requests = await db.match_requests.find(
        {"$or": [{"from_user_id": uid}, {"to_user_id": uid}]}, {"_id": 0}
    ).to_list(5000)
    matches = await db.matches.find(
        {"$or": [{"user_a": uid}, {"user_b": uid}]}, {"_id": 0}
    ).to_list(2000)
    match_ids = [m["match_id"] for m in matches]
    messages = await db.match_messages.find(
        {"$or": [{"from_user_id": uid}, {"match_id": {"$in": match_ids}}]}, {"_id": 0}
    ).to_list(10000) if match_ids else []
    checkins = await db.checkins.find({"user_id": uid}, {"_id": 0}).to_list(5000)
    songs = await db.profile_songs.find({"user_id": uid}, {"_id": 0}).to_list(5000)
    friends = await db.friendships.find(
        {"$or": [{"user_a": uid}, {"user_b": uid}]}, {"_id": 0}
    ).to_list(5000)
    notifs = await db.notifications.find({"user_id": uid}, {"_id": 0}).to_list(2000)
    blocks = await db.user_blocks.find(
        {"$or": [{"blocker_id": uid}, {"blocked_id": uid}]}, {"_id": 0}
    ).to_list(2000)
    events = await db.events.find({"creator_id": uid}, {"_id": 0}).to_list(2000)
    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user": me,
        "swipes": swipes,
        "match_requests": match_requests,
        "matches": matches,
        "messages": messages,
        "checkins": checkins,
        "detected_songs": songs,
        "friendships": friends,
        "notifications": notifs,
        "blocks": blocks,
        "events_created": events,
    }


@api_router.delete("/users/me")
async def delete_my_account(body: DeleteAccountBody, user: dict = Depends(get_current_user)):
    """Apple Guideline 5.1.1(v): in-app account deletion (mandatory since June 2022).

    Cascades the deletion across all collections that reference this user."""
    if (body.confirm or "").strip().upper() != "DELETE":
        raise HTTPException(status_code=400, detail="Confirmation manquante (champ confirm = 'DELETE')")
    uid = user["user_id"]
    # For email accounts, require password re-entry to prevent abuse
    if user.get("password_hash"):
        if not body.password or not verify_password(body.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Mot de passe incorrect")
    # Cascade delete
    collections_user_field = [
        ("user_swipes", "user_id"),
        ("user_swipes", "target_user_id"),
        ("checkins", "user_id"),
        ("profile_songs", "user_id"),
        ("notifications", "user_id"),
        ("favorites", "user_id"),
        ("push_tokens", "user_id"),
        ("user_sessions", "user_id"),
        ("user_blocks", "blocker_id"),
        ("user_blocks", "blocked_id"),
        ("user_reports", "reporter_id"),
        ("user_reports", "reported_id"),
        ("events", "creator_id"),
    ]
    for coll, field in collections_user_field:
        try:
            await db[coll].delete_many({field: uid})
        except Exception as exc:  # noqa: BLE001
            logger.warning("cascade delete %s.%s failed: %s", coll, field, exc)
    # Match-related
    try:
        await db.match_requests.delete_many(
            {"$or": [{"from_user_id": uid}, {"to_user_id": uid}]}
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("cascade match_requests failed: %s", exc)
    try:
        matches_cursor = db.matches.find(
            {"$or": [{"user_a": uid}, {"user_b": uid}]}, {"_id": 0, "match_id": 1}
        )
        match_ids = [m["match_id"] async for m in matches_cursor]
        if match_ids:
            await db.match_messages.delete_many({"match_id": {"$in": match_ids}})
            await db.matches.delete_many({"match_id": {"$in": match_ids}})
    except Exception as exc:  # noqa: BLE001
        logger.warning("cascade matches failed: %s", exc)
    # Friendships
    try:
        await db.friendships.delete_many(
            {"$or": [{"user_a": uid}, {"user_b": uid}, {"user_id": uid}, {"friend_user_id": uid}]}
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("cascade friendships failed: %s", exc)
    # Finally remove the user document
    await db.users.delete_one({"user_id": uid})
    logger.warning("account_deleted user_id=%s email=%s", uid, user.get("email"))
    return {"ok": True, "deleted_user_id": uid}


# ---------------------------------------------------------------------------
# Chat enhancements — typing indicator, read receipts, edit, delete
# ---------------------------------------------------------------------------


class EditMessageBody(BaseModel):
    text: str


@api_router.post("/matches/{match_id}/typing")
async def chat_typing(match_id: str, user: dict = Depends(get_current_user)):
    """Signal that the current user is typing in this match."""
    m = await db.matches.find_one({"match_id": match_id}, {"_id": 0})
    if not m or user["user_id"] not in (m["user_a"], m["user_b"]):
        raise HTTPException(status_code=404, detail="Match introuvable")
    await db.matches.update_one(
        {"match_id": match_id},
        {"$set": {f"typing.{user['user_id']}": datetime.now(timezone.utc)}},
    )
    return {"ok": True}


@api_router.get("/matches/{match_id}/peer-state")
async def chat_peer_state(match_id: str, user: dict = Depends(get_current_user)):
    """Returns the other user's typing status + last_read_at for this match."""
    m = await db.matches.find_one({"match_id": match_id}, {"_id": 0})
    if not m or user["user_id"] not in (m["user_a"], m["user_b"]):
        raise HTTPException(status_code=404, detail="Match introuvable")
    peer_id = m["user_a"] if m["user_b"] == user["user_id"] else m["user_b"]
    typing_map = m.get("typing") or {}
    peer_typing_at = typing_map.get(peer_id)
    now = datetime.now(timezone.utc)
    is_typing = False
    if peer_typing_at:
        if isinstance(peer_typing_at, datetime):
            is_typing = (now - peer_typing_at).total_seconds() < 6
    read_map = m.get("last_read") or {}
    peer_last_read = read_map.get(peer_id)
    return {
        "peer_user_id": peer_id,
        "is_typing": is_typing,
        "peer_last_read_at": peer_last_read.isoformat() if isinstance(peer_last_read, datetime) else peer_last_read,
    }


@api_router.post("/matches/{match_id}/read")
async def chat_mark_read(match_id: str, user: dict = Depends(get_current_user)):
    """Mark all messages of this match as read by the current user."""
    m = await db.matches.find_one({"match_id": match_id}, {"_id": 0})
    if not m or user["user_id"] not in (m["user_a"], m["user_b"]):
        raise HTTPException(status_code=404, detail="Match introuvable")
    now = datetime.now(timezone.utc)
    await db.matches.update_one(
        {"match_id": match_id},
        {"$set": {f"last_read.{user['user_id']}": now}},
    )
    # Mark unread messages from the other user as read
    res = await db.messages.update_many(
        {
            "match_id": match_id,
            "from_user_id": {"$ne": user["user_id"]},
            "read_at": {"$exists": False},
        },
        {"$set": {"read_at": now}},
    )
    return {"ok": True, "marked": res.modified_count}


@api_router.patch("/messages/{message_id}")
async def edit_message(message_id: str, body: EditMessageBody, user: dict = Depends(get_current_user)):
    msg = await db.messages.find_one({"message_id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(status_code=404, detail="Message introuvable")
    if msg["from_user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Action interdite (pas ton message)")
    # Allow edit within 15 minutes
    created_at = msg["created_at"]
    if isinstance(created_at, datetime):
        # Ensure timezone-aware comparison (MongoDB returns naive UTC datetimes)
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        if (datetime.now(timezone.utc) - created_at).total_seconds() > 900:
            raise HTTPException(status_code=403, detail="Trop tard pour modifier (>15min)")
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message vide")
    if len(text) > 1000:
        raise HTTPException(status_code=400, detail="Message trop long (max 1000)")
    now = datetime.now(timezone.utc)
    await db.messages.update_one(
        {"message_id": message_id},
        {"$set": {"text": text, "edited_at": now}},
    )
    return {"ok": True, "text": text, "edited_at": now.isoformat()}


@api_router.delete("/messages/{message_id}")
async def delete_message(message_id: str, user: dict = Depends(get_current_user)):
    msg = await db.messages.find_one({"message_id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(status_code=404, detail="Message introuvable")
    if msg["from_user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Action interdite (pas ton message)")
    await db.messages.update_one(
        {"message_id": message_id},
        {"$set": {"deleted_at": datetime.now(timezone.utc), "text": ""}},
    )
    return {"ok": True}


# ============================================================
# BAR PARTENAIRE OFFICIEL — offre -10% (Phase 1)
# ============================================================
import random as _random
import string as _string

PARTNER_CFG_ID = "config"


def _gen_partner_code(n: int = 5) -> str:
    return "NF" + "".join(_random.choices(_string.ascii_uppercase + _string.digits, k=n))


def _gen_user_coupon_code() -> str:
    return "NF-" + "".join(_random.choices(_string.ascii_uppercase + _string.digits, k=6))


async def _find_any_club(club_id: str) -> Optional[dict]:
    club = await db.places.find_one({"club_id": club_id}, {"_id": 0, "name": 1, "photos": 1})
    if not club:
        club = await db.clubs.find_one({"club_id": club_id}, {"_id": 0, "name": 1, "photos": 1})
    return club


async def _partner_config() -> Optional[dict]:
    return await db.partner_bar.find_one({"_id": PARTNER_CFG_ID})


def _partner_landing_url(request: Request, code: str) -> str:
    # Respect proxy headers so the QR/deep-link embeds the PUBLIC domain
    host = request.headers.get("x-forwarded-host") or request.url.netloc
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    return f"{proto}://{host}/api/partner/r?code={code}"


def _origin_base(request: Request) -> str:
    host = request.headers.get("x-forwarded-host") or request.url.netloc
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    return f"{proto}://{host}"


async def _find_club_by_partner_code(code: str) -> Optional[dict]:
    """Bar vérifié possédant ce code -10% individuel."""
    c = (code or "").strip().upper()
    if not c:
        return None
    club = await db.places.find_one({"partner_code": c, "verified": True}, {"_id": 0})
    if not club:
        club = await db.clubs.find_one({"partner_code": c, "verified": True}, {"_id": 0})
    return club


async def _gen_unique_bar_code() -> str:
    """Code -10% unique (jamais en collision avec le bar officiel ni un autre bar)."""
    cfg = await db.partner_bar.find_one({"_id": PARTNER_CFG_ID})
    for _ in range(20):
        code = _gen_partner_code()
        if cfg and code == cfg.get("partner_code"):
            continue
        if await db.places.find_one({"partner_code": code}, {"_id": 1}):
            continue
        if await db.clubs.find_one({"partner_code": code}, {"_id": 1}):
            continue
        return code
    return _gen_partner_code(8)


class PartnerBarBody(BaseModel):
    club_id: str
    active: bool = True
    expires_days: int = 30


@api_router.get("/admin/partner-bar")
async def admin_get_partner_bar(request: Request, _admin: dict = Depends(require_admin)):
    cfg = await _partner_config()
    if not cfg:
        return {"configured": False}
    issued = await db.partner_coupons.count_documents({"club_id": cfg["club_id"]})
    used = await db.partner_coupons.count_documents({"club_id": cfg["club_id"], "status": "used"})
    out = {k: v for k, v in cfg.items() if k != "_id"}
    out["deep_link"] = _partner_landing_url(request, cfg["partner_code"])
    out["stats"] = {"issued": issued, "used": used}
    return {"configured": True, **out}


@api_router.put("/admin/partner-bar")
async def admin_set_partner_bar(
    body: PartnerBarBody, request: Request, admin: dict = Depends(require_admin)
):
    club = await _find_any_club(body.club_id)
    if not club:
        raise HTTPException(status_code=404, detail="Club introuvable")
    cfg = await _partner_config()
    # Keep the same partner code when re-selecting the same bar
    if cfg and cfg.get("club_id") == body.club_id and cfg.get("partner_code"):
        partner_code = cfg["partner_code"]
    else:
        partner_code = _gen_partner_code()
    doc = {
        "club_id": body.club_id,
        "club_name": club.get("name"),
        "club_photo": (club.get("photos") or [None])[0],
        "partner_code": partner_code,
        "active": body.active,
        "discount_pct": 10,
        "expires_days": max(1, min(body.expires_days, 365)),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.partner_bar.update_one({"_id": PARTNER_CFG_ID}, {"$set": doc}, upsert=True)
    await db.admin_actions.insert_one({
        "admin_id": admin["user_id"],
        "action": "set_partner_bar",
        "details": {"club_id": body.club_id, "club_name": club.get("name"), "active": body.active},
        "at": datetime.now(timezone.utc),
    })
    doc["deep_link"] = _partner_landing_url(request, partner_code)
    return {"ok": True, **doc}


@api_router.delete("/admin/partner-bar")
async def admin_disable_partner_bar(admin: dict = Depends(require_admin)):
    await db.partner_bar.update_one({"_id": PARTNER_CFG_ID}, {"$set": {"active": False}})
    await db.admin_actions.insert_one({
        "admin_id": admin["user_id"], "action": "disable_partner_bar",
        "details": {}, "at": datetime.now(timezone.utc),
    })
    return {"ok": True}


@api_router.get("/partner/qr")
async def partner_qr(request: Request, code: str = ""):
    """Public PNG QR code — bar officiel (sans code) ou code -10% d'un bar vérifié."""
    target = None
    cfg = await _partner_config()
    if code:
        code_up = code.strip().upper()
        if cfg and code_up == cfg.get("partner_code", "").upper():
            target = cfg["partner_code"]
        else:
            club = await _find_club_by_partner_code(code_up)
            if club:
                target = club["partner_code"]
    elif cfg:
        target = cfg.get("partner_code")
    if not target:
        raise HTTPException(status_code=404, detail="Code partenaire introuvable")
    import qrcode

    img = qrcode.make(_partner_landing_url(request, target))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


@api_router.get("/partner/r", response_class=HTMLResponse)
async def partner_landing(code: str = ""):
    """Landing page opened by the QR / link. Tries to open the app with the
    partner code; otherwise shows the code to enter at signup."""
    cfg = await _partner_config()
    code_up = code.upper()
    valid = bool(cfg and cfg.get("active") and code_up == cfg.get("partner_code", "").upper())
    display_code = cfg.get("partner_code") if valid else ""
    club_name = cfg.get("club_name") if valid else ""
    if not valid:
        bar = await _find_club_by_partner_code(code_up)
        if bar:
            valid = True
            club_name = bar.get("name")
            display_code = bar.get("partner_code")
    app_link = f"nightfinder://partner?code={code}"
    body = f"""<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Night Finder — Offre partenaire</title>
<style>body{{background:#050505;color:#fff;font-family:-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:90vh;text-align:center;padding:24px}}
.card{{background:#141414;border:1px solid rgba(255,255,255,.08);border-radius:24px;padding:32px;max-width:400px}}
.pct{{font-size:44px;font-weight:800;color:#8B5CF6}}.code{{font-size:26px;letter-spacing:4px;font-weight:700;background:rgba(139,92,246,.14);border:1px dashed #8B5CF6;border-radius:14px;padding:12px 20px;margin:18px 0;display:inline-block}}
a.btn{{display:inline-block;background:#8B5CF6;color:#fff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:999px;margin-top:10px}}
p{{color:#A1A1AA;line-height:1.5}}</style></head><body><div class="card">"""
    if valid:
        body += f"""<div class="pct">-10%</div>
<h2>🎉 {club_name} vous offre -10%</h2>
<p>Ouvre Night Finder pour débloquer ton coupon automatiquement, ou entre ce code lors de ton inscription :</p>
<div class="code">{display_code}</div><br>
<a class="btn" href="{app_link}">Ouvrir Night Finder</a>
<p style="font-size:13px;margin-top:18px">Pas encore l'app ? Télécharge Night Finder sur l'App Store puis entre le code à l'inscription.</p>"""
    else:
        body += """<h2>Offre indisponible</h2><p>Ce lien partenaire n'est plus actif.</p>"""
    body += "</div></body></html>"
    return HTMLResponse(content=body)


@api_router.get("/partner/info")
async def partner_info(code: str = ""):
    """Public validation of a partner code (used by the signup screen).

    Supporte le bar partenaire officiel (config singleton) ET les codes
    -10% individuels des bars vérifiés (stockés sur le club)."""
    code_up = code.strip().upper()
    cfg = await _partner_config()
    if cfg and cfg.get("active") and code_up == cfg.get("partner_code", "").upper():
        return {
            "valid": True,
            "club_name": cfg.get("club_name"),
            "club_photo": cfg.get("club_photo"),
            "discount_pct": cfg.get("discount_pct", 10),
        }
    club = await _find_club_by_partner_code(code_up)
    if club:
        return {
            "valid": True,
            "club_name": club.get("name"),
            "club_photo": (club.get("photos") or [None])[0],
            "discount_pct": 10,
        }
    return {"valid": False}


class PartnerClaimBody(BaseModel):
    code: str


@api_router.post("/partner/claim")
async def partner_claim(body: PartnerClaimBody, user: dict = Depends(get_current_user)):
    """Create the user's unique -10% coupon (one per user, one use).

    Fonctionne avec le bar partenaire officiel ET les codes -10% des bars vérifiés."""
    code_up = body.code.strip().upper()
    cfg = await _partner_config()
    target = None  # {club_id, club_name, club_photo, expires_days}
    if cfg and cfg.get("active") and code_up == cfg.get("partner_code", "").upper():
        target = {
            "club_id": cfg["club_id"],
            "club_name": cfg.get("club_name"),
            "club_photo": cfg.get("club_photo"),
            "expires_days": cfg.get("expires_days", 30),
        }
    else:
        bar = await _find_club_by_partner_code(code_up)
        if bar:
            target = {
                "club_id": bar["club_id"],
                "club_name": bar.get("name"),
                "club_photo": (bar.get("photos") or [None])[0],
                "expires_days": 30,
            }
    if not target:
        raise HTTPException(status_code=400, detail="Code partenaire invalide")
    existing = await db.partner_coupons.find_one(
        {"user_id": user["user_id"], "club_id": target["club_id"]}, {"_id": 0}
    )
    if existing:
        return {"coupon": existing, "new": False}
    now = datetime.now(timezone.utc)
    coupon = {
        "coupon_id": f"cpn_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "club_id": target["club_id"],
        "club_name": target["club_name"],
        "club_photo": target["club_photo"],
        "code": _gen_user_coupon_code(),
        "discount_pct": 10,
        "status": "available",
        "created_at": now,
        "expires_at": now + timedelta(days=target["expires_days"]),
        "used_at": None,
    }
    await db.partner_coupons.insert_one({**coupon})
    return {"coupon": coupon, "new": True}


@api_router.get("/me/coupons")
async def my_coupons(user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    # Lazily expire outdated coupons
    await db.partner_coupons.update_many(
        {"user_id": user["user_id"], "status": "available", "expires_at": {"$lt": now}},
        {"$set": {"status": "expired"}},
    )
    items = await db.partner_coupons.find(
        {"user_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return {"coupons": items}


class RedeemBody(BaseModel):
    code: str


@api_router.post("/admin/coupons/redeem")
async def admin_redeem_coupon(body: RedeemBody, admin: dict = Depends(require_admin)):
    """Mark a user coupon as used (shown by the customer at the bar)."""
    coupon = await db.partner_coupons.find_one({"code": body.code.strip().upper()})
    if not coupon:
        raise HTTPException(status_code=404, detail="Coupon introuvable")
    if coupon["status"] == "used":
        raise HTTPException(status_code=409, detail="Coupon déjà utilisé")
    now = datetime.now(timezone.utc)
    exp = coupon.get("expires_at")
    if exp and (exp.replace(tzinfo=timezone.utc) if exp.tzinfo is None else exp) < now:
        await db.partner_coupons.update_one({"coupon_id": coupon["coupon_id"]}, {"$set": {"status": "expired"}})
        raise HTTPException(status_code=410, detail="Coupon expiré")
    await db.partner_coupons.update_one(
        {"coupon_id": coupon["coupon_id"]},
        {"$set": {"status": "used", "used_at": now}},
    )
    await db.admin_actions.insert_one({
        "admin_id": admin["user_id"], "action": "redeem_coupon",
        "details": {"coupon_id": coupon["coupon_id"], "user_id": coupon["user_id"]},
        "at": now,
    })
    return {"ok": True, "coupon_id": coupon["coupon_id"]}


# ============================================================
# REVENDICATION DE BAR — Bar Vérifié (Phase 2)
# ============================================================

CLAIM_ROLES = {"proprietaire", "gerant", "manager"}


class BarClaimBody(BaseModel):
    club_id: str
    owner_name: str
    email: str
    phone: str
    role: str  # "proprietaire" | "gerant" | "manager"
    id_document: str  # data URI base64 (pièce d'identité)
    kbis_document: str  # data URI base64 (extrait Kbis)


def _claim_public(claim: dict) -> dict:
    """Claim sans les documents base64 (trop lourds pour les listes)."""
    return {k: v for k, v in claim.items() if k not in ("_id", "id_document", "kbis_document")}


@api_router.post("/bars/claim", status_code=201)
async def submit_bar_claim(body: BarClaimBody, request: Request, user: dict = Depends(get_current_user)):
    role = body.role.strip().lower()
    if role not in CLAIM_ROLES:
        raise HTTPException(status_code=400, detail="Rôle invalide (propriétaire, gérant ou manager)")
    if not body.owner_name.strip() or not body.email.strip() or not body.phone.strip():
        raise HTTPException(status_code=400, detail="Tous les champs sont obligatoires")
    if not body.id_document or not body.kbis_document:
        raise HTTPException(status_code=400, detail="Pièce d'identité et extrait Kbis obligatoires")
    club = await db.places.find_one(
        {"club_id": body.club_id}, {"_id": 0, "name": 1, "photos": 1, "address": 1, "verified": 1}
    )
    if not club:
        club = await db.clubs.find_one(
            {"club_id": body.club_id}, {"_id": 0, "name": 1, "photos": 1, "address": 1, "verified": 1}
        )
    if not club:
        raise HTTPException(status_code=404, detail="Établissement introuvable")
    if club.get("verified"):
        raise HTTPException(status_code=409, detail="Cet établissement est déjà vérifié")
    existing = await db.bar_claims.find_one(
        {"user_id": user["user_id"], "club_id": body.club_id, "status": "pending"}
    )
    if existing:
        raise HTTPException(status_code=409, detail="Tu as déjà une demande en attente pour cet établissement")
    now = datetime.now(timezone.utc)
    claim = {
        "claim_id": f"clm_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "user_email": user["email"],
        "club_id": body.club_id,
        "club_name": club.get("name"),
        "club_photo": (club.get("photos") or [None])[0],
        "club_address": club.get("address"),
        "owner_name": body.owner_name.strip(),
        "email": body.email.strip(),
        "phone": body.phone.strip(),
        "role": role,
        "id_document": body.id_document,
        "kbis_document": body.kbis_document,
        "status": "pending",  # pending | approved | rejected
        "rejection_reason": None,
        "created_at": now,
        "reviewed_at": None,
        "reviewed_by": None,
        "origin_base": _origin_base(request),
        "ai_verdict": None,  # rempli par le robot de vérification
    }
    await db.bar_claims.insert_one({**claim})
    # Email 1 — confirmation de réception (documents + délai)
    _asyncio.create_task(email_service.send_claim_received(
        claim["email"], claim["owner_name"], claim["club_name"] or "ton établissement"
    ))
    # 🤖 Vérification automatique en arrière-plan
    _asyncio.create_task(_run_ai_verification(claim["claim_id"]))
    return {"ok": True, "claim": _claim_public(claim)}


async def _approve_claim_internal(claim: dict, reviewer_id: str) -> dict:
    """Approuve une claim : badge Vérifié, propriétaire, code -10% individuel,
    auto-rejet des autres demandes, notification + email avec QR code.
    Utilisé par le robot IA ET par l'admin."""
    now = datetime.now(timezone.utc)
    await db.bar_claims.update_one(
        {"claim_id": claim["claim_id"]},
        {"$set": {"status": "approved", "reviewed_at": now, "reviewed_by": reviewer_id}},
    )
    # Code -10% individuel du bar (conservé s'il en avait déjà un)
    existing_full = await db.places.find_one({"club_id": claim["club_id"]}, {"partner_code": 1}) \
        or await db.clubs.find_one({"club_id": claim["club_id"]}, {"partner_code": 1}) or {}
    partner_code = existing_full.get("partner_code") or await _gen_unique_bar_code()
    club_update = {"$set": {
        "verified": True, "owner_user_id": claim["user_id"], "verified_at": now,
        "partner_code": partner_code,
    }}
    await db.places.update_one({"club_id": claim["club_id"]}, club_update)
    await db.clubs.update_one({"club_id": claim["club_id"]}, club_update)
    await db.users.update_one(
        {"user_id": claim["user_id"]},
        {"$set": {"is_bar_owner": True, "owned_club_id": claim["club_id"]}},
    )
    await db.bar_claims.update_many(
        {"club_id": claim["club_id"], "status": "pending", "claim_id": {"$ne": claim["claim_id"]}},
        {"$set": {
            "status": "rejected",
            "rejection_reason": "Un autre propriétaire a été validé pour cet établissement",
            "reviewed_at": now,
            "reviewed_by": reviewer_id,
        }},
    )
    await db.notifications.insert_one({
        "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
        "user_id": claim["user_id"],
        "title": "Établissement vérifié ✅",
        "body": f"Ta demande pour {claim.get('club_name')} a été approuvée. "
                f"Ton code -10% invités : {partner_code}",
        "type": "bar_claim_approved",
        "data": {"club_id": claim["club_id"], "claim_id": claim["claim_id"], "partner_code": partner_code},
        "created_at": now,
    })
    await db.admin_actions.insert_one({
        "admin_id": reviewer_id, "action": "approve_bar_claim",
        "details": {"claim_id": claim["claim_id"], "club_id": claim["club_id"],
                    "user_id": claim["user_id"], "partner_code": partner_code},
        "at": now,
    })
    # Email 2 — félicitations + code -10% + QR code
    base = claim.get("origin_base") or os.environ.get("APP_PUBLIC_URL", "https://nightfinder.app")
    qr_url = f"{base}/api/partner/qr?code={partner_code}"
    landing_url = f"{base}/api/partner/r?code={partner_code}"
    _asyncio.create_task(email_service.send_claim_approved(
        claim["email"], claim["owner_name"], claim.get("club_name") or "Ton établissement",
        partner_code, qr_url, landing_url,
    ))
    return {"partner_code": partner_code}


async def _run_ai_verification(claim_id: str) -> None:
    """🤖 Robot de validation : analyse les documents et statue.

    - approve=True  → approbation automatique (reviewed_by='ai_bot')
    - approve=False ET confiance ≥ 0.7 → refus automatique motivé
    - sinon → reste en attente d'examen manuel (24h max, admin console)"""
    try:
        claim = await db.bar_claims.find_one({"claim_id": claim_id})
        if not claim or claim["status"] != "pending":
            return
        verdict = await claim_verification.verify_claim_documents(
            owner_name=claim["owner_name"],
            club_name=claim.get("club_name") or "",
            role=claim.get("role") or "",
            id_document=claim.get("id_document") or "",
            kbis_document=claim.get("kbis_document") or "",
        )
        await db.bar_claims.update_one(
            {"claim_id": claim_id},
            {"$set": {
                "ai_verdict": {k: verdict.get(k) for k in ("approve", "confidence", "notes", "checks", "fail_open")},
                "ai_checked_at": datetime.now(timezone.utc),
            }},
        )
        claim = await db.bar_claims.find_one({"claim_id": claim_id})
        if not claim or claim["status"] != "pending":
            return
        if verdict.get("approve") is True:
            await _approve_claim_internal(claim, reviewer_id="ai_bot")
            logging.info("Claim %s auto-approuvée par le robot IA", claim_id)
        elif verdict.get("approve") is False and float(verdict.get("confidence") or 0) >= 0.7:
            reason = verdict.get("notes") or "Documents non conformes (vérification automatique)"
            now = datetime.now(timezone.utc)
            await db.bar_claims.update_one(
                {"claim_id": claim_id},
                {"$set": {"status": "rejected", "rejection_reason": reason,
                          "reviewed_at": now, "reviewed_by": "ai_bot"}},
            )
            await db.notifications.insert_one({
                "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
                "user_id": claim["user_id"],
                "title": "Demande refusée",
                "body": f"Ta demande pour {claim.get('club_name')} a été refusée : {reason}",
                "type": "bar_claim_rejected",
                "data": {"club_id": claim["club_id"], "claim_id": claim_id},
                "created_at": now,
            })
            _asyncio.create_task(email_service.send_claim_rejected(
                claim["email"], claim["owner_name"], claim.get("club_name") or "ton établissement", reason,
            ))
            logging.info("Claim %s auto-refusée par le robot IA: %s", claim_id, reason)
        else:
            logging.info("Claim %s → examen manuel (verdict incertain)", claim_id)
    except Exception as exc:  # noqa: BLE001
        logging.error("Robot IA claim %s: %s", claim_id, exc)


@api_router.get("/me/bar-claims")
async def my_bar_claims(user: dict = Depends(get_current_user)):
    items = await db.bar_claims.find(
        {"user_id": user["user_id"]},
        {"_id": 0, "id_document": 0, "kbis_document": 0},
    ).sort("created_at", -1).to_list(20)
    return {"claims": items}


@api_router.get("/admin/bar-claims")
async def admin_list_bar_claims(status: Optional[str] = None, _admin: dict = Depends(require_admin)):
    query: dict = {}
    if status in ("pending", "approved", "rejected"):
        query["status"] = status
    items = await db.bar_claims.find(
        query, {"_id": 0, "id_document": 0, "kbis_document": 0}
    ).sort("created_at", -1).to_list(100)
    pending = await db.bar_claims.count_documents({"status": "pending"})
    return {"claims": items, "pending_count": pending}


@api_router.get("/admin/bar-claims/{claim_id}")
async def admin_bar_claim_detail(claim_id: str, _admin: dict = Depends(require_admin)):
    claim = await db.bar_claims.find_one({"claim_id": claim_id}, {"_id": 0})
    if not claim:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    return claim


@api_router.post("/admin/bar-claims/{claim_id}/approve")
async def admin_approve_bar_claim(claim_id: str, admin: dict = Depends(require_admin)):
    claim = await db.bar_claims.find_one({"claim_id": claim_id})
    if not claim:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    if claim["status"] != "pending":
        raise HTTPException(status_code=409, detail="Demande déjà traitée")
    result = await _approve_claim_internal(claim, reviewer_id=admin["user_id"])
    return {"ok": True, **result}


class RejectClaimBody(BaseModel):
    reason: str = ""


@api_router.post("/admin/bar-claims/{claim_id}/reject")
async def admin_reject_bar_claim(
    claim_id: str, body: RejectClaimBody, admin: dict = Depends(require_admin)
):
    claim = await db.bar_claims.find_one({"claim_id": claim_id})
    if not claim:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    if claim["status"] != "pending":
        raise HTTPException(status_code=409, detail="Demande déjà traitée")
    now = datetime.now(timezone.utc)
    reason = body.reason.strip() or "Documents insuffisants ou invalides"
    await db.bar_claims.update_one(
        {"claim_id": claim_id},
        {"$set": {"status": "rejected", "rejection_reason": reason,
                  "reviewed_at": now, "reviewed_by": admin["user_id"]}},
    )
    await db.notifications.insert_one({
        "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
        "user_id": claim["user_id"],
        "title": "Demande refusée",
        "body": f"Ta demande pour {claim.get('club_name')} a été refusée : {reason}",
        "type": "bar_claim_rejected",
        "data": {"club_id": claim["club_id"], "claim_id": claim_id},
        "created_at": now,
    })
    _asyncio.create_task(email_service.send_claim_rejected(
        claim["email"], claim["owner_name"], claim.get("club_name") or "ton établissement", reason,
    ))
    await db.admin_actions.insert_one({
        "admin_id": admin["user_id"], "action": "reject_bar_claim",
        "details": {"claim_id": claim_id, "reason": reason},
        "at": now,
    })
    return {"ok": True}


# -------------- Propriétaire — code -10% invités + coupons -------------- #


@api_router.get("/owner/partner")
async def owner_partner_info(request: Request, user: dict = Depends(get_current_user)):
    """Code -10% du bar du propriétaire + QR + stats coupons."""
    club = await _get_owned_club(user)
    if not club.get("verified"):
        raise HTTPException(status_code=403, detail="Établissement non vérifié")
    partner_code = club.get("partner_code")
    if not partner_code:
        # Bars vérifiés avant l'introduction des codes individuels
        partner_code = await _gen_unique_bar_code()
        await _update_owned_club(club["club_id"], {"$set": {"partner_code": partner_code}})
    base = _origin_base(request)
    issued = await db.partner_coupons.count_documents({"club_id": club["club_id"]})
    used = await db.partner_coupons.count_documents({"club_id": club["club_id"], "status": "used"})
    return {
        "partner_code": partner_code,
        "qr_url": f"{base}/api/partner/qr?code={partner_code}",
        "landing_url": f"{base}/api/partner/r?code={partner_code}",
        "discount_pct": 10,
        "stats": {"issued": issued, "used": used},
    }


class OwnerRedeemBody(BaseModel):
    code: str


@api_router.post("/owner/coupons/redeem")
async def owner_redeem_coupon(body: OwnerRedeemBody, user: dict = Depends(get_current_user)):
    """Le propriétaire valide un coupon -10% présenté par un invité (son bar uniquement)."""
    club = await _get_owned_club(user)
    coupon = await db.partner_coupons.find_one({"code": body.code.strip().upper()})
    if not coupon or coupon.get("club_id") != club["club_id"]:
        raise HTTPException(status_code=404, detail="Coupon introuvable pour ton établissement")
    if coupon["status"] == "used":
        raise HTTPException(status_code=409, detail="Coupon déjà utilisé")
    now = datetime.now(timezone.utc)
    exp = coupon.get("expires_at")
    if exp and (exp.replace(tzinfo=timezone.utc) if exp.tzinfo is None else exp) < now:
        await db.partner_coupons.update_one({"coupon_id": coupon["coupon_id"]}, {"$set": {"status": "expired"}})
        raise HTTPException(status_code=410, detail="Coupon expiré")
    await db.partner_coupons.update_one(
        {"coupon_id": coupon["coupon_id"]},
        {"$set": {"status": "used", "used_at": now, "redeemed_by": user["user_id"]}},
    )
    return {"ok": True, "coupon_id": coupon["coupon_id"], "discount_pct": coupon.get("discount_pct", 10)}


# ============================================================
# ENCAISSEMENT VERRES -10% — STRIPE CONNECT (marketplace)
# Le patron scanne le QR du coupon client → saisit le montant →
# le client paie (CB/Apple Pay via Stripe Checkout) → l'argent va
# sur le compte Stripe du bar, Night Finder garde une commission.
# ============================================================
import stripe as _stripe

STRIPE_SECRET_KEY = (
    os.environ.get("STRIPE_SECRET_KEY", "").strip().strip('"')
    or os.environ.get("STRIPE_API_KEY", "").strip().strip('"')
)
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip().strip('"')
# Commission plateforme (Night Finder) sur chaque verre encaissé — 10% par défaut
PLATFORM_FEE_RATE = float(os.environ.get("PLATFORM_FEE_RATE", "0.10"))
_stripe.api_key = STRIPE_SECRET_KEY


def _stripe_connect_ready() -> bool:
    """Vraie clé Stripe requise — la clé de test Emergent ne supporte pas Connect."""
    return STRIPE_SECRET_KEY.startswith("sk_") and STRIPE_SECRET_KEY != "sk_test_emergent"


def _require_stripe():
    if not _stripe_connect_ready():
        raise HTTPException(
            status_code=503,
            detail=(
                "Paiements non configurés. Ajoute ta clé Stripe (STRIPE_SECRET_KEY) "
                "avec Connect activé — dashboard.stripe.com → Développeurs → Clés API."
            ),
        )


def _public_base(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto", "https")
    host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    return f"{proto}://{host}"


@api_router.post("/owner/payments/onboarding")
async def owner_payments_onboarding(request: Request, user: dict = Depends(get_current_user)):
    """Crée (ou récupère) le compte Stripe Express du bar + lien d'onboarding KYC/IBAN."""
    _require_stripe()
    club = await _get_owned_club(user)
    account_id = club.get("stripe_account_id")
    try:
        if not account_id:
            account = await asyncio.to_thread(
                _stripe.Account.create,
                type="express",
                country="FR",
                email=user.get("email"),
                capabilities={
                    "card_payments": {"requested": True},
                    "transfers": {"requested": True},
                },
                business_profile={"product_description": f"Bar/club — {club.get('name', '')}"},
            )
            account_id = account.id
            await _update_owned_club(club["club_id"], {"$set": {"stripe_account_id": account_id}})
        base = _public_base(request)
        link = await asyncio.to_thread(
            _stripe.AccountLink.create,
            account=account_id,
            type="account_onboarding",
            refresh_url=f"{base}/api/payments/onboarding-refresh",
            return_url=f"{base}/api/payments/onboarding-done",
        )
    except _stripe.error.StripeError as exc:  # type: ignore[attr-defined]
        logging.warning("Stripe onboarding error: %s", exc)
        raise HTTPException(status_code=502, detail=f"Erreur Stripe : {getattr(exc, 'user_message', None) or str(exc)}")
    return {"url": link.url, "account_id": account_id}


@api_router.get("/owner/payments/status")
async def owner_payments_status(user: dict = Depends(get_current_user)):
    club = await _get_owned_club(user)
    account_id = club.get("stripe_account_id")
    if not _stripe_connect_ready():
        return {"configured": False, "onboarded": False, "charges_enabled": False}
    if not account_id:
        return {"configured": True, "onboarded": False, "charges_enabled": False}
    try:
        account = await asyncio.to_thread(_stripe.Account.retrieve, account_id)
    except _stripe.error.StripeError:  # type: ignore[attr-defined]
        return {"configured": True, "onboarded": False, "charges_enabled": False}
    return {
        "configured": True,
        "onboarded": bool(account.get("details_submitted")),
        "charges_enabled": bool(account.get("charges_enabled")),
        "payouts_enabled": bool(account.get("payouts_enabled")),
        "currently_due": (account.get("requirements") or {}).get("currently_due", []),
    }


class ChargeDrinkBody(BaseModel):
    code: str  # code du coupon -10% du client (scanné ou saisi)
    amount_cents: int  # prix NORMAL du verre en centimes (avant remise)


@api_router.post("/owner/drinks/charge")
async def owner_charge_drink(body: ChargeDrinkBody, request: Request, user: dict = Depends(get_current_user)):
    """Crée un paiement Stripe Checkout pour UN verre avec -10%.
    Retourne l'URL de paiement que le client scanne (QR) sur le téléphone du patron."""
    _require_stripe()
    club = await _get_owned_club(user)
    account_id = club.get("stripe_account_id")
    if not account_id:
        raise HTTPException(status_code=409, detail="Crée d'abord ton compte de paiement Stripe.")

    # Montant : 1€ à 500€, défini côté patron mais borné serveur
    if not (100 <= body.amount_cents <= 50_000):
        raise HTTPException(status_code=400, detail="Montant invalide (entre 1€ et 500€).")

    # Coupon : doit appartenir à CE bar, être disponible et non expiré
    coupon = await db.partner_coupons.find_one({"code": body.code.strip().upper()})
    if not coupon or coupon.get("club_id") != club["club_id"]:
        raise HTTPException(status_code=404, detail="Coupon introuvable pour ton établissement.")
    if coupon["status"] == "used":
        raise HTTPException(status_code=409, detail="Coupon déjà utilisé.")
    now = datetime.now(timezone.utc)
    exp = coupon.get("expires_at")
    if exp and (exp.replace(tzinfo=timezone.utc) if exp.tzinfo is None else exp) < now:
        raise HTTPException(status_code=410, detail="Coupon expiré.")

    account = await asyncio.to_thread(_stripe.Account.retrieve, account_id)
    if not account.get("charges_enabled"):
        raise HTTPException(status_code=409, detail="Ton compte Stripe n'est pas encore validé (KYC en cours).")

    discount_pct = int(coupon.get("discount_pct", 10))
    discounted = round(body.amount_cents * (100 - discount_pct) / 100)
    fee = round(discounted * PLATFORM_FEE_RATE)

    order_id = f"drk_{uuid.uuid4().hex[:12]}"
    base = _public_base(request)
    try:
        session = await asyncio.to_thread(
            _stripe.checkout.Session.create,
            mode="payment",
            line_items=[{
                "price_data": {
                    "currency": "eur",
                    "product_data": {
                        "name": f"🍸 Verre — {club.get('name', 'Bar')} (-{discount_pct}%)",
                    },
                    "unit_amount": discounted,
                },
                "quantity": 1,
            }],
            payment_intent_data={
                "application_fee_amount": fee,
                "transfer_data": {"destination": account_id},
            },
            metadata={"order_id": order_id, "club_id": club["club_id"], "coupon_id": coupon["coupon_id"]},
            success_url=f"{base}/api/payments/success?order_id={order_id}",
            cancel_url=f"{base}/api/payments/cancelled",
        )
    except _stripe.error.StripeError as exc:  # type: ignore[attr-defined]
        logging.warning("Stripe checkout error: %s", exc)
        raise HTTPException(status_code=502, detail=f"Erreur Stripe : {getattr(exc, 'user_message', None) or str(exc)}")

    await db.drink_orders.insert_one({
        "order_id": order_id,
        "club_id": club["club_id"],
        "owner_id": user["user_id"],
        "coupon_id": coupon["coupon_id"],
        "coupon_code": coupon["code"],
        "customer_user_id": coupon.get("user_id"),
        "amount_original": body.amount_cents,
        "amount_discounted": discounted,
        "platform_fee": fee,
        "discount_pct": discount_pct,
        "currency": "eur",
        "status": "pending",
        "checkout_session_id": session.id,
        "created_at": now,
    })
    return {
        "ok": True,
        "order_id": order_id,
        "checkout_url": session.url,
        "amount_original": body.amount_cents,
        "amount_discounted": discounted,
        "platform_fee": fee,
    }


async def _finalize_drink_order(order: dict) -> None:
    """Marque la commande payée + consomme le coupon (1 seul verre) + stats."""
    now = datetime.now(timezone.utc)
    res = await db.drink_orders.update_one(
        {"order_id": order["order_id"], "status": "pending"},
        {"$set": {"status": "paid", "paid_at": now}},
    )
    if res.modified_count == 0:
        return  # déjà finalisée (webhook + polling peuvent arriver en double)
    await db.partner_coupons.update_one(
        {"coupon_id": order["coupon_id"]},
        {"$set": {"status": "used", "used_at": now, "redeemed_by": order["owner_id"], "order_id": order["order_id"]}},
    )
    await db.club_stats.update_one(
        {"club_id": order["club_id"]},
        {"$inc": {"drinks_paid": 1, "drinks_revenue_cents": order["amount_discounted"] - order["platform_fee"]}},
        upsert=True,
    )


@api_router.get("/owner/drinks/orders/{order_id}")
async def owner_drink_order(order_id: str, user: dict = Depends(get_current_user)):
    """Statut d'un encaissement (le patron sonde cet endpoint pendant que le
    client paie). Vérification autoritaire tirée de Stripe si encore pending."""
    club = await _get_owned_club(user)
    order = await db.drink_orders.find_one({"order_id": order_id, "club_id": club["club_id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    if order["status"] == "pending" and _stripe_connect_ready():
        try:
            session = await asyncio.to_thread(
                _stripe.checkout.Session.retrieve, order["checkout_session_id"]
            )
            if session.get("payment_status") == "paid":
                await _finalize_drink_order(order)
                order["status"] = "paid"
            elif session.get("status") == "expired":
                await db.drink_orders.update_one(
                    {"order_id": order_id, "status": "pending"}, {"$set": {"status": "expired"}}
                )
                order["status"] = "expired"
        except _stripe.error.StripeError:  # type: ignore[attr-defined]
            pass
    return order


@api_router.get("/owner/drinks/summary")
async def owner_drinks_summary(user: dict = Depends(get_current_user)):
    club = await _get_owned_club(user)
    stats = await db.club_stats.find_one({"club_id": club["club_id"]}, {"_id": 0}) or {}
    recent = await db.drink_orders.find(
        {"club_id": club["club_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(20)
    return {
        "drinks_paid": stats.get("drinks_paid", 0),
        "revenue_cents": stats.get("drinks_revenue_cents", 0),
        "orders": recent,
    }


@api_router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    if STRIPE_WEBHOOK_SECRET:
        try:
            event = _stripe.Webhook.construct_event(payload, signature, STRIPE_WEBHOOK_SECRET)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid webhook signature")
        raw_obj = event["data"]["object"]
        if isinstance(raw_obj, dict):
            data = raw_obj
        else:
            # StripeObject (non-dict selon la version du SDK) → JSON natif
            data = json.loads(str(raw_obj))
        etype = event["type"]
    else:
        # Pas de secret webhook configuré : on n'applique JAMAIS le payload
        # directement — on re-vérifie auprès de Stripe (source autoritaire).
        try:
            body = json.loads(payload)
            etype = body.get("type", "")
            data = (body.get("data") or {}).get("object") or {}
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid payload")
    if etype == "checkout.session.completed":
        order_id = (data.get("metadata") or {}).get("order_id")
        if order_id:
            order = await db.drink_orders.find_one({"order_id": order_id}, {"_id": 0})
            if order and order["status"] == "pending":
                if STRIPE_WEBHOOK_SECRET:
                    if data.get("payment_status") == "paid":
                        await _finalize_drink_order(order)
                elif _stripe_connect_ready():
                    session = await asyncio.to_thread(
                        _stripe.checkout.Session.retrieve, order["checkout_session_id"]
                    )
                    if session.get("payment_status") == "paid":
                        await _finalize_drink_order(order)
    return {"received": True}


_PAYMENT_PAGE_CSS = """
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#09090B;color:#F4F4F5;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px}
.card{max-width:380px}.emoji{font-size:64px}.h{font-size:24px;font-weight:800;margin:16px 0 8px}.p{color:#A1A1AA;font-size:15px;line-height:22px}
"""


@app.get("/api/payments/success", response_class=HTMLResponse)
async def payment_success_page(order_id: str = ""):
    return f"""<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paiement confirmé</title><style>{_PAYMENT_PAGE_CSS}</style></head>
<body><div class="card"><div class="emoji">🎉</div><div class="h">Paiement confirmé !</div>
<p class="p">Ton verre à -10% est payé. Montre cet écran au bar si besoin.<br><br>Santé ! 🍸</p></div></body></html>"""


@app.get("/api/payments/cancelled", response_class=HTMLResponse)
async def payment_cancelled_page():
    return f"""<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paiement annulé</title><style>{_PAYMENT_PAGE_CSS}</style></head>
<body><div class="card"><div class="emoji">😕</div><div class="h">Paiement annulé</div>
<p class="p">Aucun montant n'a été débité. Tu peux redemander un QR de paiement au bar.</p></div></body></html>"""


@app.get("/api/payments/onboarding-done", response_class=HTMLResponse)
async def onboarding_done_page():
    return f"""<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Compte créé</title><style>{_PAYMENT_PAGE_CSS}</style></head>
<body><div class="card"><div class="emoji">✅</div><div class="h">Compte de paiement configuré</div>
<p class="p">Retourne dans l'app Night Finder → Mon établissement → Encaissements pour vérifier ton statut et commencer à encaisser.</p></div></body></html>"""


@app.get("/api/payments/onboarding-refresh", response_class=HTMLResponse)
async def onboarding_refresh_page():
    return f"""<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lien expiré</title><style>{_PAYMENT_PAGE_CSS}</style></head>
<body><div class="card"><div class="emoji">🔄</div><div class="h">Lien expiré</div>
<p class="p">Retourne dans l'app Night Finder et relance la configuration du compte de paiement.</p></div></body></html>"""



# ============================================================
# MISE EN AVANT PAYANTE — RevenueCat IAP (Phase 3)
# Flux : demande gratuite → validation admin → paiement in-app
# (Apple) → activation immédiate. Aucun remboursement à gérer.
# + TABLEAU DE BORD PROPRIÉTAIRE (Phase 5)
# ============================================================
import asyncio as _asyncio

# SECURITY: amounts are defined server-side only — never accepted from client.
PROMO_PLANS = {
    "7d": {"amount": 19.99, "days": 7, "label": "Mise en avant 7 jours", "product_id": "promobar7d"},
    "30d": {"amount": 49.99, "days": 30, "label": "Mise en avant 30 jours", "product_id": "promobar30d"},
}
# RevenueCat product_id -> plan
PROMO_PRODUCTS = {v["product_id"]: k for k, v in PROMO_PLANS.items()}


async def _get_owned_club(user: dict) -> dict:
    if not user.get("is_bar_owner") or not user.get("owned_club_id"):
        raise HTTPException(status_code=403, detail="Réservé aux propriétaires de bar vérifiés")
    club_id = user["owned_club_id"]
    club = await db.places.find_one({"club_id": club_id}, {"_id": 0})
    if not club:
        club = await db.clubs.find_one({"club_id": club_id}, {"_id": 0})
    if not club:
        raise HTTPException(status_code=404, detail="Établissement introuvable")
    return club


async def _update_owned_club(club_id: str, update: dict):
    await db.places.update_one({"club_id": club_id}, update)
    await db.clubs.update_one({"club_id": club_id}, update)


def _promo_public(p: dict) -> dict:
    return {k: v for k, v in p.items() if k != "_id"}


async def _expire_promotions() -> None:
    """Lazily expire finished promotions and clear club flags."""
    now = datetime.now(timezone.utc)
    expired = await db.promotions.find(
        {"status": "active", "ends_at": {"$lt": now}}, {"_id": 0, "promo_id": 1, "club_id": 1}
    ).to_list(100)
    for p in expired:
        await db.promotions.update_one({"promo_id": p["promo_id"]}, {"$set": {"status": "expired"}})
        still = await db.promotions.count_documents({"club_id": p["club_id"], "status": "active"})
        if still == 0:
            await _update_owned_club(p["club_id"], {"$unset": {"promoted": "", "promoted_until": ""}})


async def _active_promo_club_ids() -> set:
    await _expire_promotions()
    rows = await db.promotions.find({"status": "active"}, {"_id": 0, "club_id": 1}).to_list(100)
    return {r["club_id"] for r in rows}


class PromoRequestBody(BaseModel):
    plan: str  # "7d" | "30d"


@api_router.post("/owner/promotions/request", status_code=201)
async def owner_promo_request(body: PromoRequestBody, user: dict = Depends(get_current_user)):
    """Demande de mise en avant GRATUITE — l'admin valide d'abord,
    le paiement (achat intégré RevenueCat) n'intervient qu'après."""
    plan = PROMO_PLANS.get(body.plan)
    if not plan:
        raise HTTPException(status_code=400, detail="Formule invalide")
    club = await _get_owned_club(user)
    if not club.get("verified"):
        raise HTTPException(status_code=403, detail="Seuls les bars vérifiés peuvent être mis en avant")
    existing = await db.promotions.find_one({
        "club_id": club["club_id"],
        "status": {"$in": ["requested", "approved_awaiting_payment", "active"]},
    })
    if existing:
        raise HTTPException(status_code=409, detail="Une mise en avant est déjà en cours ou en attente")
    now = datetime.now(timezone.utc)
    promo = {
        "promo_id": f"prm_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "club_id": club["club_id"],
        "club_name": club.get("name"),
        "club_photo": (club.get("photos") or [None])[0],
        "plan": body.plan,
        "plan_label": plan["label"],
        "days": plan["days"],
        "amount": plan["amount"],
        "currency": "eur",
        "product_id": plan["product_id"],
        # requested | approved_awaiting_payment | active | rejected | expired
        "status": "requested",
        "rejection_reason": None,
        "created_at": now,
        "starts_at": None,
        "ends_at": None,
        "paid_at": None,
        "reviewed_at": None,
        "reviewed_by": None,
    }
    await db.promotions.insert_one({**promo})
    return {"ok": True, "promo": _promo_public(promo)}


@api_router.get("/owner/promotions")
async def owner_list_promotions(user: dict = Depends(get_current_user)):
    await _expire_promotions()
    items = await db.promotions.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(20)
    return {"promotions": items, "plans": PROMO_PLANS}


async def _activate_promotion(promo: dict, *, source: str) -> bool:
    """Active une promo payée (webhook RevenueCat ou confirmation client)."""
    if promo["status"] != "approved_awaiting_payment":
        return False
    now = datetime.now(timezone.utc)
    ends = now + timedelta(days=promo["days"])
    res = await db.promotions.update_one(
        {"promo_id": promo["promo_id"], "status": "approved_awaiting_payment"},
        {"$set": {"status": "active", "starts_at": now, "ends_at": ends,
                  "paid_at": now, "payment_source": source}},
    )
    if res.modified_count == 0:
        return False
    await _update_owned_club(promo["club_id"], {"$set": {"promoted": True, "promoted_until": ends}})
    await db.notifications.insert_one({
        "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
        "user_id": promo["user_id"],
        "title": "Mise en avant activée ⭐",
        "body": f"Paiement confirmé — {promo.get('club_name')} est à la une pendant {promo['days']} jours !",
        "type": "promotion_active",
        "data": {"club_id": promo["club_id"], "promo_id": promo["promo_id"]},
        "created_at": now,
    })
    logging.info("Promotion %s activée via %s", promo["promo_id"], source)
    return True


async def _handle_promo_purchase_event(app_user_id: str, product_id: str) -> bool:
    """Appelé par le webhook RevenueCat quand un produit promo_bar_* est acheté."""
    plan = PROMO_PRODUCTS.get(product_id)
    if not plan:
        return False
    promo = await db.promotions.find_one({
        "user_id": app_user_id,
        "plan": plan,
        "status": "approved_awaiting_payment",
    })
    if not promo:
        logging.warning("Achat %s reçu pour %s sans promo en attente", product_id, app_user_id)
        return True  # produit promo consommé, ne pas toucher au premium
    await _activate_promotion(promo, source="revenuecat_webhook")
    return True


@api_router.post("/owner/promotions/{promo_id}/confirm-purchase")
async def owner_confirm_promo_purchase(promo_id: str, user: dict = Depends(get_current_user)):
    """Fallback appelé par l'app juste après un achat réussi (le webhook
    RevenueCat activera de toute façon la promo de manière idempotente)."""
    promo = await db.promotions.find_one({"promo_id": promo_id})
    if not promo or promo["user_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    if promo["status"] == "active":
        return {"ok": True, "status": "active"}
    activated = await _activate_promotion(promo, source="client_confirm")
    if not activated:
        raise HTTPException(status_code=409, detail="Demande non validée ou déjà traitée")
    fresh = await db.promotions.find_one({"promo_id": promo_id}, {"_id": 0})
    return {"ok": True, "status": "active", "ends_at": fresh.get("ends_at")}


@api_router.get("/promotions/featured")
async def featured_promotions():
    """Public — active paid promotions for the home 'À la une ⭐' section."""
    ids = await _active_promo_club_ids()
    out = []
    for club_id in ids:
        club = await db.places.find_one({"club_id": club_id}, {"_id": 0})
        if not club:
            club = await db.clubs.find_one({"club_id": club_id}, {"_id": 0})
        if club:
            club.pop("expires_at", None)
            club.pop("updated_at", None)
            club["promoted"] = True
            out.append(club)
    return {"clubs": out}


@api_router.get("/admin/promotions")
async def admin_list_promotions(status: Optional[str] = None, _admin: dict = Depends(require_admin)):
    await _expire_promotions()
    query: dict = {}
    if status:
        query["status"] = status
    items = await db.promotions.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
    pending = await db.promotions.count_documents({"status": "requested"})
    return {"promotions": items, "pending_count": pending}


@api_router.post("/admin/promotions/{promo_id}/approve")
async def admin_approve_promotion(promo_id: str, admin: dict = Depends(require_admin)):
    """Valide la demande — le propriétaire peut alors payer dans l'app
    (achat intégré). L'activation se fait automatiquement après paiement."""
    promo = await db.promotions.find_one({"promo_id": promo_id})
    if not promo:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    if promo["status"] != "requested":
        raise HTTPException(status_code=409, detail="Demande déjà traitée")
    now = datetime.now(timezone.utc)
    await db.promotions.update_one(
        {"promo_id": promo_id},
        {"$set": {"status": "approved_awaiting_payment",
                  "reviewed_at": now, "reviewed_by": admin["user_id"]}},
    )
    await db.notifications.insert_one({
        "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
        "user_id": promo["user_id"],
        "title": "Mise en avant validée ✅",
        "body": f"Ta demande pour {promo.get('club_name')} est validée ! "
                f"Procède au paiement ({promo['amount']:.2f}€) dans l'app pour l'activer.",
        "type": "promotion_approved",
        "data": {"club_id": promo["club_id"], "promo_id": promo_id},
        "created_at": now,
    })
    await db.admin_actions.insert_one({
        "admin_id": admin["user_id"], "action": "approve_promotion",
        "details": {"promo_id": promo_id, "club_id": promo["club_id"]}, "at": now,
    })
    return {"ok": True}


class RejectPromoBody(BaseModel):
    reason: str = ""


@api_router.post("/admin/promotions/{promo_id}/reject")
async def admin_reject_promotion(promo_id: str, body: RejectPromoBody, admin: dict = Depends(require_admin)):
    """Refuse la demande AVANT paiement — aucun remboursement à gérer."""
    promo = await db.promotions.find_one({"promo_id": promo_id})
    if not promo:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    if promo["status"] not in ("requested", "approved_awaiting_payment"):
        raise HTTPException(status_code=409, detail="Demande déjà traitée")
    now = datetime.now(timezone.utc)
    reason = body.reason.strip() or "Demande non conforme"
    await db.promotions.update_one(
        {"promo_id": promo_id},
        {"$set": {"status": "rejected", "rejection_reason": reason,
                  "reviewed_at": now, "reviewed_by": admin["user_id"]}},
    )
    await db.notifications.insert_one({
        "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
        "user_id": promo["user_id"],
        "title": "Mise en avant refusée",
        "body": f"Ta demande pour {promo.get('club_name')} a été refusée : {reason}. Aucun paiement n'a été effectué.",
        "type": "promotion_rejected",
        "data": {"club_id": promo["club_id"], "promo_id": promo_id},
        "created_at": now,
    })
    await db.admin_actions.insert_one({
        "admin_id": admin["user_id"], "action": "reject_promotion",
        "details": {"promo_id": promo_id, "reason": reason}, "at": now,
    })
    return {"ok": True}


# -------------- Phase 5 — Tableau de bord propriétaire -------------- #


@api_router.get("/owner/club")
async def owner_get_club(user: dict = Depends(get_current_user)):
    club = await _get_owned_club(user)
    club.pop("expires_at", None)
    club.pop("updated_at", None)
    return club


class OwnerClubUpdate(BaseModel):
    description: Optional[str] = None
    avg_price: Optional[float] = None
    music_styles: Optional[List[str]] = None
    photos: Optional[List[str]] = None
    hours: Optional[dict] = None


@api_router.patch("/owner/club")
async def owner_update_club(body: OwnerClubUpdate, user: dict = Depends(get_current_user)):
    club = await _get_owned_club(user)
    update = {k: v for k, v in body.dict().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="Aucune modification")
    if "avg_price" in update:
        update["avg_price"] = max(0.0, min(float(update["avg_price"]), 1000.0))
    if "photos" in update:
        update["photos"] = update["photos"][:6]
    await _update_owned_club(club["club_id"], {"$set": update})
    return {"ok": True, "updated": list(update.keys())}


class MenuItem(BaseModel):
    name: str
    price: float = 0.0
    category: str = ""


class MenuBody(BaseModel):
    items: List[MenuItem]


@api_router.put("/owner/club/menu")
async def owner_set_menu(body: MenuBody, user: dict = Depends(get_current_user)):
    club = await _get_owned_club(user)
    items = [i.dict() for i in body.items][:50]
    await _update_owned_club(club["club_id"], {"$set": {"menu": items}})
    return {"ok": True, "count": len(items)}


class OwnerEventBody(BaseModel):
    title: str
    description: str = ""
    dj: str = ""
    date: str  # ISO datetime
    entry_price: float = 0.0
    photo: Optional[str] = None


@api_router.post("/owner/events", status_code=201)
async def owner_create_event(body: OwnerEventBody, user: dict = Depends(get_current_user)):
    club = await _get_owned_club(user)
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="Titre obligatoire")
    event = {
        "event_id": f"evt_{uuid.uuid4().hex[:12]}",
        "club_id": club["club_id"],
        "club_name": club.get("name"),
        "club_photo": (club.get("photos") or [None])[0],
        "title": body.title.strip(),
        "description": body.description.strip(),
        "dj": body.dj.strip(),
        "date": body.date,
        "entry_price": max(0.0, body.entry_price),
        "photo": body.photo,
        "visibility": "public",
        "location_name": club.get("name"),
        "location_address": club.get("address", ""),
        "created_by": user["user_id"],
        "created_by_owner": True,
        "created_at": datetime.now(timezone.utc),
    }
    await db.events.insert_one({**event})
    event.pop("created_at", None)
    return event


@api_router.delete("/owner/events/{event_id}")
async def owner_delete_event(event_id: str, user: dict = Depends(get_current_user)):
    club = await _get_owned_club(user)
    res = await db.events.delete_one({"event_id": event_id, "club_id": club["club_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Événement introuvable")
    return {"ok": True}


@api_router.get("/owner/stats")
async def owner_stats(user: dict = Depends(get_current_user)):
    club = await _get_owned_club(user)
    cid = club["club_id"]
    stats_doc = await db.club_stats.find_one({"club_id": cid}) or {}
    favorites = await db.favorites.count_documents({"club_id": cid})
    checkins = await db.checkins.count_documents({"club_id": cid})
    songs = await db.user_songs.count_documents({"club_id": cid})
    promo = await db.promotions.find_one(
        {"club_id": cid, "status": "active"}, {"_id": 0, "ends_at": 1, "plan_label": 1}
    )
    return {
        "club_id": cid,
        "club_name": club.get("name"),
        "views": int(stats_doc.get("views", 0)),
        "favorites": favorites,
        "checkins": checkins,
        "songs": songs,
        "active_promotion": promo,
    }


# -------------- Phase 4 — Gestion administrateur -------------- #


@api_router.get("/admin/overview")
async def admin_overview(_admin: dict = Depends(require_admin)):
    await _expire_promotions()
    pending_claims = await db.bar_claims.count_documents({"status": "pending"})
    pending_promotions = await db.promotions.count_documents({"status": "requested"})
    active_promotions = await db.promotions.count_documents({"status": "active"})
    verified_places = await db.places.count_documents({"verified": True})
    verified_clubs = await db.clubs.count_documents({"verified": True})
    return {
        "pending_claims": pending_claims,
        "pending_promotions": pending_promotions,
        "active_promotions": active_promotions,
        "verified_bars": verified_places + verified_clubs,
    }


@api_router.post("/admin/verified-bars/{club_id}/revoke")
async def admin_revoke_verified(club_id: str, admin: dict = Depends(require_admin)):
    """Retire le badge Vérifié + le statut propriétaire + stoppe les promos."""
    club = await _find_any_club(club_id)
    if not club:
        raise HTTPException(status_code=404, detail="Établissement introuvable")
    now = datetime.now(timezone.utc)
    owner = await db.users.find_one({"owned_club_id": club_id}, {"_id": 0, "user_id": 1})
    await _update_owned_club(club_id, {"$unset": {"verified": "", "owner_user_id": "", "verified_at": "", "promoted": "", "promoted_until": "", "partner_code": ""}})
    if owner:
        await db.users.update_one(
            {"user_id": owner["user_id"]}, {"$unset": {"is_bar_owner": "", "owned_club_id": ""}}
        )
        await db.notifications.insert_one({
            "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
            "user_id": owner["user_id"],
            "title": "Statut Vérifié retiré",
            "body": f"Le badge Vérifié de {club.get('name')} a été retiré par l'équipe Night Finder.",
            "type": "verified_revoked",
            "data": {"club_id": club_id},
            "created_at": now,
        })
    await db.promotions.update_many(
        {"club_id": club_id, "status": "active"}, {"$set": {"status": "expired"}}
    )
    await db.admin_actions.insert_one({
        "admin_id": admin["user_id"], "action": "revoke_verified",
        "details": {"club_id": club_id}, "at": now,
    })
    return {"ok": True}


_live_stats_cache: dict = {"at": None, "data": None}


@api_router.get("/stats/live")
async def live_stats():
    """Statistiques temps réel affichées sur l'accueil (cache 60s)."""
    now = datetime.now(timezone.utc)
    cached_at = _live_stats_cache["at"]
    if cached_at and (now - cached_at).total_seconds() < 60:
        return _live_stats_cache["data"]

    # "Ce soir" démarre à 17h UTC (~18-19h en France) ; avant cela, on prend
    # la soirée de la veille pour ne jamais afficher des compteurs à zéro.
    tonight = now.replace(hour=17, minute=0, second=0, microsecond=0)
    if tonight > now:
        tonight -= timedelta(days=1)

    active_users = await db.users.count_documents(
        {"last_seen": {"$gte": now - timedelta(hours=3)}}
    )
    moments_tonight = await db.club_moments.count_documents(
        {"created_at": {"$gte": tonight}}
    )
    checkins_tonight = await db.checkins.count_documents(
        {"created_at": {"$gte": tonight}}
    )
    matches_tonight = await db.matches.count_documents(
        {"created_at": {"$gte": tonight}}
    )
    data = {
        "active_users": active_users,
        "moments_tonight": moments_tonight,
        "checkins_tonight": checkins_tonight,
        "matches_tonight": matches_tonight,
        "generated_at": now.isoformat(),
    }
    _live_stats_cache["at"] = now
    _live_stats_cache["data"] = data
    return data


@api_router.get("/health/integrations")
async def health_integrations():
    """Diagnostic (sans secrets) : vérifie que les clés API fonctionnent réellement.
    Utile pour valider l'environnement de production après un déploiement."""
    out: dict = {}
    key = places_service.PLACES_KEY
    out["google_places"] = {
        "configured": bool(key),
        "key_length": len(key),
        # Empreinte non réversible pour comparer les clés dev/prod sans les exposer
        "key_fingerprint": hashlib.sha256(key.encode()).hexdigest()[:8] if key else None,
    }
    if key and http_client is not None:
        try:
            r = await http_client.post(
                f"{places_service.PLACES_BASE}/places:searchText",
                json={"textQuery": "Rex Club Paris", "maxResultCount": 1},
                headers={
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": key,
                    "X-Goog-FieldMask": "places.id",
                },
                timeout=10.0,
            )
            out["google_places"]["live_test"] = "ok" if r.status_code == 200 else f"http_{r.status_code}"
            if r.status_code != 200:
                out["google_places"]["error"] = (r.text or "")[:200]
        except Exception as exc:  # noqa: BLE001
            out["google_places"]["live_test"] = f"exception: {str(exc)[:120]}"
    import resend as _resend
    out["resend"] = {
        "configured": bool(_resend.api_key),
        "from_email": os.environ.get("RESEND_FROM_EMAIL", ""),
    }
    audd = os.environ.get("AUDD_API_TOKEN", "").strip().strip(chr(34)).strip(chr(39))
    out["audd"] = {"configured": bool(audd)}
    out["places_in_db"] = await db.places.count_documents({})
    return out


@api_router.get("/assets/iap/{name}")
async def iap_screenshot(name: str):
    """Captures App Store des achats intégrés (téléchargement pour App Store Connect)."""
    if name not in ("promobar7d.png", "promobar30d.png"):
        raise HTTPException(status_code=404, detail="Introuvable")
    path = os.path.join(os.path.dirname(__file__), "iap_screens", name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Fichier manquant")
    return FileResponse(path, media_type="image/png", filename=name)


APPSTORE_SCREENS_DIR = os.path.join(os.path.dirname(__file__), "appstore_screens")
APPSTORE_MARKETING_DIR = os.path.join(os.path.dirname(__file__), "appstore_marketing")


@api_router.get("/assets/appstore-marketing/all.zip")
async def appstore_marketing_zip():
    """ZIP des previews marketing App Store (1284×2778, titre + mockup)."""
    import zipfile
    zip_path = "/tmp/nightfinder_marketing_screens.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
        for f in sorted(os.listdir(APPSTORE_MARKETING_DIR)):
            if f.endswith(".png"):
                zf.write(os.path.join(APPSTORE_MARKETING_DIR, f), f)
    return FileResponse(zip_path, media_type="application/zip", filename="nightfinder_marketing_screens.zip")


@api_router.get("/assets/appstore-marketing/{name}")
async def appstore_marketing_screenshot(name: str):
    if "/" in name or ".." in name or not name.endswith(".png"):
        raise HTTPException(status_code=404, detail="Introuvable")
    path = os.path.join(APPSTORE_MARKETING_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Fichier manquant")
    return FileResponse(path, media_type="image/png", filename=name)


@api_router.get("/assets/appstore/all.zip")
async def appstore_screenshots_zip():
    """ZIP de toutes les captures App Store (1290×2796, iPhone 6,9\")."""
    import zipfile
    zip_path = "/tmp/nightfinder_appstore_screens.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
        for f in sorted(os.listdir(APPSTORE_SCREENS_DIR)):
            if f.endswith(".png"):
                zf.write(os.path.join(APPSTORE_SCREENS_DIR, f), f)
    return FileResponse(zip_path, media_type="application/zip", filename="nightfinder_appstore_screens.zip")


@api_router.get("/assets/appstore/{name}")
async def appstore_screenshot(name: str):
    """Capture App Store individuelle (téléchargement pour App Store Connect)."""
    if "/" in name or ".." in name or not name.endswith(".png"):
        raise HTTPException(status_code=404, detail="Introuvable")
    path = os.path.join(APPSTORE_SCREENS_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Fichier manquant")
    return FileResponse(path, media_type="image/png", filename=name)


app.include_router(legal_pages.router)

# ================== ADMIN ROUTES (require_admin) ================== #

@api_router.post("/admin/seed-bots")
async def admin_seed_bots(
    count: int = 20,
    _admin: dict = Depends(require_admin),
):
    """Create `count` bot users (visible on map + swipe deck)."""
    return await admin_service.seed_bots(db, count=count)


@api_router.delete("/admin/bots")
async def admin_delete_bots(_admin: dict = Depends(require_admin)):
    """Delete all bots + their associated data."""
    return await admin_service.delete_all_bots(db)


@api_router.get("/admin/bots/stats")
async def admin_bot_stats(_admin: dict = Depends(require_admin)):
    """Return counts of active bots."""
    return await admin_service.get_bot_stats(db)


# ---- Audd.io diagnostic (admin only) ----

@api_router.get("/admin/audd/status")
async def admin_audd_status(_admin: dict = Depends(require_admin)):
    """Return Audd.io configuration status + recent recognitions.

    Response:
      - `configured`: bool          — token env variable present
      - `token_preview`: str        — masked token (first 4 + last 4)
      - `total_songs`: int          — count of user_songs from Audd
      - `recent_songs`: list[dict]  — last 10 successful recognitions
    """
    token = os.environ.get("AUDD_API_TOKEN", "").strip().strip(chr(34)).strip(chr(39))
    configured = bool(token)
    token_preview = ""
    if token:
        if len(token) > 10:
            token_preview = f"{token[:4]}…{token[-4:]}"
        else:
            token_preview = "•" * len(token)
    total = await db.user_songs.count_documents({"source": "audd"})
    recent = await db.user_songs.find(
        {"source": "audd"},
        {"_id": 0, "song_id": 1, "user_id": 1, "club_name": 1,
         "title": 1, "artist": 1, "detected_at": 1},
    ).sort("created_at", -1).to_list(10)
    return {
        "configured": configured,
        "token_preview": token_preview,
        "total_songs": total,
        "recent_songs": recent,
    }


class AdminAuddProbeBody(BaseModel):
    audio_base64: str


@api_router.post("/admin/audd/probe")
async def admin_audd_probe(
    body: AdminAuddProbeBody,
    _admin: dict = Depends(require_admin),
):
    """Forward an audio sample to Audd.io and return the FULL raw response.

    Unlike `/recognize/audio`, this endpoint:
      - does NOT persist the match into `user_songs`;
      - does NOT require a real club check-in;
      - returns the raw Audd payload + HTTP status + elapsed time
        so an admin can validate the integration end-to-end.
    """
    import base64
    import time as _time

    token = os.environ.get("AUDD_API_TOKEN", "").strip().strip(chr(34)).strip(chr(39))
    if not token:
        raise HTTPException(status_code=503, detail="Audd.io not configured")
    if http_client is None:
        raise HTTPException(status_code=503, detail="Service not ready")

    try:
        raw = base64.b64decode(body.audio_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 audio")
    if len(raw) > 5_000_000:
        raise HTTPException(status_code=413, detail="Audio sample too large")
    if len(raw) < 20_000:
        # Refuse to spend a quota credit on obviously empty samples
        return {
            "ok": False,
            "sample_bytes": len(raw),
            "message": "Sample too small (<20KB) — record longer / louder.",
        }

    started = _time.monotonic()
    try:
        files = {"file": ("sample.m4a", raw, "audio/m4a")}
        data = {
            "api_token": token,
            "return": "spotify,apple_music,deezer,musicbrainz",
            "accurate_offsets": "true",
        }
        r = await http_client.post(
            "https://api.audd.io/", data=data, files=files, timeout=25.0
        )
    except Exception as exc:
        return {
            "ok": False,
            "sample_bytes": len(raw),
            "elapsed_ms": int((_time.monotonic() - started) * 1000),
            "message": f"Network error: {exc}",
        }
    elapsed_ms = int((_time.monotonic() - started) * 1000)

    try:
        payload = r.json()
    except Exception:
        payload = {"raw_text": (r.text or "")[:500]}

    # Extract clean summary
    status = payload.get("status")
    result = payload.get("result") if isinstance(payload, dict) else None
    summary = None
    if isinstance(result, dict):
        summary = {
            "title": result.get("title"),
            "artist": result.get("artist"),
            "album": result.get("album"),
            "release_date": result.get("release_date"),
            "spotify_url": (result.get("spotify") or {})
                .get("external_urls", {}).get("spotify"),
            "apple_music_url": (result.get("apple_music") or {}).get("url"),
        }

    return {
        "ok": r.status_code == 200 and status == "success",
        "http_status": r.status_code,
        "audd_status": status,
        "recognised": summary is not None,
        "sample_bytes": len(raw),
        "elapsed_ms": elapsed_ms,
        "summary": summary,
        "error": payload.get("error") if isinstance(payload, dict) else None,
        "raw": payload,
    }


# ---- User moderation ----

class AdminBanBody(BaseModel):
    duration_hours: Optional[int] = None  # None = permanent
    reason: Optional[str] = None


class AdminPremiumBody(BaseModel):
    duration_days: Optional[int] = None  # None = unlimited
    remove: bool = False


@api_router.get("/admin/users")
async def admin_search_users(
    q: str = "",
    limit: int = 50,
    _admin: dict = Depends(require_admin),
):
    return await admin_service.search_users(db, q=q, limit=limit)


@api_router.get("/admin/users/{user_id}")
async def admin_get_user(user_id: str, _admin: dict = Depends(require_admin)):
    u = await db.users.find_one({"user_id": user_id})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return admin_service._public_user_admin(u)


@api_router.post("/admin/users/{user_id}/ban")
async def admin_ban_user(
    user_id: str,
    body: AdminBanBody,
    _admin: dict = Depends(require_admin),
):
    res = await admin_service.ban_user(
        db, user_id, duration_hours=body.duration_hours, reason=body.reason,
    )
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "Ban failed"))
    return res


@api_router.post("/admin/users/{user_id}/unban")
async def admin_unban_user(user_id: str, _admin: dict = Depends(require_admin)):
    res = await admin_service.unban_user(db, user_id)
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "Unban failed"))
    return res


@api_router.post("/admin/users/{user_id}/premium")
async def admin_set_premium(
    user_id: str,
    body: AdminPremiumBody,
    _admin: dict = Depends(require_admin),
):
    res = await admin_service.set_user_premium(
        db, user_id, duration_days=body.duration_days, remove=body.remove,
    )
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "Update failed"))
    return res


# Re-include the router so the new admin endpoints are registered.
# (FastAPI ignores duplicate include calls.)
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
    try:
        await push_service.aclose()
    except Exception:
        pass
