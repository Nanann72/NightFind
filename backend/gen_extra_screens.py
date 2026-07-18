"""Capture 6 écrans candidats supplémentaires (1284×2778) pour previews marketing."""
import asyncio
import os

from playwright.async_api import async_playwright

BASE = "https://fan-culture-app.preview.emergentagent.com"
OUT = "/app/backend/appstore_screens"

SCREENS = [
    
    
    
    ("10-favorites.png", "/favorites", 5000),
    
    
]


async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        ctx = await browser.new_context(
            viewport={"width": 428, "height": 926},
            device_scale_factor=3,
            is_mobile=True,
            has_touch=True,
        )
        await ctx.add_init_script("try { localStorage.setItem('nf_lang', 'fr'); } catch (e) {}")
        page = await ctx.new_page()
        await page.goto(f"{BASE}/login", wait_until="domcontentloaded", timeout=120000)
        await page.wait_for_selector("input", timeout=90000)
        inputs = await page.query_selector_all("input")
        await inputs[0].fill("emma.demo@nightfinder.app")
        await inputs[1].fill("DemoOnly2026!")
        for label in ("Se connecter", "Sign in"):
            btn = page.get_by_text(label, exact=True)
            if await btn.count():
                await btn.first.click(force=True)
                break
        await page.wait_for_timeout(7000)

        for name, route, extra in SCREENS:
            try:
                await page.goto(f"{BASE}{route}", wait_until="domcontentloaded", timeout=60000)
                await page.wait_for_timeout(extra)
                await page.screenshot(path=f"{OUT}/{name}")
                print(name, "OK")
            except Exception as e:
                print(name, "ERREUR:", e)

        await browser.close()


asyncio.run(main())
