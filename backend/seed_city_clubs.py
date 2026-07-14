"""Pre-seed clubs for major French cities using the Google Places pipeline.

Uses the exact same import path as the live app (places_service.search_places_nearby)
so clubs get the standard schema, photos, music styles, dedupe and caching.

Run: python seed_city_clubs.py
"""
import asyncio
import os

import httpx
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

import places_service  # noqa: E402

CITIES = [
    ("Paris", 48.8566, 2.3522),
    ("Marseille", 43.2965, 5.3698),
    ("Lyon", 45.7640, 4.8357),
    ("Toulouse", 43.6047, 1.4442),
    ("Nice", 43.7102, 7.2620),
    ("Nantes", 47.2184, -1.5536),
    ("Montpellier", 43.6108, 3.8767),
    ("Strasbourg", 48.5734, 7.7521),
    ("Bordeaux", 44.8378, -0.5792),
    ("Lille", 50.6292, 3.0573),
    ("Rennes", 48.1173, -1.6778),
    ("Reims", 49.2583, 4.0317),
    ("Toulon", 43.1242, 5.9280),
    ("Grenoble", 45.1885, 5.7245),
    ("Dijon", 47.3220, 5.0415),
    ("Angers", 47.4784, -0.5632),
    ("Le Mans", 48.0061, 0.1996),
    ("Aix-en-Provence", 43.5297, 5.4474),
    ("La Rochelle", 46.1591, -1.1520),
    ("Cannes", 43.5528, 7.0174),
]


async def main():
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[os.environ.get("DB_NAME", "test_database")]
    await places_service.ensure_indexes(db)

    before = await db.places.count_documents({})
    async with httpx.AsyncClient(timeout=30) as client:
        for name, lat, lng in CITIES:
            try:
                res = await places_service.search_places_nearby(
                    db, client, lat, lng, radius_km=12, max_results=20
                )
                print(f"{name:20s} -> {len(res)} clubs")
            except Exception as e:
                print(f"{name:20s} -> ERROR {e}")
    after = await db.places.count_documents({})
    print(f"\nGoogle clubs in DB (db.places): {before} -> {after} (+{after - before})")


if __name__ == "__main__":
    asyncio.run(main())
