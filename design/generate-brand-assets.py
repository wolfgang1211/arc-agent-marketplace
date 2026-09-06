from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "web" / "app"
BRAND = ROOT / "web" / "public" / "brand"
MARK_PATH = BRAND / "alphaboard-agents-mark.png"
ARC_BLUE = (172, 198, 233, 255)
BACKGROUND = (12, 13, 15, 255)
TEXT = (242, 243, 245, 255)
MUTED = (159, 165, 173, 255)
BORDER = (42, 44, 48, 255)
FONT_DIR = Path("C:/Windows/Fonts")


def contain(image, size):
    copy = image.copy()
    copy.thumbnail(size, Image.Resampling.LANCZOS)
    return copy


def icon_canvas(size, padding_ratio=0.17):
    canvas = Image.new("RGBA", (size, size), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    radius = max(3, round(size * 0.19))
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=BACKGROUND, outline=BORDER, width=max(1, size // 128))
    mark = contain(Image.open(MARK_PATH).convert("RGBA"), (round(size * (1 - 2 * padding_ratio)),) * 2)
    canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return canvas


def draw_spaced(draw, xy, text, font, fill, spacing):
    x, y = xy
    for char in text:
        draw.text((x, y), char, font=font, fill=fill)
        box = draw.textbbox((x, y), char, font=font)
        x += box[2] - box[0] + spacing


def generate():
    APP.mkdir(parents=True, exist_ok=True)
    mark = Image.open(MARK_PATH).convert("RGBA")
    visible_colors = {pixel[:3] for pixel in mark.get_flattened_data() if pixel[3] > 0}
    assert visible_colors == {ARC_BLUE[:3]}, visible_colors

    icon_canvas(512).save(APP / "icon.png", optimize=True)
    icon_canvas(180).save(APP / "apple-icon.png", optimize=True)
    icon_canvas(256).save(APP / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    width, height = 1200, 630
    canvas = Image.new("RGBA", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    hero_mark = contain(mark, (205, 205))
    canvas.alpha_composite(hero_mark, (94, (height - hero_mark.height) // 2))

    bold = ImageFont.truetype(str(FONT_DIR / "segoeuib.ttf"), 78)
    regular = ImageFont.truetype(str(FONT_DIR / "segoeui.ttf"), 78)
    body = ImageFont.truetype(str(FONT_DIR / "segoeui.ttf"), 29)
    descriptor = ImageFont.truetype(str(FONT_DIR / "segoeuib.ttf"), 19)
    pill = ImageFont.truetype(str(FONT_DIR / "segoeuib.ttf"), 14)

    x = 340
    y = 198
    draw.text((x, y), "Alpha", font=bold, fill=TEXT)
    alpha_box = draw.textbbox((x, y), "Alpha", font=bold)
    board_x = alpha_box[2] - 2
    draw.text((board_x, y), "Board", font=regular, fill=(229, 231, 235, 255))
    draw_spaced(draw, (x + 3, 299), "AUTONOMOUS AGENTS", descriptor, (176, 181, 189, 255), 5)
    draw.text((x, 353), "Hire autonomous agents with on-chain escrow.", font=body, fill=(201, 204, 210, 255))

    pill_box = (x, 421, x + 150, 464)
    draw.rounded_rectangle(pill_box, radius=8, outline=(172, 198, 233, 180), width=1)
    draw.text((x + 16, 433), "BUILT ON ARC", font=pill, fill=ARC_BLUE)

    canvas.convert("RGB").save(APP / "opengraph-image.png", optimize=True)
    canvas.convert("RGB").save(APP / "twitter-image.png", optimize=True)


if __name__ == "__main__":
    generate()
    for name in ["icon.png", "apple-icon.png", "favicon.ico", "opengraph-image.png", "twitter-image.png"]:
        image = Image.open(APP / name)
        print(f"{name}: {image.size} {image.mode}")
