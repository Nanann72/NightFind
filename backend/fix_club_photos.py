"""Remplace les photos génériques (Unsplash/Pexels) des clubs seed par les
vraies photos Google de l'établissement.

Stratégie :
1. Match avec db.places (nom normalisé + distance < 1.5 km) → copie les photos.
2. Sinon Google Places Text Search (« nom + adresse ») → photos réelles.
3. Exporte data/club_photos_fix.json pour l'appliquer en production au démarrage.

Usage : python3 fix_club_photos.py
"""
import asyncio
import json
import math
import os
import re
import time
import unicodedata

import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from places_service import PLACES_BASE, PLACES_KEY, _photo_proxy_url  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "data", "club_photos_fix.json")
GENERIC = re.compile(r"unsplash|pexels", re.I)


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def dist_km(lat1, lng1, lat2, lng2):
    if None in (lat1, lng1, lat2, lng2):
        return 9e9
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def text_search_photos(query: str) -> list:
    """Photos réelles du lieu via Google Places Text Search (1 appel)."""
    try:
        resp = requests.post(
            f"{PLACES_BASE}/places:searchText",
            json={"textQuery": query, "maxResultCount": 1},
            headers={
                "Content-Type": "application/json",
                "X-Goog-Api-Key": PLACES_KEY,
                "X-Goog-FieldMask": "places.photos,places.displayName",
            },
            timeout=15,
        )
        if resp.status_code >= 400:
            return []
        places = (resp.json() or {}).get("places") or []
        if not places:
            return []
        photos = places[0].get("photos") or []
        return [_photo_proxy_url(p["name"]) for p in photos[:4] if p.get("name")]
    except Exception:
        return []


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "night_finder")]

    places = await db.places.find(
        {"photos.0": {"$exists": True}},
        {"_id": 0, "name": 1, "lat": 1, "lng": 1, "photos": 1},
    ).to_list(20000)
    by_norm = {}
    for p in places:
        by_norm.setdefault(norm(p["name"]), []).append(p)

    fixes = {}
    matched = fetched = missed = 0
    async for club in db.clubs.find({}):
        photo0 = (club.get("photos") or [""])[0]
        if not GENERIC.search(photo0 or ""):
            continue
        cname, clat, clng = club["name"], club.get("lat"), club.get("lng")
        n = norm(cname)
        # 1) match direct / partiel avec les lieux importés
        candidates = list(by_norm.get(n, []))
        if not candidates:
            for key, plist in by_norm.items():
                if (n in key or key in n) and len(key) >= 4:
                    candidates.extend(plist)
        best = None
        for cand in candidates:
            if dist_km(clat, clng, cand.get("lat"), cand.get("lng")) < 1.5:
                best = cand
                break
        new_photos = None
        if best:
            new_photos = best["photos"][:4]
            matched += 1
        elif PLACES_KEY:
            q = f"{cname} {club.get('address') or ''} {club.get('city') or 'Paris'}".strip()
            new_photos = text_search_photos(q)
            time.sleep(0.1)
            if new_photos:
                fetched += 1
        if new_photos:
            await db.clubs.update_one(
                {"club_id": club["club_id"]}, {"$set": {"photos": new_photos}}
            )
            fixes[cname] = new_photos
            print(f"✅ {cname} ({'places' if best else 'text search'})")
        else:
            missed += 1
            print(f"❌ {cname} — aucune photo réelle trouvée (photo générique conservée)")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fixes, f, ensure_ascii=False)
    print(f"\nTERMINÉ — match places: {matched}, text search: {fetched}, introuvables: {missed}")
    print(f"Export → {OUT}")
    client.close()


asyncio.run(main())
