"""Admin utilities — bot seeding, cleanup, user moderation and stats.

Access to these routes MUST be gated behind `require_admin` in server.py.
Everything here operates on the shared `db` handle passed in.
"""
from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional


# ---------------- Bot content pools ---------------- #

FIRST_NAMES = [
    "Léa", "Chloé", "Emma", "Camille", "Manon", "Sarah", "Julie", "Inès",
    "Louise", "Anaïs", "Alice", "Zoé", "Clara", "Léna", "Lucie",
    "Lucas", "Théo", "Hugo", "Léo", "Nathan", "Enzo", "Louis", "Jules",
    "Antoine", "Mathis", "Adam", "Raphaël", "Malo", "Ethan", "Timéo",
]

BIOS_FR = [
    "Passionné de nuit et de techno. 🎧",
    "Toujours partant pour un dernier verre.",
    "House lover, café dealer le lendemain.",
    "Danse d'abord, on parle après.",
    "Weekend = vinyle, semaine = teams.",
    "Fan de rooftops et de sunrise sets.",
    "Boiler Room > Netflix.",
    "En quête du meilleur son parisien.",
    "Pizza à 4h > brunch à 11h.",
    "Latine dans l'âme, techno dans le cœur.",
    "Photographe amateur, clubber pro.",
    "J'aime les concepts et les afters.",
    "Berlin > Paris, mais Paris quand même.",
    "Soirée à thème ? Toujours partant.",
    "Vodka-Redbull et gros son.",
]

MUSIC_PREFS_POOL = [
    "Techno", "House", "Deep House", "Minimal", "Afro House", "Hip-Hop",
    "R&B", "Jazz", "Electro", "Disco", "Funk", "Indie", "Amapiano",
    "Reggaeton", "Drum & Bass",
]

# Paris center coordinates (Notre-Dame area) — bots will be scattered
# within ~5 km radius so they show up on the map naturally.
PARIS_LAT = 48.8566
PARIS_LNG = 2.3522


# Avatar image pool — royalty-free Unsplash portraits (people).
AVATAR_URLS = [
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",  # F
    "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400",  # F
    "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400",     # F
    "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400",  # F
    "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=400",  # F
    "https://images.unsplash.com/photo-1509967419530-da38b4704bc6?w=400",  # F
    "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=400",  # M
    "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400",  # M
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",  # M
    "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400",  # M
    "https://images.unsplash.com/photo-1531891437562-4301cf35b7e4?w=400",  # M
    "https://images.unsplash.com/photo-1541823709867-1b206113eafd?w=400",  # M
    "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400",  # M
    "https://images.unsplash.com/photo-1502378735452-bc7d86632805?w=400",  # M
    "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400",  # F
]


def _random_paris_coords() -> tuple[float, float]:
    """Return a random (lat, lng) tuple within ~5km of Paris center."""
    # 0.045° latitude ≈ 5 km ; longitude compensated by cos(lat)
    lat_offset = random.uniform(-0.045, 0.045)
    lng_offset = random.uniform(-0.065, 0.065)
    return PARIS_LAT + lat_offset, PARIS_LNG + lng_offset


def _random_dob(min_age: int = 21, max_age: int = 33) -> str:
    """Return a random DOB in YYYY-MM-DD format for age between min/max."""
    year = datetime.now().year - random.randint(min_age, max_age)
    month = random.randint(1, 12)
    day = random.randint(1, 28)
    return f"{year:04d}-{month:02d}-{day:02d}"


def _generate_bot_payload(index: int) -> dict[str, Any]:
    """Build a single bot document ready to insert."""
    name = random.choice(FIRST_NAMES)
    lat, lng = _random_paris_coords()
    music = random.sample(MUSIC_PREFS_POOL, k=random.randint(2, 4))
    return {
        "user_id": f"bot_{uuid.uuid4().hex[:12]}",
        "email": f"bot_{index}_{uuid.uuid4().hex[:6]}@nightfinder.bot",
        "name": name,
        "dob": _random_dob(),
        "password_hash": "!bot-disabled!",  # bots can't log in
        "picture": random.choice(AVATAR_URLS),
        "photos": [random.choice(AVATAR_URLS)],
        "music_prefs": music,
        "bio": random.choice(BIOS_FR),
        "city": "Paris",
        "instagram": f"@{name.lower()}_{random.randint(10, 99)}",
        "fav_clubs": [],
        "auth_provider": "bot",
        "is_premium": random.random() < 0.35,
        "is_bot": True,  # ⚑ flag for cleanup
        "visibility": "everyone",
        "location": {
            "lat": lat,
            "lng": lng,
            "updated_at": datetime.now(timezone.utc),
        },
        "created_at": datetime.now(timezone.utc),
    }


# ---------------- Public helpers ---------------- #


async def seed_bots(db, count: int = 20) -> dict[str, Any]:
    """Insert `count` bot users. Returns summary."""
    count = max(1, min(count, 100))
    bots = [_generate_bot_payload(i) for i in range(count)]
    await db.users.insert_many(bots)
    return {
        "ok": True,
        "created": count,
        "sample_names": [b["name"] for b in bots[:5]],
    }


async def delete_all_bots(db) -> dict[str, Any]:
    """Remove all bot users AND their associated data."""
    # Get all bot user_ids first (for cleaning up related data)
    bot_users = await db.users.find(
        {"is_bot": True}, {"_id": 0, "user_id": 1}
    ).to_list(length=1000)
    bot_ids = [b["user_id"] for b in bot_users]

    deleted_counts: dict[str, int] = {}
    if bot_ids:
        # Delete the bots themselves
        u_res = await db.users.delete_many({"is_bot": True})
        deleted_counts["users"] = u_res.deleted_count

        # Clean up related data
        for coll_name in ("swipes", "matches", "messages", "match_requests",
                          "club_moments", "notifications", "favorites"):
            try:
                res = await db[coll_name].delete_many({
                    "$or": [
                        {"user_id": {"$in": bot_ids}},
                        {"from_user_id": {"$in": bot_ids}},
                        {"to_user_id": {"$in": bot_ids}},
                        {"peer_id": {"$in": bot_ids}},
                        {"users": {"$in": bot_ids}},
                    ]
                })
                if res.deleted_count:
                    deleted_counts[coll_name] = res.deleted_count
            except Exception:
                pass
    return {"ok": True, "deleted": deleted_counts}


async def get_bot_stats(db) -> dict[str, Any]:
    """Return bot presence stats."""
    total = await db.users.count_documents({"is_bot": True})
    premium = await db.users.count_documents({"is_bot": True, "is_premium": True})
    with_location = await db.users.count_documents(
        {"is_bot": True, "location": {"$exists": True}}
    )
    return {
        "total_bots": total,
        "premium_bots": premium,
        "bots_with_location": with_location,
    }


# ---------------- User moderation ---------------- #


def _public_user_admin(u: dict) -> dict:
    """Slim user representation for admin lists (no password/hash/tokens)."""
    now = datetime.now(timezone.utc)
    banned_until = u.get("banned_until")
    if banned_until and hasattr(banned_until, "tzinfo") and banned_until.tzinfo is None:
        banned_until = banned_until.replace(tzinfo=timezone.utc)
    premium_expires_at = u.get("premium_expires_at")
    if premium_expires_at and hasattr(premium_expires_at, "tzinfo") and premium_expires_at.tzinfo is None:
        premium_expires_at = premium_expires_at.replace(tzinfo=timezone.utc)
    return {
        "user_id": u.get("user_id"),
        "email": u.get("email"),
        "name": u.get("name"),
        "picture": u.get("picture") or ((u.get("photos") or [None])[0]),
        "city": u.get("city"),
        "is_admin": bool(u.get("is_admin")),
        "is_premium": bool(u.get("is_premium")),
        "premium_expires_at": premium_expires_at.isoformat() if premium_expires_at else None,
        "is_bot": bool(u.get("is_bot")),
        "is_banned": bool(u.get("is_banned")) and (
            banned_until is None or banned_until > now
        ),
        "banned_until": banned_until.isoformat() if banned_until else None,
        "ban_reason": u.get("ban_reason"),
        "created_at": (u.get("created_at").isoformat() if u.get("created_at") else None),
    }


async def search_users(db, q: str = "", limit: int = 50) -> dict[str, Any]:
    """Full-text-ish search on email / name. Excludes admin accounts."""
    query: dict[str, Any] = {"is_admin": {"$ne": True}}
    q = (q or "").strip()
    if q:
        # Escape regex special chars in the user query
        safe = "".join(f"\\{ch}" if ch in ".^$*+?()[]{}|" else ch for ch in q)
        query["$or"] = [
            {"email": {"$regex": safe, "$options": "i"}},
            {"name": {"$regex": safe, "$options": "i"}},
        ]
    cursor = db.users.find(query, {"_id": 0}).sort("created_at", -1).limit(max(1, min(limit, 200)))
    users = [_public_user_admin(u) for u in await cursor.to_list(length=limit)]
    return {"users": users, "count": len(users)}


async def ban_user(
    db,
    user_id: str,
    *,
    duration_hours: Optional[int] = None,
    reason: Optional[str] = None,
) -> dict[str, Any]:
    """Ban a user. `duration_hours=None` → permanent."""
    user = await db.users.find_one({"user_id": user_id})
    if not user:
        return {"ok": False, "error": "User not found"}
    if user.get("is_admin"):
        return {"ok": False, "error": "Cannot ban an admin"}
    now = datetime.now(timezone.utc)
    banned_until = None if not duration_hours else now + timedelta(hours=duration_hours)
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {
            "is_banned": True,
            "banned_until": banned_until,
            "ban_reason": (reason or "").strip()[:200] or None,
            "banned_at": now,
        }},
    )
    return {"ok": True, "banned_until": banned_until.isoformat() if banned_until else None}


async def unban_user(db, user_id: str) -> dict[str, Any]:
    res = await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"is_banned": False, "banned_until": None, "ban_reason": None}},
    )
    if res.matched_count == 0:
        return {"ok": False, "error": "User not found"}
    return {"ok": True}


async def set_user_premium(
    db,
    user_id: str,
    *,
    duration_days: Optional[int] = None,
    remove: bool = False,
) -> dict[str, Any]:
    """Grant Premium (or remove).

    - remove=True → strip premium immediately.
    - duration_days=None → unlimited (never expires).
    - duration_days=N → premium for the next N days.
    """
    user = await db.users.find_one({"user_id": user_id})
    if not user:
        return {"ok": False, "error": "User not found"}
    now = datetime.now(timezone.utc)
    if remove:
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"is_premium": False, "premium_expires_at": None}},
        )
        return {"ok": True, "is_premium": False}
    expires_at = None if duration_days is None else now + timedelta(days=duration_days)
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {
            "is_premium": True,
            "premium_expires_at": expires_at,
            "premium_granted_by_admin": True,
        }},
    )
    return {
        "ok": True,
        "is_premium": True,
        "premium_expires_at": expires_at.isoformat() if expires_at else None,
    }


# ---------------- Ban check ---------------- #


def is_user_banned(user: dict) -> tuple[bool, Optional[str]]:
    """Return (is_banned_now, reason). Auto-expires temporary bans."""
    if not user.get("is_banned"):
        return False, None
    banned_until = user.get("banned_until")
    if banned_until is None:
        # permanent ban
        return True, user.get("ban_reason")
    if hasattr(banned_until, "tzinfo") and banned_until.tzinfo is None:
        banned_until = banned_until.replace(tzinfo=timezone.utc)
    if banned_until <= datetime.now(timezone.utc):
        return False, None  # expired
    return True, user.get("ban_reason")
