"""Pre-seed clubs for major French cities using the Google Places pipeline.

Uses the exact same import path as the live app (places_service.search_places_nearby)
so clubs get the standard schema, photos, music styles, dedupe and caching.

Run: python seed_city_clubs.py
"""
import asyncio
import math
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
    ("Nîmes", 43.8367, 4.3601),
    ("Saint-Étienne", 45.4397, 4.3872),
    ("Le Havre", 49.4944, 0.1079),
    ("Villeurbanne", 45.7719, 4.8902),
    ("Clermont-Ferrand", 45.7772, 3.0870),
    ("Amiens", 49.8942, 2.2957),
    ("Tours", 47.3941, 0.6848),
    ("Limoges", 45.8336, 1.2611),
    ("Annecy", 45.8992, 6.1294),
    ("Perpignan", 42.6887, 2.8948),
    ("Besançon", 47.2380, 6.0243),
    ("Metz", 49.1193, 6.1757),
    ("Orléans", 47.9029, 1.9093),
    ("Rouen", 49.4432, 1.0999),
    ("Mulhouse", 47.7508, 7.3359),
    ("Caen", 49.1829, -0.3707),
    ("Nancy", 48.6921, 6.1844),
    ("Avignon", 43.9493, 4.8055),
    ("Biarritz", 43.4832, -1.5586),
    ("Saint-Tropez", 43.2727, 6.6407),
    ("Deauville", 49.3600, 0.0750),
    ("Ibiza (ES)", 38.9067, 1.4206),
    ("Barcelone (ES)", 41.3874, 2.1686),
    ("Bruxelles (BE)", 50.8503, 4.3517),
    ("Genève (CH)", 46.2044, 6.1432),
]

# Grid fan-out per city: Google caps each Nearby Search at 20 results, so we
# probe the centre + 4 offset points (~9 km N/S/E/W) to harvest up to ~100
# distinct clubs per city.
OFFSETS_KM = [(0, 0), (9, 0), (-9, 0), (0, 9), (0, -9)]


async def main():
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[os.environ.get("DB_NAME", "test_database")]
    await places_service.ensure_indexes(db)

    before = await db.places.count_documents({})
    async with httpx.AsyncClient(timeout=30) as client:
        for name, lat, lng in CITIES:
            total = 0
            for dlat_km, dlng_km in OFFSETS_KM:
                s_lat = lat + dlat_km / 110.574
                s_lng = lng + dlng_km / (111.320 * max(0.2, abs(math.cos(math.radians(lat)))))
                try:
                    res = await places_service.search_places_nearby(
                        db, client, s_lat, s_lng, radius_km=7, max_results=20
                    )
                    total += len(res)
                except Exception as e:
                    print(f"{name:20s} offset({dlat_km},{dlng_km}) -> ERROR {e}")
            print(f"{name:20s} -> {total} résultats (bruts, dédupliqués en base)")
    after = await db.places.count_documents({})
    print(f"\nGoogle clubs in DB (db.places): {before} -> {after} (+{after - before})")


if __name__ == "__main__":
    asyncio.run(main())
