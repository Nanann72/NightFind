"""Seed an Apple Reviewer demo account for App Store submission.

Creates:
- 1 main reviewer account (apple.reviewer@nightfinder.app / Reviewer2026!)
  with Premium activated (lifetime), full swipe profile, 3 photos.
- 3 demo target profiles the reviewer can swipe on / match with.
- 2 pre-existing matches with chat messages so the reviewer can see the chat
  UI immediately without needing to swipe first.

Usage:
    cd /app/backend && python seed_reviewer.py
"""
from __future__ import annotations

import asyncio
import base64
import os
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "night_finder")

# ---------------------------------------------------------------------------
# Tiny colored PNG placeholders (1x1 px) — App Store reviewers don't care
# about photo content as long as the swipe UI works. Each "photo" is a tiny
# data URI we duplicate so the swipe card shows up with 3 photos.
# ---------------------------------------------------------------------------
def _solid_color_png_b64(r: int, g: int, b: int) -> str:
    """Return a minimal 1x1 PNG data URI of the given RGB color."""
    # PNG header + IHDR + sRGB + IDAT (1 pixel) + IEND, hand-built.
    import struct, zlib

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw = bytes([0, r, g, b])  # filter byte + RGB pixel
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")
    png = sig + ihdr + idat + iend
    return "data:image/png;base64," + base64.b64encode(png).decode()


REVIEWER_EMAIL = "apple.reviewer@nightfinder.app"
REVIEWER_PASSWORD = "Reviewer2026!"

REVIEWER_PHOTOS = [
    _solid_color_png_b64(224, 26, 79),   # #E01A4F (brand red)
    _solid_color_png_b64(124, 58, 237),  # #7C3AED (purple)
    _solid_color_png_b64(15, 23, 42),    # #0F172A (dark)
]

# 3 demo target profiles for swipe + match
DEMO_TARGETS = [
    {
        "user_id": "user_demo_emma01",
        "email": "emma.demo@nightfinder.app",
        "name": "Emma",
        "dob": "1999-03-12",
        "bio": "Adepte des soirées techno et des rooftops 🎧",
        "city": "Paris",
        "music_prefs": ["Techno", "House", "Afro"],
        "photos": [_solid_color_png_b64(236, 72, 153), _solid_color_png_b64(244, 114, 182)],
        "lat": 48.8566,
        "lng": 2.3522,
    },
    {
        "user_id": "user_demo_lucas02",
        "email": "lucas.demo@nightfinder.app",
        "name": "Lucas",
        "dob": "1996-07-22",
        "bio": "DJ amateur · Toujours partant pour un club après minuit 🌙",
        "city": "Paris",
        "music_prefs": ["House", "Disco", "Funk"],
        "photos": [_solid_color_png_b64(59, 130, 246), _solid_color_png_b64(99, 102, 241)],
        "lat": 48.8625,
        "lng": 2.3375,
    },
    {
        "user_id": "user_demo_sofia03",
        "email": "sofia.demo@nightfinder.app",
        "name": "Sofia",
        "dob": "2001-11-08",
        "bio": "Bar à cocktails > boîtes. Mais pour un bon set je viens 🍸",
        "city": "Paris",
        "music_prefs": ["RnB", "Afro", "Reggaeton"],
        "photos": [_solid_color_png_b64(251, 146, 60), _solid_color_png_b64(253, 186, 116)],
        "lat": 48.8730,
        "lng": 2.3499,
    },
]


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


async def main() -> None:
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    now = datetime.now(timezone.utc)
    one_year_later = now + timedelta(days=365)

    # ---- 1. Reviewer account ------------------------------------------------
    existing = await db.users.find_one({"email": REVIEWER_EMAIL})
    if existing:
        reviewer_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": reviewer_id},
            {"$set": {
                "password_hash": hash_password(REVIEWER_PASSWORD),
                "is_premium": True,
                "premium_product_id": "demo_reviewer_premium",
                "premium_expires_at": one_year_later,
                "photos": REVIEWER_PHOTOS,
                "bio": "Compte de démonstration App Store Reviewer.",
                "city": "Cupertino",
                "music_prefs": ["House", "Techno"],
                "name": "Apple Reviewer",
                "is_demo_reviewer": True,
            }},
        )
        print(f"♻️  Reviewer account updated: {REVIEWER_EMAIL} (id={reviewer_id})")
    else:
        reviewer_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": reviewer_id,
            "email": REVIEWER_EMAIL,
            "name": "Apple Reviewer",
            "dob": "1990-01-15",
            "password_hash": hash_password(REVIEWER_PASSWORD),
            "picture": None,
            "music_prefs": ["House", "Techno"],
            "bio": "Compte de démonstration App Store Reviewer.",
            "city": "Cupertino",
            "instagram": "",
            "photos": REVIEWER_PHOTOS,
            "fav_clubs": [],
            "auth_provider": "email",
            "created_at": now,
            "is_premium": True,
            "premium_product_id": "demo_reviewer_premium",
            "premium_expires_at": one_year_later,
            "is_demo_reviewer": True,
            "lat": 48.8566,
            "lng": 2.3522,
        })
        print(f"✅ Reviewer account created: {REVIEWER_EMAIL} (id={reviewer_id})")

    # ---- 2. Demo target profiles -------------------------------------------
    for t in DEMO_TARGETS:
        await db.users.update_one(
            {"user_id": t["user_id"]},
            {"$set": {
                "user_id": t["user_id"],
                "email": t["email"],
                "name": t["name"],
                "dob": t["dob"],
                "bio": t["bio"],
                "city": t["city"],
                "music_prefs": t["music_prefs"],
                "photos": t["photos"],
                "lat": t["lat"],
                "lng": t["lng"],
                "auth_provider": "email",
                "password_hash": hash_password("DemoOnly2026!"),
                "is_demo_reviewer": True,
                "fav_clubs": [],
                "created_at": now,
            }},
            upsert=True,
        )
        print(f"   📝 Demo profile: {t['name']} ({t['user_id']})")

    # ---- 3. Pre-existing matches + chat messages ---------------------------
    # Match #1 — Emma (already has a few messages so chat UI is populated)
    emma_id = DEMO_TARGETS[0]["user_id"]
    pair_a, pair_b = sorted([reviewer_id, emma_id])
    match1 = await db.matches.find_one({"user_a": pair_a, "user_b": pair_b})
    if not match1:
        match1_id = f"mt_{uuid.uuid4().hex[:10]}"
        await db.matches.insert_one({
            "match_id": match1_id,
            "user_a": pair_a,
            "user_b": pair_b,
            "created_at": now - timedelta(hours=3),
            "last_message_at": now - timedelta(minutes=12),
        })
        msgs = [
            (emma_id, "Hey ! Trop contente du match 😊", now - timedelta(hours=2, minutes=55)),
            (reviewer_id, "Salut Emma, ça te tente de sortir ce week-end ?", now - timedelta(hours=2, minutes=30)),
            (emma_id, "Carrément ! Tu connais Le Rex ?", now - timedelta(hours=2, minutes=20)),
            (reviewer_id, "Ouais top, on dit vendredi 23h ?", now - timedelta(hours=2)),
            (emma_id, "Parfait, à vendredi ✨", now - timedelta(minutes=12)),
        ]
        for sender, text, ts in msgs:
            await db.messages.insert_one({
                "message_id": f"msg_{uuid.uuid4().hex[:10]}",
                "match_id": match1_id,
                "from_user_id": sender,
                "text": text,
                "created_at": ts,
                "is_read": True,
            })
        print(f"   💬 Chat with Emma seeded ({len(msgs)} messages)")
    else:
        print(f"   ♻️  Match with Emma already exists")

    # Match #2 — Lucas (newer, fewer messages)
    lucas_id = DEMO_TARGETS[1]["user_id"]
    pair_a, pair_b = sorted([reviewer_id, lucas_id])
    match2 = await db.matches.find_one({"user_a": pair_a, "user_b": pair_b})
    if not match2:
        match2_id = f"mt_{uuid.uuid4().hex[:10]}"
        await db.matches.insert_one({
            "match_id": match2_id,
            "user_a": pair_a,
            "user_b": pair_b,
            "created_at": now - timedelta(minutes=30),
            "last_message_at": now - timedelta(minutes=8),
        })
        await db.messages.insert_one({
            "message_id": f"msg_{uuid.uuid4().hex[:10]}",
            "match_id": match2_id,
            "from_user_id": lucas_id,
            "text": "Yo ! Tu connais des bons clubs techno à Paris ?",
            "created_at": now - timedelta(minutes=8),
            "is_read": False,
        })
        print(f"   💬 Chat with Lucas seeded (1 unread message)")
    else:
        print(f"   ♻️  Match with Lucas already exists")

    # ---- 4. Pending match request from Sofia (so the reviewer can accept) ---
    sofia_id = DEMO_TARGETS[2]["user_id"]
    existing_mr = await db.match_requests.find_one(
        {"from_user_id": sofia_id, "to_user_id": reviewer_id}
    )
    if not existing_mr:
        await db.match_requests.insert_one({
            "request_id": f"mr_{uuid.uuid4().hex[:10]}",
            "from_user_id": sofia_id,
            "to_user_id": reviewer_id,
            "status": "pending",
            "created_at": now - timedelta(minutes=5),
        })
        print(f"   💌 Pending match request from Sofia → Reviewer")
    else:
        print(f"   ♻️  Match request from Sofia already exists")

    print()
    print("=" * 60)
    print("✨ DEMO REVIEWER ACCOUNT READY")
    print("=" * 60)
    print(f"📧 Email    : {REVIEWER_EMAIL}")
    print(f"🔑 Password : {REVIEWER_PASSWORD}")
    print(f"💎 Premium  : Active (1 year)")
    print(f"💬 Chats    : 2 existing matches (Emma + Lucas)")
    print(f"💌 Request  : 1 pending match request from Sofia")
    print("=" * 60)
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
