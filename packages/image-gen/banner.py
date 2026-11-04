"""Burns the thumbnail hook onto the generated cover as a banner.

Diffusion models cannot spell (least of all Vietnamese with diacritics), so the prompt asks for
empty space at the top and the text is drawn here with Be Vietnam Pro instead.
"""
from __future__ import annotations

import unicodedata
from pathlib import Path

FONT = Path(__file__).resolve().parent.parent / "video-renderer" / "public" / "fonts" / "BeVietnamPro-ExtraBold.ttf"
TEXT = (255, 255, 255)
# Banner fill and edge/last-word color per video theme (packages/video-renderer/src/theme.ts).
PALETTES = {
    "cosmic": ((124, 58, 237), (250, 204, 21)),
    "documentary": ((122, 78, 36), (233, 196, 106)),
    "finance": ((6, 20, 43), (242, 183, 5)),
    "tech": ((0, 0, 0), (0, 229, 255)),
    "nature": ((22, 101, 52), (255, 179, 71)),
    "pop": ((17, 17, 17), (255, 225, 77)),
}


def _font(size: int):
    from PIL import ImageFont
    try:
        return ImageFont.truetype(str(FONT), size)
    except OSError:
        return ImageFont.load_default(size=size)


def _wrap(draw, words: list[str], font, max_width: int) -> list[list[str]]:
    lines: list[list[str]] = [[]]
    for word in words:
        trial = " ".join(lines[-1] + [word])
        if lines[-1] and draw.textlength(trial, font=font) > max_width:
            lines.append([word])
        else:
            lines[-1].append(word)
    return lines


def add_hook_banner(src: Path, dst: Path, hook: str, theme: str | None = None) -> None:
    BANNER, ACCENT = PALETTES.get(theme or "cosmic", PALETTES["cosmic"])
    from PIL import Image, ImageDraw, ImageFilter
    text = unicodedata.normalize("NFC", " ".join(hook.split())).upper()
    with Image.open(src) as base:
        im = base.convert("RGB")
    w, h = im.size
    words = text.split()
    if not words:
        im.save(dst, format="PNG")
        return

    # Darken the top so the banner reads on any picture.
    shade = Image.new("L", (1, h))
    for y in range(h):
        shade.putpixel((0, y), int(150 * max(0.0, 1 - y / (h * 0.42))))
    im.paste(Image.new("RGB", (w, h), (8, 6, 20)), (0, 0), shade.resize((w, h)))

    draw = ImageDraw.Draw(im)
    pad_x, max_width = int(w * 0.07), int(w * 0.80)
    # Largest size that fits in at most 3 lines.
    size = int(w * 0.13)
    while size > int(w * 0.05):
        font = _font(size)
        lines = _wrap(draw, words, font, max_width - 2 * pad_x)
        if len(lines) <= 3 and all(draw.textlength(" ".join(l), font=font) <= max_width - 2 * pad_x for l in lines):
            break
        size -= 4
    font = _font(size)
    lines = _wrap(draw, words, font, max_width - 2 * pad_x)
    line_h = int(size * 1.22)
    box_w = max(int(draw.textlength(" ".join(l), font=font)) for l in lines) + 2 * pad_x
    box_h = line_h * len(lines) + int(size * 0.7)
    x0, y0 = (w - box_w) // 2, int(h * 0.09)

    # Soft drop shadow, then a tilted-feel banner (rounded, with a yellow edge).
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x0 + 10, y0 + 14, x0 + box_w + 10, y0 + box_h + 14), radius=int(size * 0.35), fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    im = Image.alpha_composite(im.convert("RGBA"), shadow).convert("RGB")
    draw = ImageDraw.Draw(im)
    draw.rounded_rectangle((x0, y0, x0 + box_w, y0 + box_h), radius=int(size * 0.35), fill=BANNER, outline=ACCENT, width=max(4, size // 14))

    last_line, last_word = len(lines) - 1, len(lines[-1]) - 1
    y = y0 + int(size * 0.3)
    stroke = max(2, size // 18)
    for li, line in enumerate(lines):
        line_w = draw.textlength(" ".join(line), font=font)
        x = (w - line_w) / 2
        for wi, word in enumerate(line):
            color = ACCENT if (li, wi) == (last_line, last_word) and len(words) > 1 else TEXT
            draw.text((x, y), word, font=font, fill=color, stroke_width=stroke, stroke_fill=(30, 10, 60))
            x += draw.textlength(word + " ", font=font)
        y += line_h
    im.save(dst, format="PNG", optimize=False)
