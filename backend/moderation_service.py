"""Image moderation service for Night Finder.

Uses Gemini Flash (vision) via Emergent LLM key to classify uploaded
photos against safety categories required by Apple App Store guideline 1.2
(UGC) and 1.1.4 (Sexual content).

Categories detected:
    - nudity (explicit or partial nudity, sexual content)
    - gore (blood, severe injury, gore)
    - violence (weapons aimed at people, fights)
    - hate (hate symbols, hateful gestures)

The service degrades gracefully: if the LLM call fails or the API key is
missing, it logs a warning and returns ``safe=True`` (fail-open) so that
genuine users are never blocked by an infrastructure outage. Apple review
is enforced by the human report/block flow in addition to AI.
"""
from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import re
import time
import uuid
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Acceptable image sizes (bytes). > 4 MB is rejected outright to keep
# moderation cheap and fast.
MAX_BYTES = 4 * 1024 * 1024


def _strip_data_uri(image: str) -> tuple[str, Optional[str]]:
    """Return (raw_base64, mime) given a data URI or raw base64 string."""
    match = re.match(r"data:(image/[a-zA-Z+]+);base64,(.+)", image, re.DOTALL)
    if match:
        return match.group(2), match.group(1)
    return image, None


def _detect_mime(raw_b64: str) -> str:
    """Sniff a JPEG/PNG/WEBP header from a base64 payload (first 16 bytes)."""
    try:
        prefix = base64.b64decode(raw_b64[:64], validate=False)[:12]
    except (binascii.Error, ValueError):
        return "image/jpeg"
    if prefix.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if prefix.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if prefix[:4] == b"RIFF" and prefix[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


def _decode_json(text: str) -> Optional[dict]:
    """Extract the first JSON object from the model's free-form reply."""
    if not text:
        return None
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Fallback: extract first {...} block
    match = re.search(r"\{[^{}]*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return None


SAFETY_PROMPT = (
    "You are a strict image-safety classifier for a social mobile app where "
    "users 18+ upload profile photos. Apple App Store and EU law forbid "
    "publishing the following on a public profile, even partial:\n"
    "  • nudity (any explicit nudity, exposed genitals/buttocks/female nipples)\n"
    "  • sexual_content (sexual acts, lingerie suggestively posed, fetish gear)\n"
    "  • gore (blood, wounds, mutilation, dead bodies)\n"
    "  • violence (weapons pointed at people, fighting, beating)\n"
    "  • hate_symbols (nazi, kkk, terrorist iconography)\n"
    "Bikinis/swimwear on a beach, gym workout shots, shirtless men at the pool, "
    "and party photos are SAFE. Cosplay weapons or movie/concert posters are SAFE.\n"
    "\n"
    "Look at the attached image and reply ONLY with strict JSON, no markdown, "
    "matching exactly this schema:\n"
    "{\n"
    '  "nudity": boolean,\n'
    '  "sexual_content": boolean,\n'
    '  "gore": boolean,\n'
    '  "violence": boolean,\n'
    '  "hate_symbols": boolean,\n'
    '  "safe": boolean,           // true if ALL of the above are false\n'
    '  "reason": string           // short EN reason if unsafe, else ""\n'
    "}\n"
)


async def moderate_image(image: str, *, session_id: Optional[str] = None) -> dict:
    """Run safety classification on a single image.

    Args:
        image: data URI (``data:image/...;base64,XXX``) or raw base64 payload.
        session_id: optional session id forwarded to the LLM for traceability.

    Returns dict with keys: nudity, sexual_content, gore, violence,
    hate_symbols, safe, reason, latency_ms, fail_open.
    """
    started = time.monotonic()
    raw_b64, mime = _strip_data_uri(image)
    raw_b64 = raw_b64.strip()
    if not raw_b64:
        return {"safe": False, "reason": "empty_image", "fail_open": False}

    # Quick size guard
    try:
        approx_bytes = (len(raw_b64) * 3) // 4
    except Exception:  # noqa: BLE001
        approx_bytes = 0
    if approx_bytes > MAX_BYTES:
        return {
            "safe": False,
            "reason": "image_too_large",
            "fail_open": False,
            "size_bytes": approx_bytes,
        }

    if mime is None:
        mime = _detect_mime(raw_b64)
    if mime not in {"image/jpeg", "image/png", "image/webp"}:
        # Re-tag as JPEG; Gemini accepts JPEG/PNG/WEBP only
        mime = "image/jpeg"

    api_key = os.getenv("EMERGENT_LLM_KEY", "").strip()
    if not api_key:
        logger.warning("moderate_image: EMERGENT_LLM_KEY missing — fail-open")
        return {
            "safe": True,
            "reason": "moderation_unavailable",
            "fail_open": True,
            "latency_ms": int((time.monotonic() - started) * 1000),
        }

    try:
        from emergentintegrations.llm.chat import (  # type: ignore
            ImageContent,
            LlmChat,
            UserMessage,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("moderate_image: emergentintegrations unavailable — fail-open (%s)", exc)
        return {
            "safe": True,
            "reason": "moderation_lib_missing",
            "fail_open": True,
            "latency_ms": int((time.monotonic() - started) * 1000),
        }

    sid = session_id or f"mod-{uuid.uuid4().hex[:10]}"
    try:
        chat = LlmChat(
            api_key=api_key,
            session_id=sid,
            system_message="You are a precise JSON-only image safety classifier.",
        ).with_model("gemini", "gemini-3-flash-preview")

        msg = UserMessage(
            text=SAFETY_PROMPT,
            file_contents=[ImageContent(image_base64=raw_b64)],
        )
        # Use send_message (non-stream) — we want the final JSON, not tokens.
        reply = await chat.send_message(msg)
    except Exception as exc:  # noqa: BLE001
        logger.warning("moderate_image: LLM call failed — fail-open (%s)", exc)
        return {
            "safe": True,
            "reason": "moderation_error",
            "fail_open": True,
            "latency_ms": int((time.monotonic() - started) * 1000),
        }

    text = ""
    if isinstance(reply, str):
        text = reply
    elif isinstance(reply, dict):
        text = reply.get("content") or reply.get("text") or json.dumps(reply)
    else:
        text = getattr(reply, "content", None) or getattr(reply, "text", "") or str(reply)

    parsed = _decode_json(text or "")
    if not parsed or not isinstance(parsed, dict):
        logger.warning("moderate_image: failed to parse JSON from reply: %r", text[:300])
        return {
            "safe": True,
            "reason": "moderation_parse_error",
            "fail_open": True,
            "latency_ms": int((time.monotonic() - started) * 1000),
            "raw": text[:300],
        }

    result = {
        "nudity": bool(parsed.get("nudity")),
        "sexual_content": bool(parsed.get("sexual_content")),
        "gore": bool(parsed.get("gore")),
        "violence": bool(parsed.get("violence")),
        "hate_symbols": bool(parsed.get("hate_symbols")),
        "reason": str(parsed.get("reason", ""))[:200],
        "fail_open": False,
        "latency_ms": int((time.monotonic() - started) * 1000),
    }
    # Derive `safe` defensively (don't fully trust the model's own flag)
    flagged = (
        result["nudity"]
        or result["sexual_content"]
        or result["gore"]
        or result["violence"]
        or result["hate_symbols"]
    )
    result["safe"] = not flagged
    return result


def violation_label(verdict: dict) -> str:
    """Return a human-readable French reason if the verdict is unsafe."""
    if verdict.get("nudity"):
        return "Nudité ou contenu sexuel détecté"
    if verdict.get("sexual_content"):
        return "Contenu sexuel suggestif détecté"
    if verdict.get("gore"):
        return "Sang ou blessure grave détectés"
    if verdict.get("violence"):
        return "Scène de violence détectée"
    if verdict.get("hate_symbols"):
        return "Symbole haineux détecté"
    return "Contenu inapproprié détecté"
