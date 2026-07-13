"""Roll past events forward so the "Sorties" screen is never empty.

Any event whose date is in the past gets rescheduled within the next 30 days
(keeps its original time of day). Run whenever demo data goes stale:
    python refresh_events.py
"""
import asyncio
import os
import random
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "test_database")]
    now = datetime.now(timezone.utc)

    updated = 0
    async for ev in db.events.find({}, {"_id": 1, "date": 1}):
        raw = ev.get("date")
        try:
            d = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if d.tzinfo is None:
                d = d.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        if d >= now:
            continue
        new_date = (now + timedelta(days=random.randint(1, 30))).replace(
            hour=d.hour, minute=d.minute, second=0, microsecond=0
        )
        await db.events.update_one(
            {"_id": ev["_id"]}, {"$set": {"date": new_date.isoformat()}}
        )
        updated += 1
    print(f"Rescheduled {updated} past events into the next 30 days.")


if __name__ == "__main__":
    asyncio.run(main())
