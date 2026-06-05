"""Emergent-managed push notifications relay.

This module proxies push registration & triggers to the upstream
Emergent push provider. EMERGENT_PUSH_KEY is replaced by the deployer
at build time — keep "placeholder" in local dev.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger("nightfinder.push")

PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")

_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=PUSH_BASE_URL,
            headers={"X-Push-Key": PUSH_KEY},
            timeout=10.0,
        )
    return _client


async def register_device(user_id: str, platform: str, device_token: str) -> bool:
    """Register a device token with the Emergent push relay.
    Returns True on success, False on failure (no exception raised)."""
    if not device_token:
        return False
    try:
        client = _get_client()
        resp = await client.post(
            "/api/v1/push/users/register",
            json={
                "user_id": user_id,
                "platform": platform,
                "device_token": device_token,
            },
        )
        if resp.status_code == 401:
            logger.warning("EMERGENT_PUSH_KEY missing or invalid (register)")
            return False
        if resp.status_code >= 400:
            logger.warning("push register failed: %s %s", resp.status_code, resp.text[:200])
            return False
        return True
    except Exception as e:  # pragma: no cover - upstream failure
        logger.warning("push register exception: %s", e)
        return False


async def send_push(
    recipients: list[str],
    title: str,
    message: str,
    *,
    action_url: Optional[str] = None,
    image_url: Optional[str] = None,
    idempotency_key: Optional[str] = None,
) -> bool:
    """Send a push notification to one or more user_ids. Never raises.

    Returns True if upstream accepted the call, False otherwise.
    """
    if not recipients:
        return False
    if not title or not message:
        return False
    # Cap to upstream limit
    recipients = list({r for r in recipients if r})[:100]
    data: dict = {"title": title, "message": message}
    if action_url:
        data["action_url"] = action_url
    if image_url:
        data["image_url"] = image_url
    payload: dict = {"recipients": recipients, "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key
    try:
        client = _get_client()
        resp = await client.post("/api/v1/push/trigger", json=payload)
        if resp.status_code == 401:
            logger.warning("EMERGENT_PUSH_KEY missing or invalid (trigger)")
            return False
        if resp.status_code >= 400:
            logger.warning("push trigger failed: %s %s", resp.status_code, resp.text[:200])
            return False
        return True
    except Exception as e:  # pragma: no cover - upstream failure
        logger.warning("push trigger exception: %s", e)
        return False


async def aclose() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
