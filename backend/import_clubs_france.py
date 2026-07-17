"""Import élargi : toutes les communes françaises ≥ 8000 habitants.

Récupère la liste des communes via l'API publique geo.api.gouv.fr,
exclut celles déjà couvertes par import_clubs_bulk.CITIES (rayon 6 km),
puis lance la même recherche Google Places (bars + boîtes de nuit).

Usage : python3 import_clubs_france.py            # import complet
        python3 import_clubs_france.py --dry-run  # liste les communes sans appeler Google
"""
from __future__ import annotations

import asyncio
import math
import os
import sys
import time

import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from import_clubs_bulk import CITIES, TYPE_SETS, search_nearby  # noqa: E402
from places_service import PLACES_KEY, _map_place_to_club  # noqa: E402

MIN_POPULATION = 8000


def _dist_km(lat1, lng1, lat2, lng2):
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def fetch_communes() -> list:
    """Toutes les communes françaises ≥ MIN_POPULATION hab, hors déjà couvertes."""
    resp = requests.get(
        "https://geo.api.gouv.fr/communes",
        params={"fields": "nom,centre,population", "format": "json"},
        timeout=60,
    )
    resp.raise_for_status()
    communes = []
    for c in resp.json():
        pop = c.get("population") or 0
        centre = (c.get("centre") or {}).get("coordinates")
        if pop < MIN_POPULATION or not centre:
            continue
        lng, lat = centre
        # exclure les communes déjà couvertes par l'import initial
        if any(_dist_km(lat, lng, clat, clng) < 6 for _, clat, clng, _ in CITIES):
            continue
        communes.append((c["nom"], lat, lng, pop))
    communes.sort(key=lambda x: -x[3])
    return communes


async def main():
    dry = "--dry-run" in sys.argv
    communes = fetch_communes()
    est_calls = len(communes) * 2
    print(f"{len(communes)} communes à traiter (≥{MIN_POPULATION} hab, non couvertes)")
    print(f"Appels Google estimés : ~{est_calls} (≈ {est_calls * 0.032:.0f} $ au tarif Nearby Search)")
    if dry:
        for n, _, _, p in communes[:30]:
            print(f"  {n} ({p} hab)")
        print("  …")
        return

    if not PLACES_KEY:
        print("GOOGLE_PLACES_API_KEY manquante")
        return

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "night_finder")]
    before = await db.places.count_documents({})
    total_new = 0
    calls = 0

    for i, (name, lat, lng, pop) in enumerate(communes, 1):
        city_new = 0
        # 2 sets suffisent pour les petites communes (night_club/dance_hall + bar/pub)
        for types in TYPE_SETS[:2]:
            raw = search_nearby(lat, lng, 6.0, types)
            calls += 1
            for p in raw:
                club = _map_place_to_club(p)
                if club.get("lat") is None:
                    continue
                club.pop("expires_at", None)
                res = await db.places.update_one(
                    {"club_id": club["club_id"]},
                    {"$setOnInsert": club},
                    upsert=True,
                )
                if res.upserted_id is not None:
                    city_new += 1
            time.sleep(0.12)
        total_new += city_new
        if city_new or i % 25 == 0:
            print(f"[{i}/{len(communes)}] {name} ({pop} hab): +{city_new}  (total: {total_new}, appels: {calls})", flush=True)

    after = await db.places.count_documents({})
    print(f"\nTERMINÉ — avant: {before}, après: {after} (+{after - before}), appels API: {calls}")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
