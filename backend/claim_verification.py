"""Night Finder — Vérification automatique des revendications de bar (robot IA).

Analyse la pièce d'identité et l'extrait Kbis via Gemini Vision (Emergent LLM key).
Mode STRICT :
  - la pièce d'identité doit être lisible ET le nom doit correspondre au nom déclaré ;
  - le Kbis doit être un extrait Kbis / registre du commerce lisible ET mentionner
    l'établissement (nom commercial ou dénomination proche).

Fail-safe : en cas d'erreur infra/LLM, on NE rejette PAS — la demande part en
examen manuel (approve=None).
"""
from __future__ import annotations

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


def _strip_b64(image: str) -> str:
    m = re.match(r"data:image/[a-zA-Z+]+;base64,(.+)", image or "", re.DOTALL)
    return (m.group(1) if m else image or "").strip()


def _decode_json(text: str) -> Optional[dict]:
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return None
    return None


def _prompt(owner_name: str, club_name: str, role: str) -> str:
    return (
        "Tu es un agent de vérification KYC strict pour l'application Night Finder. "
        "Un utilisateur revendique la propriété d'un établissement (bar/club).\n"
        f"Nom déclaré du demandeur : « {owner_name} »\n"
        f"Rôle déclaré : « {role} »\n"
        f"Établissement revendiqué : « {club_name} »\n\n"
        "Deux images sont jointes :\n"
        "  IMAGE 1 = pièce d'identité (CNI, passeport, permis de conduire…)\n"
        "  IMAGE 2 = extrait Kbis / registre du commerce (SIRENE, INPI…)\n\n"
        "Vérifie STRICTEMENT :\n"
        "1. id_valid : l'image 1 est bien une pièce d'identité officielle LISIBLE "
        "(pas une photo aléatoire, pas floue au point d'être illisible).\n"
        "2. id_name_matches : le nom/prénom lisible sur la pièce correspond au nom "
        "déclaré (tolère l'ordre nom/prénom, les accents et abréviations).\n"
        "3. kbis_valid : l'image 2 est bien un extrait Kbis ou un document officiel "
        "d'immatriculation d'entreprise LISIBLE.\n"
        "4. kbis_establishment_matches : le nom de l'établissement (dénomination "
        "sociale, nom commercial ou enseigne) sur le Kbis correspond à l'établissement "
        "revendiqué (tolère les différences mineures type « Le/La », majuscules, "
        "forme juridique SARL/SAS).\n\n"
        "Réponds UNIQUEMENT en JSON strict, sans markdown :\n"
        "{\n"
        '  "id_valid": boolean,\n'
        '  "id_name_matches": boolean,\n'
        '  "kbis_valid": boolean,\n'
        '  "kbis_establishment_matches": boolean,\n'
        '  "approve": boolean,   // true seulement si les 4 critères sont true\n'
        '  "confidence": number, // 0.0 à 1.0\n'
        '  "notes": string       // explication courte en français\n'
        "}\n"
    )


async def verify_claim_documents(
    *,
    owner_name: str,
    club_name: str,
    role: str,
    id_document: str,
    kbis_document: str,
) -> dict:
    """Retourne {approve: bool|None, confidence, notes, checks{...}, fail_open}.

    approve=None → impossible de statuer (infra) → examen manuel.
    """
    started = time.monotonic()
    api_key = os.getenv("EMERGENT_LLM_KEY", "").strip()
    id_b64 = _strip_b64(id_document)
    kbis_b64 = _strip_b64(kbis_document)

    manual = {
        "approve": None,
        "confidence": 0.0,
        "notes": "Vérification automatique indisponible — examen manuel requis.",
        "checks": {},
        "fail_open": True,
        "latency_ms": 0,
    }
    if not api_key or not id_b64 or not kbis_b64:
        return manual

    try:
        from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
    except Exception as exc:  # noqa: BLE001
        logger.warning("verify_claim: emergentintegrations indisponible (%s)", exc)
        return manual

    try:
        chat = LlmChat(
            api_key=api_key,
            session_id=f"claim-{uuid.uuid4().hex[:10]}",
            system_message="Tu es un vérificateur KYC qui répond uniquement en JSON strict.",
        ).with_model("gemini", "gemini-3-flash-preview")

        msg = UserMessage(
            text=_prompt(owner_name, club_name, role),
            file_contents=[
                ImageContent(image_base64=id_b64),
                ImageContent(image_base64=kbis_b64),
            ],
        )
        reply = await chat.send_message(msg)
        data = _decode_json(str(reply))
        if not data:
            logger.warning("verify_claim: réponse LLM non parsable: %.200s", reply)
            return manual

        checks = {
            "id_valid": bool(data.get("id_valid")),
            "id_name_matches": bool(data.get("id_name_matches")),
            "kbis_valid": bool(data.get("kbis_valid")),
            "kbis_establishment_matches": bool(data.get("kbis_establishment_matches")),
        }
        approve = bool(data.get("approve")) and all(checks.values())
        return {
            "approve": approve,
            "confidence": float(data.get("confidence") or 0.0),
            "notes": str(data.get("notes") or ""),
            "checks": checks,
            "fail_open": False,
            "latency_ms": int((time.monotonic() - started) * 1000),
        }
    except Exception as exc:  # noqa: BLE001
        logger.error("verify_claim: échec LLM (%s)", exc)
        return manual
