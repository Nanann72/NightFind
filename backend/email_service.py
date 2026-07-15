"""Night Finder — Resend email service.

Handles transactional emails: password reset (OTP + magic link).
All send calls are async-safe (Resend SDK is sync — we run in thread pool).
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Literal

import resend
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

resend.api_key = os.environ.get("RESEND_API_KEY", "")
FROM_EMAIL = os.environ.get("RESEND_FROM_EMAIL", "onboarding@resend.dev")
FROM_NAME = os.environ.get("RESEND_FROM_NAME", "Night Finder")
APP_PUBLIC_URL = os.environ.get("APP_PUBLIC_URL", "https://nightfinder.app")
APP_SCHEME = os.environ.get("APP_SCHEME", "nightfinder")

FROM_ADDRESS = f"{FROM_NAME} <{FROM_EMAIL}>"

# -------------------- HTML templates -------------------- #

_BASE_STYLE = """
  body { margin:0; padding:0; background:#0A0A0F; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif; color:#FFFFFF; }
  .wrap { max-width:520px; margin:0 auto; padding:40px 24px; }
  .card { background:linear-gradient(180deg,#141420 0%,#0E0E18 100%); border:1px solid rgba(255,255,255,0.08); border-radius:20px; padding:32px; }
  .logo { font-size:22px; font-weight:900; letter-spacing:2px; color:#FF2E63; margin-bottom:8px; }
  .tagline { font-size:12px; color:#8A8A9E; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:28px; }
  .title { font-size:26px; font-weight:800; color:#FFFFFF; margin:0 0 12px; letter-spacing:-0.5px; }
  .sub { font-size:15px; line-height:22px; color:#B6B6C8; margin:0 0 24px; }
  .otp { font-size:38px; font-weight:900; letter-spacing:14px; color:#FF2E63; background:rgba(255,46,99,0.08); border:1px solid rgba(255,46,99,0.25); border-radius:14px; padding:20px; text-align:center; margin:0 0 24px; font-variant-numeric: tabular-nums; }
  .btn { display:inline-block; background:#FF2E63; color:#FFFFFF !important; padding:14px 28px; border-radius:999px; font-weight:800; font-size:15px; text-decoration:none; }
  .foot { margin-top:32px; padding-top:20px; border-top:1px solid rgba(255,255,255,0.06); font-size:12px; color:#6B6B7C; line-height:18px; }
"""


def _wrap_email(inner_html: str) -> str:
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>{_BASE_STYLE}</style></head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="logo">NIGHT FINDER</div>
      <div class="tagline">Discover the night · Live it fully</div>
      {inner_html}
      <div class="foot">
        Vous n'êtes pas à l'origine de cette demande&nbsp;? Ignorez simplement cet email — votre compte reste sécurisé.<br/>
        © Night Finder · Paris
      </div>
    </div>
  </div>
</body></html>"""


def _otp_body(code: str, minutes: int = 30) -> str:
    return _wrap_email(f"""
      <h1 class="title">Votre code de réinitialisation</h1>
      <p class="sub">Entrez ce code à 6 chiffres dans l'application Night Finder pour choisir un nouveau mot de passe. Il expire dans {minutes} minutes.</p>
      <div class="otp">{code}</div>
      <p class="sub" style="margin:0;">Si vous n'avez rien demandé, aucune action n'est nécessaire.</p>
    """)


def _link_body(link: str, minutes: int = 30) -> str:
    return _wrap_email(f"""
      <h1 class="title">Réinitialiser votre mot de passe</h1>
      <p class="sub">Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe. Ce lien expire dans {minutes} minutes.</p>
      <p style="text-align:center; margin:0 0 24px;"><a href="{link}" class="btn">Choisir un nouveau mot de passe</a></p>
      <p class="sub" style="font-size:12px; word-break:break-all;">Si le bouton ne fonctionne pas, copiez ce lien&nbsp;:<br/><span style="color:#8A8A9E;">{link}</span></p>
    """)


# -------------------- Send helpers -------------------- #


async def _send_async(params: dict) -> bool:
    """Run the blocking resend SDK call in a thread pool."""
    if not resend.api_key:
        logger.warning("RESEND_API_KEY not configured — email skipped.")
        return False
    try:
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: resend.Emails.send(params))
        logger.info(f"Resend email sent id={response.get('id') if isinstance(response, dict) else response}")
        return True
    except Exception as exc:
        logger.error(f"Resend send failure: {exc}")
        return False


async def send_password_reset_otp(email: str, code: str, minutes: int = 30) -> bool:
    """Send a 6-digit reset code."""
    params = {
        "from": FROM_ADDRESS,
        "to": [email],
        "subject": f"Night Finder — Code de réinitialisation : {code}",
        "html": _otp_body(code, minutes),
    }
    return await _send_async(params)


async def send_password_reset_link(email: str, token: str, minutes: int = 30) -> bool:
    """Send a magic reset link that deep-links back into the app."""
    # Universal link (opens app if installed, falls back to web)
    link = f"{APP_PUBLIC_URL}/reset?token={token}"
    params = {
        "from": FROM_ADDRESS,
        "to": [email],
        "subject": "Night Finder — Réinitialisation de votre mot de passe",
        "html": _link_body(link, minutes),
    }
    return await _send_async(params)


async def send_password_reset(
    email: str,
    *,
    mode: Literal["otp", "link"],
    code_or_token: str,
    minutes: int = 30,
) -> bool:
    if mode == "otp":
        return await send_password_reset_otp(email, code_or_token, minutes)
    return await send_password_reset_link(email, code_or_token, minutes)


# -------------------- Bar claims (Bar Vérifié) -------------------- #


async def send_claim_received(email: str, owner_name: str, club_name: str) -> bool:
    """Email 1 — demande de revendication reçue."""
    html = _wrap_email(f"""
      <h1 class="title">Demande bien reçue ✅</h1>
      <p class="sub">Bonjour {owner_name},<br/><br/>
      Nous avons bien reçu ta demande de revendication pour <strong style="color:#fff;">{club_name}</strong>.</p>
      <p class="sub"><strong style="color:#fff;">Documents reçus :</strong><br/>
      • Pièce d'identité ✅<br/>
      • Extrait Kbis ✅</p>
      <p class="sub"><strong style="color:#fff;">Délai de validation :</strong><br/>
      Notre robot de vérification analyse tes documents <strong style="color:#fff;">en quelques minutes</strong>.
      Si un examen manuel est nécessaire, la validation prend au maximum <strong style="color:#fff;">24&nbsp;heures</strong>.</p>
      <p class="sub" style="margin:0;">Tu recevras un email dès que ton établissement sera vérifié, avec ton code -10% et ton QR code à afficher dans ton bar. 🎉</p>
    """)
    return await _send_async({
        "from": FROM_ADDRESS,
        "to": [email],
        "subject": f"Night Finder — Demande reçue pour {club_name}",
        "html": html,
    })


async def send_claim_approved(
    email: str,
    owner_name: str,
    club_name: str,
    partner_code: str,
    qr_url: str,
    landing_url: str,
) -> bool:
    """Email 2 — établissement vérifié + code -10% + QR code."""
    html = _wrap_email(f"""
      <h1 class="title">🎉 {club_name} est Vérifié !</h1>
      <p class="sub">Félicitations {owner_name}, ta demande a été approuvée.
      Ton établissement porte désormais le badge <strong style="color:#1D9BF0;">Vérifié ✓</strong>
      et tu as accès au tableau de bord propriétaire dans l'app (Réglages → Mon établissement).</p>
      <p class="sub"><strong style="color:#fff;">Ton code -10% pour tes invités :</strong></p>
      <div class="otp" style="letter-spacing:6px;">{partner_code}</div>
      <p class="sub">Toute personne qui s'inscrit sur Night Finder avec ce code (ou en scannant ton QR code)
      reçoit un coupon <strong style="color:#fff;">-10%</strong> à utiliser dans ton bar.
      Tu valides les coupons depuis ton tableau de bord.</p>
      <p style="text-align:center; margin:0 0 24px;">
        <img src="{qr_url}" alt="QR code -10%" width="220" height="220" style="border-radius:16px; background:#fff; padding:12px;"/>
      </p>
      <p style="text-align:center; margin:0 0 24px;"><a href="{qr_url}" class="btn">Télécharger mon QR code</a></p>
      <p class="sub" style="font-size:12px; word-break:break-all;">Lien de parrainage à partager&nbsp;:<br/><span style="color:#8A8A9E;">{landing_url}</span></p>
    """)
    return await _send_async({
        "from": FROM_ADDRESS,
        "to": [email],
        "subject": f"Night Finder — {club_name} est Vérifié ✓ (ton code -10% inclus)",
        "html": html,
    })


async def send_claim_rejected(email: str, owner_name: str, club_name: str, reason: str) -> bool:
    """Email 3 — demande refusée avec motif."""
    html = _wrap_email(f"""
      <h1 class="title">Demande non validée</h1>
      <p class="sub">Bonjour {owner_name},<br/><br/>
      Ta demande de revendication pour <strong style="color:#fff;">{club_name}</strong> n'a pas pu être validée.</p>
      <p class="sub"><strong style="color:#fff;">Motif :</strong> {reason}</p>
      <p class="sub" style="margin:0;">Tu peux soumettre une nouvelle demande depuis l'app
      (Réglages → Revendiquer mon établissement) avec des documents corrigés.</p>
    """)
    return await _send_async({
        "from": FROM_ADDRESS,
        "to": [email],
        "subject": f"Night Finder — Demande pour {club_name} non validée",
        "html": html,
    })
