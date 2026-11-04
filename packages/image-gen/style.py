"""Prompt assembly: the scene's own imagePrompt + the theme's style suffix + one shared negative prompt.

The scene prompt is used as written (never rewritten by an LLM). Only the theme suffix is appended.
"""
from __future__ import annotations

import re

# Shared negative prompt: on-image text fights the video's own titles and captions.
NEGATIVE = (
    "text, letters, words, caption, watermark, logo, signature, subtitles, frame, border, "
    "lowres, blurry, jpeg artifacts, noisy, deformed, disfigured, bad anatomy, extra fingers, "
    "extra limbs, duplicate, cropped head, oversaturated, ugly"
)

THEMES: dict[str, dict[str, str]] = {
    # One per video theme (packages/video-renderer/src/theme.ts). Kept short: SD/SDXL text encoders read
    # only 77 tokens, and the scene prompt comes first.
    "cosmic": {
        "suffix": "cinematic lighting, deep navy and violet palette, cyan rim light, high contrast, atmospheric, highly detailed",
        "negative": "flat lighting, washed out, pastel, white background",
    },
    "documentary": {
        "suffix": "archival photograph, sepia and warm brown tones, film grain, aged paper texture, museum lighting, historical realism",
        "negative": "neon, futuristic, cyberpunk, purple, glossy 3d render, cartoon",
    },
    "finance": {
        "suffix": "editorial photography, navy blue and gold palette, city skyline at night, clean corporate lighting, sharp focus",
        "negative": "fantasy, cartoon, purple nebula, grunge, sepia",
    },
    "tech": {
        "suffix": "futuristic tech aesthetic, black background, neon cyan and lime accents, circuit details, holographic UI, crisp",
        "negative": "vintage, sepia, organic, painterly, warm tones, nebula",
    },
    "nature": {
        "suffix": "nature documentary photography, lush greens, soft golden sunlight, natural colors, shallow depth of field",
        "negative": "neon, cyberpunk, purple, artificial lighting, cartoon, sepia",
    },
    "pop": {
        "suffix": "bright vivid colors, playful pop art, coral and yellow palette, bold shapes, cheerful studio lighting",
        "negative": "dark, gloomy, horror, desaturated, sepia, nebula",
    },
}
# Runs before themes existed stored "veltrix", which is the cosmic look.
THEMES["veltrix"] = THEMES["cosmic"]
DEFAULT_THEME = "cosmic"


def build_prompt(image_prompt: str, theme: str | None) -> tuple[str, str]:
    """Returns (prompt, negative). Unknown themes use the default theme."""
    style = THEMES.get(theme or DEFAULT_THEME, THEMES[DEFAULT_THEME])
    # Drop Midjourney-style flags such as "--ar 9:16" that some scripts include.
    base = re.sub(r"--[a-z]+(\s+[^\s-]\S*)?", " ", str(image_prompt), flags=re.I)
    base = " ".join(base.split()).strip().rstrip(",.")
    prompt = f"{base}, {style['suffix']}" if base else style["suffix"]
    negative = f"{NEGATIVE}, {style['negative']}" if style.get("negative") else NEGATIVE
    return prompt, negative
