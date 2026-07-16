"""Génère les captures d'écran App Store (previews) aux dimensions Apple.

iPhone 6,9" : 1290 × 2796 px  →  viewport 430×932 @3x
Compatible avec les slots 6,9" et 6,7" d'App Store Connect.
"""
import asyncio
import os

from playwright.async_api import async_playwright

BASE = "https://fan-culture-app.preview.emergentagent.com"
OUT = "/app/backend/appstore_screens"

# (nom_fichier, route, sélecteur/texte à attendre, délai supplémentaire ms)
SCREENS = [
    ("01-accueil.png", "/", None, 5000),
    ("02-carte.png", "/map", None, 7000),
    ("03-swipe.png", "/swipe", None, 5000),
    ("04-events.png", "/events", None, 5000),
    ("05-chats.png", "/chats", None, 4000),
    ("06-club.png", "/club/club_4472d64798", None, 6000),
]

HIDE_WEB_TEXT = """
(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (n.textContent.includes("plein écran s'affiche sur mobile")) {
      n.textContent = "Découvre l'activité autour de toi ce soir";
    }
  }
})()
"""


async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        ctx = await browser.new_context(
            viewport={"width": 430, "height": 932},
            device_scale_factor=3,
            is_mobile=True,
            has_touch=True,
        )
        await ctx.add_init_script("try { localStorage.setItem('nf_lang', 'fr'); } catch (e) {}")
        page = await ctx.new_page()
        # Login
        await page.goto(f"{BASE}/login", wait_until="networkidle")
        await page.wait_for_selector("input", timeout=30000)
        inputs = await page.query_selector_all("input")
        await inputs[0].fill("emma.demo@nightfinder.app")
        await inputs[1].fill("DemoOnly2026!")
        for label in ("Se connecter", "Sign in"):
            btn = page.get_by_text(label, exact=True)
            if await btn.count():
                await btn.first.click(force=True)
                break
        await page.wait_for_timeout(7000)

        for name, route, selector, extra in SCREENS:
            try:
                await page.goto(f"{BASE}{route}", wait_until="networkidle")
                if selector:
                    await page.wait_for_selector(selector, timeout=15000)
                await page.wait_for_timeout(extra)
                await page.evaluate(HIDE_WEB_TEXT)
                await page.screenshot(path=f"{OUT}/{name}")
                print(f"{name} OK")
            except Exception as e:
                print(f"{name} ERREUR: {e}")

        await browser.close()


asyncio.run(main())
