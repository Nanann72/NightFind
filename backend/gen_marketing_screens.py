"""Génère des previews App Store MARKETING (1284×2778) :
fond dégradé Night Finder + titre + sous-titre + mockup iPhone avec la capture.

Usage : python3 gen_marketing_screens.py
Sortie : /app/backend/appstore_marketing/*.png
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1284, 2778
SRC = "/app/backend/appstore_screens"
OUT = "/app/backend/appstore_marketing"
FONT = "/app/backend/fonts/Inter.ttf"

VIOLET = (139, 92, 246)
BG_TOP = (16, 12, 30)
BG_BOTTOM = (8, 7, 16)
TEXT = (255, 255, 255)
SUB = (186, 178, 208)

SCREENS = [
    ("01-accueil.png", "Toute la nuit,\ndans ta poche.", "Clubs, bars et soirées autour de toi,\nen temps réel."),
    ("02-carte.png", "15 000+ bars\net clubs en France.", "Repère les meilleurs spots\nautour de toi sur la carte."),
    ("03-swipe.png", "Rencontre ceux\nqui sortent ce soir.", "Matche avec des noctambules\nprès de chez toi."),
    ("04-events.png", "Les meilleures\nsoirées à venir.", "DJ sets, lives et événements\nexclusifs près de toi."),
    ("05-chats.png", "Organise ta soirée\nen groupe.", "Discute avec tes matchs\net retrouve-les en club."),
    ("06-club.png", "Chaque club,\nen détail.", "Photos, horaires, ambiance,\nitinéraire en un tap."),
]


def font(size: int, weight: int = 800):
    f = ImageFont.truetype(FONT, size)
    try:
        f.set_variation_by_axes([14, weight])
    except Exception:
        pass
    return f


def make_background() -> Image.Image:
    bg = Image.new("RGB", (W, H))
    px = bg.load()
    for y in range(H):
        t = y / H
        px_row = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
        for x in range(W):
            px[x, y] = px_row
    # halo violet en haut
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W // 2 - 900, -700, W // 2 + 900, 500], fill=(70, 40, 140))
    glow = glow.filter(ImageFilter.GaussianBlur(220))
    bg = Image.blend(bg, Image.composite(glow, bg, glow.convert("L").point(lambda v: min(255, v * 2))), 0.55)
    return bg


def rounded(img: Image.Image, rad: int) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.width, img.height], rad, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def compose(shot_name: str, title: str, subtitle: str, idx: int):
    canvas = make_background()
    d = ImageDraw.Draw(canvas)

    # marque
    brand_f = font(44, 800)
    brand = "●  NIGHT FINDER"
    bw = d.textbbox((0, 0), brand, font=brand_f)[2]
    d.text(((W - bw) // 2, 150), brand, font=brand_f, fill=(168, 148, 255))

    # titre
    title_f = font(118, 800)
    y = 280
    for line in title.split("\n"):
        lw = d.textbbox((0, 0), line, font=title_f)[2]
        d.text(((W - lw) // 2, y), line, font=title_f, fill=TEXT)
        y += 138

    # sous-titre
    sub_f = font(52, 500)
    y += 30
    for line in subtitle.split("\n"):
        lw = d.textbbox((0, 0), line, font=sub_f)[2]
        d.text(((W - lw) // 2, y), line, font=sub_f, fill=SUB)
        y += 68

    # mockup iPhone (capture arrondie + bezel), coupé en bas comme l'exemple
    shot = Image.open(os.path.join(SRC, shot_name)).convert("RGB")
    phone_w = 1010
    scale = phone_w / shot.width
    shot = shot.resize((phone_w, int(shot.height * scale)), Image.LANCZOS)
    shot_r = rounded(shot, 92)

    bezel_pad = 26
    bezel_w, bezel_h = phone_w + bezel_pad * 2, shot.height + bezel_pad * 2
    bezel = Image.new("RGBA", (bezel_w, bezel_h), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bezel)
    bd.rounded_rectangle([0, 0, bezel_w - 1, bezel_h - 1], 92 + bezel_pad, fill=(24, 20, 36, 255), outline=(90, 76, 140, 255), width=4)
    bezel.paste(shot_r, (bezel_pad, bezel_pad), shot_r)

    # ombre douce
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    px_x = (W - bezel_w) // 2
    px_y = y + 90
    sd.rounded_rectangle([px_x - 20, px_y + 30, px_x + bezel_w + 20, min(H, px_y + bezel_h) + 30], 120, fill=(0, 0, 0, 190))
    shadow = shadow.filter(ImageFilter.GaussianBlur(60))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow)
    canvas.paste(bezel, (px_x, px_y), bezel)

    canvas = canvas.convert("RGB")
    assert canvas.size == (W, H)
    name = f"promo-{idx:02d}.png"
    canvas.save(os.path.join(OUT, name))
    print(name, "OK", canvas.size)


os.makedirs(OUT, exist_ok=True)
for i, (shot, title, sub) in enumerate(SCREENS, 1):
    compose(shot, title, sub, i)
print("Terminé.")
