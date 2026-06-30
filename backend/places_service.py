"""Google Places API (New) service for Night Finder.

Calls places:searchNearby and places/{id} from our backend (IP restricted key),
caches results in MongoDB and maps them to the Night Finder Club schema.

Uses the synchronous `requests` library (forced IPv4) wrapped in
`asyncio.to_thread` so we can guarantee the outbound IP matches the IPv4
whitelist on the restricted API key — Kubernetes egress defaults to IPv6.
"""
from __future__ import annotations

import asyncio
import logging
import os
import socket
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
import requests
import urllib3.util.connection as urllib3_connection
from motor.motor_asyncio import AsyncIOMotorDatabase

# Force urllib3 (used by `requests`) to allow IPv4 only.
def _allowed_gai_family() -> int:
    return socket.AF_INET


urllib3_connection.allowed_gai_family = _allowed_gai_family  # type: ignore[assignment]

LOG = logging.getLogger("places")

PLACES_BASE = os.environ.get(
    "GOOGLE_PLACES_BASE_URL", "https://places.googleapis.com/v1"
)
PLACES_KEY = os.environ.get("GOOGLE_PLACES_API_KEY", "").strip()
PLACES_TTL_HOURS = int(os.environ.get("PLACES_CACHE_TTL_HOURS", "72"))

NEARBY_FIELD_MASK = (
    "places.id,"
    "places.displayName,"
    "places.formattedAddress,"
    "places.location,"
    "places.rating,"
    "places.userRatingCount,"
    "places.photos,"
    "places.regularOpeningHours,"
    "places.priceLevel,"
    "places.types,"
    "places.websiteUri,"
    "places.internationalPhoneNumber,"
    "places.primaryType"
)

# Map Google priceLevel → Night Finder avg_price approximation (EUR)
PRICE_MAP = {
    "PRICE_LEVEL_FREE": 0,
    "PRICE_LEVEL_INEXPENSIVE": 10,
    "PRICE_LEVEL_MODERATE": 18,
    "PRICE_LEVEL_EXPENSIVE": 30,
    "PRICE_LEVEL_VERY_EXPENSIVE": 50,
}

# Map Google types → Night Finder music_styles guess
TYPE_TO_MUSIC = {
    "night_club": ["Electro", "House"],
    "bar": ["Live", "Lounge"],
    "dance_hall": ["Techno", "House"],
    "karaoke": ["Variété", "Pop"],
    "casino": ["Lounge"],
}


def _is_enabled() -> bool:
    return bool(PLACES_KEY)


def _round_geo(value: float, ndigits: int = 2) -> float:
    return round(value, ndigits)


def _bucket_key(lat: float, lng: float, radius_km: float) -> str:
    # Bump the version suffix whenever the search algorithm changes (e.g. the
    # grid fan-out for Premium 200km), so old cached payloads are ignored.
    return f"nl:v2:{_round_geo(lat)}:{_round_geo(lng)}:{round(radius_km, 1)}"


async def _search_nearby_raw(
    client: httpx.AsyncClient,
    lat: float,
    lng: float,
    radius_km: float,
    max_results: int = 20,
) -> List[Dict[str, Any]]:
    radius_m = max(1.0, min(radius_km * 1000.0, 50000.0))
    url = f"{PLACES_BASE}/places:searchNearby"
    body = {
        "includedPrimaryTypes": ["night_club", "bar", "dance_hall"],
        "maxResultCount": max_results,
        "rankPreference": "POPULARITY",
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": radius_m,
            }
        },
    }
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": PLACES_KEY,
        "X-Goog-FieldMask": NEARBY_FIELD_MASK,
    }
    try:
        def _do_call():
            return requests.post(url, json=body, headers=headers, timeout=15)
        resp = await asyncio.to_thread(_do_call)
        if resp.status_code >= 400:
            LOG.warning("Places nearby failed: %s — %s", resp.status_code, resp.text[:300])
            return []
    except Exception as exc:  # noqa: BLE001
        LOG.warning("Places nearby error: %s", exc)
        return []
    return (resp.json() or {}).get("places", []) or []


def _grid_offsets_km(radius_km: float) -> List[tuple[float, float]]:
    """For a Premium 200km search, fan out 4 satellite circles around the
    center one so we cover the full disc (Google caps each call at 50km).

    Returns offsets (dlat_km, dlng_km) from the center. The center circle
    (0, 0) is always included.
    """
    if radius_km <= 50:
        return [(0.0, 0.0)]
    # 4 satellites at distance ≈ radius - 25 from center, in NE/NW/SE/SW
    # quadrants so each satellite's 50km disc overlaps slightly with the
    # center disc and covers up to ``radius_km`` from the user.
    step = max(40.0, radius_km * 0.5)
    offsets: List[tuple[float, float]] = [(0.0, 0.0)]
    for dlat, dlng in [(step, step), (step, -step), (-step, step), (-step, -step)]:
        offsets.append((dlat, dlng))
    return offsets


def _offset_geo(lat: float, lng: float, dlat_km: float, dlng_km: float) -> tuple[float, float]:
    """Translate (lat, lng) by (dlat_km, dlng_km). Good enough for ≤500km."""
    dlat = dlat_km / 111.0
    dlng = dlng_km / (111.0 * max(0.01, math.cos(math.radians(lat))))
    return lat + dlat, lng + dlng


def _photo_proxy_url(name: str, max_width: int = 1200) -> str:
    # name comes as 'places/<placeId>/photos/<photoId>' — encode to keep slashes routable
    from urllib.parse import quote
    return f"/api/places/photo?name={quote(name, safe='')}&max_width={max_width}"


def _map_place_to_club(p: Dict[str, Any]) -> Dict[str, Any]:
    pid = p.get("id") or ""
    name = (p.get("displayName") or {}).get("text") or "Lieu sans nom"
    loc = p.get("location") or {}
    lat = loc.get("latitude")
    lng = loc.get("longitude")
    types = p.get("types") or []
    primary = p.get("primaryType") or (types[0] if types else "establishment")
    price_lvl = p.get("priceLevel")
    avg_price = PRICE_MAP.get(price_lvl, 15)

    music_styles: List[str] = []
    for t in [primary, *types]:
        for m in TYPE_TO_MUSIC.get(t, []):
            if m not in music_styles:
                music_styles.append(m)
    if not music_styles:
        music_styles = ["Variété"]

    photos_meta = p.get("photos") or []
    photos_urls = [_photo_proxy_url(ph["name"]) for ph in photos_meta if ph.get("name")][:6]
    if not photos_urls:
        # Fallback hero from Unsplash so UI never breaks
        photos_urls = [
            "https://images.unsplash.com/photo-1571266028243-d220c6a9b40c?w=1200&q=80",
        ]

    hours_raw = p.get("regularOpeningHours") or {}
    weekday_desc = hours_raw.get("weekdayDescriptions") or []
    # Convert weekday descriptions to {Mon: "20:00-04:00"} for our schema
    DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    hours: Dict[str, str] = {}
    for i, line in enumerate(weekday_desc[:7]):
        try:
            # "Monday: 8:00 PM – 4:00 AM" or "Closed"
            _, rest = line.split(":", 1)
            rest = rest.strip()
            if rest.lower().startswith("closed") or "fermé" in rest.lower():
                hours[DAYS[i]] = "closed"
            else:
                hours[DAYS[i]] = rest
        except Exception:
            continue

    features: List[str] = []
    if "bar" in types:
        features.append("bar")
    if "outdoor_seating" in types or "terrasse" in name.lower():
        features.append("terrasse")
    if price_lvl in ("PRICE_LEVEL_EXPENSIVE", "PRICE_LEVEL_VERY_EXPENSIVE"):
        features.append("vip")

    return {
        "club_id": f"gp_{pid}",
        "source": "google_places",
        "place_id": pid,
        "name": name,
        "description": p.get("formattedAddress") or "",
        "address": p.get("formattedAddress") or "",
        "city": "",
        "lat": lat,
        "lng": lng,
        "music_styles": music_styles,
        "hours": hours,
        "features": features,
        "avg_price": avg_price,
        "photos": photos_urls,
        "rating": p.get("rating") or 0.0,
        "rating_count": p.get("userRatingCount") or 0,
        "website": p.get("websiteUri"),
        "phone": p.get("internationalPhoneNumber"),
        "types": types,
        "primary_type": primary,
    }


async def search_places_nearby(
    db: AsyncIOMotorDatabase,
    client: httpx.AsyncClient,
    lat: float,
    lng: float,
    radius_km: float,
    max_results: int = 20,
    force_refresh: bool = False,
) -> List[Dict[str, Any]]:
    """Search Google Places (or use cached results), map to club schema, store in DB."""
    if not _is_enabled():
        return []

    bucket = _bucket_key(lat, lng, radius_km)
    now = datetime.now(timezone.utc)

    if not force_refresh:
        cached = await db.places_cache.find_one({"_id": bucket})
        if cached and cached.get("expires_at"):
            exp = cached["expires_at"]
            if isinstance(exp, datetime) and exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if isinstance(exp, datetime) and exp > now:
                ids = cached.get("place_ids", [])
                if ids:
                    docs = await db.places.find(
                        {"place_id": {"$in": ids}}, {"_id": 0}
                    ).to_list(200)
                    if docs:
                        return docs

    raw_places: List[Dict[str, Any]] = []
    # For Premium 200km searches, Google caps each call at 50km — fan out
    # multiple searches across the grid to cover the full disc.
    offsets = _grid_offsets_km(radius_km)
    # Each individual call should request the per-call max (Google cap 50km).
    per_call_radius = min(radius_km, 50.0)
    seen_ids: set[str] = set()
    for dlat_km, dlng_km in offsets:
        s_lat, s_lng = _offset_geo(lat, lng, dlat_km, dlng_km)
        try:
            sub = await _search_nearby_raw(
                client, s_lat, s_lng, per_call_radius, max_results=max_results
            )
        except Exception as exc:  # noqa: BLE001
            LOG.warning("Grid sub-search failed at (%s,%s): %s", s_lat, s_lng, exc)
            continue
        for p in sub:
            pid = p.get("id")
            if not pid or pid in seen_ids:
                continue
            seen_ids.add(pid)
            raw_places.append(p)
    clubs: List[Dict[str, Any]] = []
    place_ids: List[str] = []
    for p in raw_places:
        try:
            club = _map_place_to_club(p)
        except Exception as exc:  # noqa: BLE001
            LOG.warning("Map error for %s: %s", p.get("id"), exc)
            continue
        if not club.get("lat") or not club.get("lng"):
            continue
        clubs.append(club)
        place_ids.append(club["place_id"])
        await db.places.update_one(
            {"place_id": club["place_id"]},
            {
                "$set": {
                    **club,
                    "expires_at": now + timedelta(hours=PLACES_TTL_HOURS),
                    "updated_at": now,
                }
            },
            upsert=True,
        )

    await db.places_cache.update_one(
        {"_id": bucket},
        {
            "$set": {
                "place_ids": place_ids,
                "expires_at": now + timedelta(hours=PLACES_TTL_HOURS),
                "updated_at": now,
            }
        },
        upsert=True,
    )
    return clubs


async def get_place_by_id(
    db: AsyncIOMotorDatabase, client: httpx.AsyncClient, place_id: str
) -> Optional[Dict[str, Any]]:
    if not _is_enabled():
        return None
    now = datetime.now(timezone.utc)
    cached = await db.places.find_one({"place_id": place_id}, {"_id": 0})
    if cached and cached.get("expires_at") and cached["expires_at"] > now:
        return cached

    url = f"{PLACES_BASE}/places/{place_id}"
    field_mask = NEARBY_FIELD_MASK.replace("places.", "")
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": PLACES_KEY,
        "X-Goog-FieldMask": field_mask,
    }
    try:
        resp = await client.get(url, headers=headers, timeout=10.0)
        resp.raise_for_status()
        place = resp.json()
    except Exception as exc:  # noqa: BLE001
        LOG.warning("Place details error %s: %s", place_id, exc)
        return cached  # fallback to stale cache if available

    club = _map_place_to_club(place)
    await db.places.update_one(
        {"place_id": place_id},
        {
            "$set": {
                **club,
                "expires_at": now + timedelta(hours=PLACES_TTL_HOURS),
                "updated_at": now,
            }
        },
        upsert=True,
    )
    return club


async def fetch_place_photo(
    client: httpx.AsyncClient, name: str, max_width: int = 1200
) -> Optional[tuple[bytes, str]]:
    if not _is_enabled() or not name:
        return None
    url = f"{PLACES_BASE}/{name}/media"
    params = {"maxWidthPx": max_width, "key": PLACES_KEY}
    try:
        # Google Places photo endpoint returns a 302 redirect to a CDN URL
        # (lh3.googleusercontent.com). httpx does NOT follow redirects by
        # default — we must opt-in explicitly here.
        resp = await client.get(
            url, params=params, timeout=15.0, follow_redirects=True
        )
        resp.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        LOG.warning("Photo fetch error: %s", exc)
        return None
    return resp.content, resp.headers.get("Content-Type", "image/jpeg")


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    """Create indexes for cache/TTL. Called once at startup."""
    try:
        await db.places.create_index("place_id", unique=True)
        await db.places.create_index([("lat", 1), ("lng", 1)])
        await db.places.create_index("expires_at", expireAfterSeconds=0)
        await db.places_cache.create_index("expires_at", expireAfterSeconds=0)
    except Exception as exc:  # noqa: BLE001
        LOG.warning("places ensure_indexes failed: %s", exc)
