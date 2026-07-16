"""Seed des matchs/conversations entre profils démo pour les captures App Store."""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "test_database")]
    now = datetime.now(timezone.utc)

    emma = await db.users.find_one({"email": "emma.demo@nightfinder.app"})
    lucas = await db.users.find_one({"email": "lucas.demo@nightfinder.app"})
    sofia = await db.users.find_one({"email": "sofia.demo@nightfinder.app"})
    if not (emma and lucas and sofia):
        print("Profils démo manquants"); return

    pairs = [
        (lucas["user_id"], [
            (lucas["user_id"], "Yo Emma ! Concrete ce soir, ça te dit ? 🔥", timedelta(hours=1, minutes=40)),
            (emma["user_id"], "Grave ! J'ai vu que le line-up est incroyable", timedelta(hours=1, minutes=20)),
            (lucas["user_id"], "On se retrouve là-bas vers 23h30 ?", timedelta(minutes=50)),
            (emma["user_id"], "Parfait, à toute ! ✨", timedelta(minutes=6)),
        ]),
        (sofia["user_id"], [
            (sofia["user_id"], "Coucou ! Trop bien ton moment au Rex 😍", timedelta(hours=5)),
            (emma["user_id"], "Merci ! La soirée était folle 🎶", timedelta(hours=4, minutes=30)),
            (sofia["user_id"], "Faut qu'on y aille ensemble la prochaine fois !", timedelta(hours=3)),
        ]),
    ]

    for other_id, msgs in pairs:
        a, b = sorted([emma["user_id"], other_id])
        existing = await db.matches.find_one({"user_a": a, "user_b": b})
        if existing:
            print(f"♻️ match {a}-{b} existe déjà"); continue
        match_id = f"mt_{uuid.uuid4().hex[:10]}"
        await db.matches.insert_one({
            "match_id": match_id, "user_a": a, "user_b": b,
            "created_at": now - timedelta(hours=6),
            "last_message_at": now - msgs[-1][2],
        })
        for sender, text, ago in msgs:
            await db.messages.insert_one({
                "message_id": f"msg_{uuid.uuid4().hex[:10]}",
                "match_id": match_id, "from_user_id": sender,
                "text": text, "created_at": now - ago, "is_read": sender == emma["user_id"],
            })
        print(f"💬 match Emma ↔ {other_id} seedé ({len(msgs)} messages)")

    client.close()


asyncio.run(main())
