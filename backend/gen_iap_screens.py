"""Génère les captures d'écran App Store pour les 2 achats intégrés."""
import asyncio
import os

from playwright.async_api import async_playwright

BASE = "https://fan-culture-app.preview.emergentagent.com"
OUT = "/app/backend/iap_screens"


async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        ctx = await browser.new_context(
            viewport={"width": 430, "height": 932},
            device_scale_factor=3,
            is_mobile=True,
        )
        page = await ctx.new_page()
        # Login
        await page.goto(f"{BASE}/login", wait_until="networkidle")
        await page.wait_for_selector("input", timeout=30000)
        inputs = await page.query_selector_all("input")
        await inputs[0].fill("emma.demo@nightfinder.app")
        await inputs[1].fill("DemoOnly2026!")
        await page.get_by_text("Sign in", exact=True).first.click(force=True)
        await page.wait_for_timeout(6000)

        # Capture 1 — promo 7 jours (bouton Payer 19,99 €)
        await page.goto(f"{BASE}/promote-bar", wait_until="networkidle")
        await page.wait_for_selector("text=49,99", timeout=20000)
        await page.wait_for_timeout(2500)
        await page.screenshot(path=f"{OUT}/promobar30d.png")
        print("promobar30d.png OK")

        # Bascule la promo en 30 jours côté DB (fait par le shell entre les deux runs)

        await browser.close()


asyncio.run(main())
