"""Exporte db.places vers un dump gzip embarqué dans le déploiement.

Le dump est chargé automatiquement au démarrage du serveur si la base
de production contient moins de PLACES_SEED_THRESHOLD lieux.

Usage : python3 export_places_dump.py
"""
import asyncio
import gzip
import json
import os

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

OUT = os.path.join(os.path.dirname(__file__), "data", "places_dump.json.gz")


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "night_finder")]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    docs = []
    async for doc in db.places.find({}, {"_id": 0}):
        for k, v in list(doc.items()):
            if hasattr(v, "isoformat"):
                doc[k] = v.isoformat()
        docs.append(doc)
    with gzip.open(OUT, "wt", encoding="utf-8") as f:
        json.dump(docs, f, ensure_ascii=False)
    print(f"{len(docs)} lieux exportés → {OUT} ({os.path.getsize(OUT) / 1e6:.1f} MB)")
    client.close()


asyncio.run(main())
