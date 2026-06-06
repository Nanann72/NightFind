"""Night Finder FastAPI backend."""
from __future__ import annotations

import logging
import math
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

import bcrypt
import httpx
import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
import io
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

JWT_SECRET = os.environ.get("JWT_SECRET", "night-finder-dev-secret-change-me")
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

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Night Finder API")
api_router = APIRouter(prefix="/api")


@app.on_event("startup")
async def _startup() -> None:
    global http_client
    http_client = httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0))
    await places_service.ensure_indexes(db)


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
                    return user
    raise HTTPException(status_code=401, detail="Invalid or expired token")


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
    token = make_jwt(user["user_id"])
    return {"token": token, "user": public_user(user)}


@api_router.post("/auth/forgot-password")
async def forgot_password(body: ForgotPassword):
    # MVP: stub. Just acknowledge.
    return {
        "ok": True,
        "message": "If an account exists for this email, reset instructions have been sent.",
    }


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


@api_router.post("/auth/apple")
async def apple_signin(body: AppleSignIn):
    """Sign in with Apple. Decodes identity_token without verifying (MVP).
    For production, validate with Apple's public keys.
    """
    sub: Optional[str] = None
    email: Optional[str] = body.email
    try:
        payload = jwt.decode(body.identity_token, options={"verify_signature": False})
        sub = payload.get("sub")
        if not email:
            email = payload.get("email")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid Apple identity token")

    if not sub:
        raise HTTPException(status_code=400, detail="Missing Apple user id")

    apple_email = (email or f"{sub}@privaterelay.apple").lower()
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
            google_clubs = await places_service.search_places_nearby(
                db, http_client, lat, lng, min(radius_km, 50.0), max_results=20
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
                    if s not in (c.get("name") or "").lower() and s not in (
                        c.get("description") or ""
                    ).lower():
                        continue
                items.append(c)
        except Exception as exc:  # noqa: BLE001
            logging.warning("Google Places fallback to seed: %s", exc)

    # Fall back to seed clubs if Google returned nothing OR source explicitly seed
    if not items or source == "seed":
        cursor = db.clubs.find(query, {"_id": 0})
        items_seed = await cursor.to_list(500)
        # When mixing, prefer to dedupe by name
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

    return items


@api_router.get("/places/photo")
async def proxy_place_photo(name: str = Query(...), max_width: int = 1200):
    """Stream a Google Places photo through our backend so the API key stays
    server-side."""
    if http_client is None:
        raise HTTPException(status_code=503, detail="Service not ready")
    result = await places_service.fetch_place_photo(http_client, name, max_width)
    if not result:
        raise HTTPException(status_code=404, detail="Photo not available")
    content, ctype = result
    return StreamingResponse(io.BytesIO(content), media_type=ctype)


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


@api_router.get("/swipe/quota")
async def swipe_quota(user: dict = Depends(get_current_user)):
    used = await _today_swipes_count(user["user_id"])
    is_prem = bool(user.get("is_premium"))
    return {
        "used_today": used,
        "limit": None if is_prem else FREE_DAILY_SWIPE_LIMIT,
        "is_premium": is_prem,
        "remaining": None if is_prem else max(0, FREE_DAILY_SWIPE_LIMIT - used),
    }


@api_router.get("/swipe/deck")
async def swipe_deck(user: dict = Depends(get_current_user)):
    """Return up to 10 profiles the user has not swiped on yet (and is not
    themself). Hidden users, blocked users and profiles missing the minimum
    data are skipped."""
    # Already swiped target ids
    already = await db.user_swipes.find(
        {"user_id": user["user_id"]}, {"_id": 0, "target_user_id": 1},
    ).to_list(1000)
    exclude = {s["target_user_id"] for s in already}
    exclude.add(user["user_id"])
    # Filter out blocked users (both directions) — Apple 1.2 UGC
    exclude |= await _blocked_user_ids(user["user_id"])
    cursor = db.users.find(
        {
            "user_id": {"$nin": list(exclude)},
            "visibility": {"$ne": "hidden"},
            "photos": {"$exists": True, "$ne": []},
        },
        {"_id": 0},
    ).limit(50)
    deck: list[dict] = []
    async for u in cursor:
        if not _is_profile_complete_for_swipe(u):
            continue
        deck.append(_profile_for_swipe(u))
        if len(deck) >= 10:
            break
    return deck


class UserSwipeBody(BaseModel):
    target_user_id: str


@api_router.post("/swipe/like")
async def swipe_like(body: UserSwipeBody, user: dict = Depends(get_current_user)):
    return await _user_swipe(body.target_user_id, "like", user)


@api_router.post("/swipe/pass")
async def swipe_pass(body: UserSwipeBody, user: dict = Depends(get_current_user)):
    return await _user_swipe(body.target_user_id, "pass", user)


async def _user_swipe(target_user_id: str, action: str, user: dict) -> dict:
    if target_user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="On ne se swipe pas soi-même")
    if action not in ("like", "pass"):
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
    if action == "like":
        # Create or refresh a match request (the target will see it in inbox)
        await db.match_requests.update_one(
            {"from_user_id": user["user_id"], "to_user_id": target_user_id},
            {
                "$setOnInsert": {
                    "request_id": f"mr_{uuid.uuid4().hex[:10]}",
                    "from_user_id": user["user_id"],
                    "to_user_id": target_user_id,
                    "status": "pending",
                    "created_at": datetime.now(timezone.utc),
                },
            },
            upsert=True,
        )
        # In-app notification
        sender_name = user.get("name") or (
            f"@{user.get('username')}" if user.get("username") else "Quelqu'un"
        )
        await db.notifications.insert_one({
            "notif_id": f"ntf_{uuid.uuid4().hex[:10]}",
            "user_id": target_user_id,
            "title": "Quelqu'un veut te matcher 💘",
            "body": f"{sender_name} a aimé ton profil.",
            "type": "match_request",
            "data": {"from_user_id": user["user_id"]},
            "created_at": datetime.now(timezone.utc),
        })
        try:
            await push_service.send_push(
                recipients=[target_user_id],
                title="Quelqu'un veut te matcher 💘",
                message=f"{sender_name} a aimé ton profil.",
                action_url="/match-requests",
                idempotency_key=f"mr_{user['user_id']}_{target_user_id}",
            )
        except Exception as e:
            logger.warning("push (match_request) failed: %s", e)
    return {"ok": True}


# ===================== Profile / Swipe fields ===================== #


class SwipeFieldsBody(BaseModel):
    dob: Optional[str] = None
    bio: Optional[str] = None
    city: Optional[str] = None
    instagram: Optional[str] = None
    photos: Optional[list[str]] = None  # base64 strings, max 3
    fav_clubs: Optional[list[str]] = None  # club_ids


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
    if body.photos is not None:
        if len(body.photos) > 3:
            raise HTTPException(status_code=400, detail="3 photos maximum")
        # Reject photos heavier than ~2MB each (base64 inflate ~33%)
        for p in body.photos:
            if not isinstance(p, str) or len(p) > 3_000_000:
                raise HTTPException(status_code=413, detail="Photo trop lourde (max 2MB)")
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
            out.append({**p, "request_id": it["request_id"], "created_at": it.get("created_at")})
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
    out = []
    for m in items:
        peer = umap.get(_other_user_id(m, uid))
        if not peer:
            continue
        last = await db.messages.find_one(
            {"match_id": m["match_id"]}, {"_id": 0}, sort=[("created_at", -1)],
        )
        out.append({
            "match_id": m["match_id"],
            "with_user_id": peer["user_id"],
            "name": peer.get("name", ""),
            "photo": (peer.get("photos") or [None])[0],
            "last_message": (last or {}).get("text"),
            "last_at": (last or {}).get("created_at") or m.get("last_message_at"),
        })
    return out


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
    text: str


@api_router.post("/matches/{match_id}/messages", status_code=201)
async def send_message(match_id: str, body: SendMessageBody, user: dict = Depends(get_current_user)):
    m = await db.matches.find_one({"match_id": match_id}, {"_id": 0})
    if not m or user["user_id"] not in (m["user_a"], m["user_b"]):
        raise HTTPException(status_code=404, detail="Match introuvable")
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message vide")
    if len(text) > 1000:
        raise HTTPException(status_code=400, detail="Message trop long (max 1000)")
    now = datetime.now(timezone.utc)
    doc = {
        "message_id": f"msg_{uuid.uuid4().hex[:10]}",
        "match_id": match_id,
        "from_user_id": user["user_id"],
        "text": text,
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
            message=text[:120],
            action_url=f"/chat/{match_id}",
            idempotency_key=doc["message_id"],
        )
    except Exception as e:
        logger.warning("push (chat) failed: %s", e)
    return doc


@api_router.get("/swipes/history")
async def swipe_history(user: dict = Depends(get_current_user)):
    history = await db.swipes.find(
        {"user_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return history


# -------------- Notifications -------------- #


@api_router.get("/notifications")
async def list_notifications(user: dict = Depends(get_current_user)):
    notifs = await db.notifications.find(
        {"$or": [{"user_id": user["user_id"]}, {"user_id": None}]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    return notifs


@api_router.post("/checkins")
async def checkin(body: CheckInBody, user: dict = Depends(get_current_user)):
    club = await db.clubs.find_one({"club_id": body.club_id}, {"_id": 0})
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
                "body": f"On garde l'œil sur les meilleurs sons {club['music_styles'][0]} pour toi.",
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


@api_router.post("/checkins/song")
async def add_detected_song(
    body: SongDetected, user: dict = Depends(get_current_user)
):
    """Record a track recognised (or manually added) while the user is at a
    club. Stored under the user profile, grouped by club."""
    club = await db.clubs.find_one({"club_id": body.club_id}, {"_id": 0})
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

    friends_list = []
    for f in accepted:
        peer_id = f["to_user_id"] if f["from_user_id"] == uid else f["from_user_id"]
        peer = await db.users.find_one({"user_id": peer_id}, {"_id": 0})
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


@api_router.post("/recognize/audio")
async def recognize_audio(
    body: AudioRecognizeBody, user: dict = Depends(get_current_user)
):
    """Identify a track from a short audio sample using Audd.io and store
    the result under the user profile, grouped by club."""
    audd_token = os.environ.get("AUDD_API_TOKEN", "").strip()
    if not audd_token:
        raise HTTPException(status_code=503, detail="Audd.io not configured")
    if http_client is None:
        raise HTTPException(status_code=503, detail="Service not ready")
    # "manual_scan" is a synthetic club_id used when the user taps the Shazam
    # button without being near a real venue — accept it gracefully.
    if body.club_id == "manual_scan":
        club = {"club_id": "manual_scan", "name": "Scan manuel"}
    else:
        club = await db.clubs.find_one({"club_id": body.club_id}, {"_id": 0})
        if not club:
            raise HTTPException(status_code=404, detail="Club not found")
    try:
        import base64
        raw = base64.b64decode(body.audio_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 audio")
    if len(raw) > 1_500_000:
        raise HTTPException(status_code=413, detail="Audio sample too large (max ~1.5MB)")

    try:
        files = {"file": ("sample.m4a", raw, "audio/m4a")}
        data = {"api_token": audd_token, "return": "spotify,apple_music"}
        r = await http_client.post(
            "https://api.audd.io/", data=data, files=files, timeout=20.0
        )
    except Exception as exc:
        logging.warning("Audd error: %s", exc)
        raise HTTPException(status_code=502, detail="Recognition provider error")

    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Audd HTTP error")
    payload = r.json() or {}
    result = payload.get("result")
    if not result:
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
REVENUECAT_WEBHOOK_SECRET = os.environ.get("REVENUECAT_WEBHOOK_SECRET", "")


async def _apply_rc_event(payload: dict) -> None:
    event = (payload or {}).get("event") or {}
    subscriber = event.get("subscriber") or (payload or {}).get("subscriber") or {}
    app_user_id = event.get("app_user_id") or subscriber.get("app_user_id")
    if not app_user_id:
        return
    entitlements = subscriber.get("entitlements") or {}
    ent = entitlements.get(PREMIUM_ENTITLEMENT_ID) or {}
    is_active = bool(ent.get("expires_date")) or event.get("type") in (
        "INITIAL_PURCHASE",
        "RENEWAL",
        "PRODUCT_CHANGE",
        "UNCANCELLATION",
        "NON_RENEWING_PURCHASE",
    )
    if event.get("type") in (
        "EXPIRATION",
        "CANCELLATION",
        "BILLING_ISSUE",
        "SUBSCRIPTION_PAUSED",
    ):
        is_active = False

    await db.users.update_one(
        {"user_id": app_user_id},
        {
            "$set": {
                "is_premium": is_active,
                "premium_product_id": ent.get("product_identifier") or event.get("product_id"),
                "premium_expires_at": ent.get("expires_date") or event.get("expiration_at_ms"),
                "rc_last_event": event.get("type"),
                "rc_updated_at": datetime.now(timezone.utc),
            }
        },
        upsert=False,
    )


@api_router.post("/billing/webhook")
async def revenuecat_webhook(request: Request):
    if REVENUECAT_WEBHOOK_SECRET:
        auth = request.headers.get("authorization", "")
        if auth != REVENUECAT_WEBHOOK_SECRET:
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
    rc_secret = os.environ.get("REVENUECAT_SECRET_KEY", "").strip()
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


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
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
