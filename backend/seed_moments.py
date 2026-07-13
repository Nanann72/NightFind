"""Seed demo bot moments into club_moments (used by demo env + tests).

Idempotent-ish: removes previous bot-seeded moments (user_id prefix 'seedbot_')
then inserts fresh ones with a 7-day expiry so tests don't go stale daily.

Run: python seed_moments.py
"""
import asyncio
import os
import uuid
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# 1x1 violet PNG placeholder (valid base64 image)
TINY_PNG = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
    "AAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)

BOTS = [
    ("seedbot_lea", "Léa"),
    ("seedbot_maxime", "Maxime"),
    ("seedbot_chloe", "Chloé"),
]

CAPTIONS = [
    "Soirée incroyable ce soir 🔥",
    "Le DJ envoie du lourd 🎧",
    "Qui est là ? 🍸",
]


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "test_database")]

    clubs = await db.clubs.find({}, {"club_id": 1}).to_list(10)
    if not clubs:
        print("No clubs in DB — run club seed first.")
        return

    await db.club_moments.delete_many({"user_id": {"$regex": "^seedbot_"}})

    # Ensure bot user docs exist (blocking/reporting a moment author requires
    # the author to be a real user document).
    now = datetime.now(timezone.utc)
    for uid, name in BOTS:
        await db.users.update_one(
            {"user_id": uid},
            {"$setOnInsert": {
                "user_id": uid,
                "email": f"{uid}@bots.nightfinder.app",
                "name": name,
                "password_hash": "!disabled!",
                "dob": "1998-01-01",
                "music_prefs": [],
                "photos": [],
                "fav_clubs": [],
                "visibility": "clubs_only",
                "is_premium": False,
                "is_admin": False,
                "created_at": now,
            }},
            upsert=True,
        )

    docs = []
    for i, (uid, name) in enumerate(BOTS):
        club = clubs[i % len(clubs)]
        docs.append({
            "moment_id": f"mom_{uuid.uuid4().hex[:12]}",
            "user_id": uid,
            "user_name": name,
            "user_picture": None,
            "club_id": club["club_id"],
            "checkin_id": f"seedci_{uuid.uuid4().hex[:10]}",
            "image": TINY_PNG,
            "selfie": None,
            "caption": CAPTIONS[i % len(CAPTIONS)],
            "is_premium_author": False,
            "created_at": now - timedelta(minutes=10 * (i + 1)),
            "expires_at": now + timedelta(days=7),
            "likes_count": 0,
        })
    await db.club_moments.insert_many(docs)
    print(f"Seeded {len(docs)} bot moments (expire in 7 days).")


if __name__ == "__main__":
    asyncio.run(main())
