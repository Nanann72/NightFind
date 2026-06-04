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

app = FastAPI(title="Night Finder API")
api_router = APIRouter(prefix="/api")

# -------------- Models -------------- #


class EmailSignup(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str


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
    }


# -------------- Auth routes -------------- #


@api_router.post("/auth/register")
async def register(body: EmailSignup):
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user = {
        "user_id": user_id,
        "email": body.email.lower(),
        "name": body.name,
        "password_hash": hash_password(body.password),
        "picture": None,
        "music_prefs": [],
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


def _is_open_now(hours: dict) -> bool:
    now = datetime.now(timezone.utc)
    # Paris is UTC+1/+2, but for MVP we treat hours as local
    weekday = now.strftime("%a").lower()  # mon, tue...
    today = hours.get(weekday)
    if not today or not today.get("open"):
        return False
    # Simplified: treat clubs as open if entry exists
    return True


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

    cursor = db.clubs.find(query, {"_id": 0})
    items = await cursor.to_list(500)

    if lat is not None and lng is not None:
        for c in items:
            c["distance_km"] = round(
                haversine_km(lat, lng, c["lat"], c["lng"]), 2
            )
        items = [c for c in items if c.get("distance_km", 1e9) <= radius_km]
        items.sort(key=lambda c: c["distance_km"])
    else:
        for c in items:
            c["distance_km"] = None

    if open_now:
        items = [c for c in items if _is_open_now(c.get("hours", {}))]

    return items


@api_router.get("/clubs/{club_id}")
async def get_club(club_id: str):
    club = await db.clubs.find_one({"club_id": club_id}, {"_id": 0})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")
    events = await db.events.find({"club_id": club_id}, {"_id": 0}).to_list(50)
    club["events"] = sorted(events, key=lambda e: e.get("date", ""))
    return club


# -------------- Events -------------- #


@api_router.get("/events")
async def list_events(upcoming_only: bool = True):
    query: dict = {}
    if upcoming_only:
        query["date"] = {"$gte": datetime.now(timezone.utc).isoformat()}
    events = await db.events.find(query, {"_id": 0}).to_list(500)
    # Enrich with club info
    club_map = {c["club_id"]: c async for c in db.clubs.find({}, {"_id": 0})}
    for e in events:
        c = club_map.get(e["club_id"])
        if c:
            e["club_name"] = c["name"]
            e["club_photo"] = c["photos"][0] if c.get("photos") else None
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
    return {"ok": True, "checkin_id": ci_id, "confirmed": body.confirmed}


@api_router.get("/checkins")
async def list_checkins(user: dict = Depends(get_current_user)):
    items = await db.checkins.find(
        {"user_id": user["user_id"], "confirmed": True}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return items


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
            "mon": {"open": False},
            "tue": {"open": True, "from": "20:00", "to": "02:00"},
            "wed": {"open": True, "from": "20:00", "to": "04:00"},
            "thu": {"open": True, "from": "20:00", "to": "05:00"},
            "fri": {"open": True, "from": "20:00", "to": "06:00"},
            "sat": {"open": True, "from": "20:00", "to": "06:00"},
            "sun": {"open": False},
        },
        "photos": [
            "https://images.pexels.com/photos/15648325/pexels-photo-15648325.jpeg",
        ],
    },
]


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

    # Seed clubs
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
                }
            )
        await db.events.insert_many(events)
        logging.info(f"Seeded {len(seeded)} clubs and {len(events)} events.")

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


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
