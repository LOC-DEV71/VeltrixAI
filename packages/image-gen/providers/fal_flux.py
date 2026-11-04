"""FLUX via fal.ai (cloud, only when FAL_KEY is set).

Adapted from OpenMontage tools/graphics/flux_image.py (AGPL-3.0, https://github.com/calesthio/OpenMontage):
same key lookup (FAL_KEY / FAL_AI_API_KEY), payload shape, fal.run endpoint and image download.
Added here: https-only download from fal's media hosts, size cap.
"""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

MAX_BYTES = 20 * 1024 * 1024


def api_key() -> str | None:
    return os.environ.get("FAL_KEY") or os.environ.get("FAL_AI_API_KEY")


class FalFlux:
    def __init__(self, preset: dict[str, Any]):
        self.preset = preset

    def load(self) -> float:
        if not api_key():
            raise RuntimeError("FAL_KEY_MISSING")
        return 0.0

    def generate(self, prompt: str, negative: str, seed: int, output_path: Path, cancelled=lambda: False, on_step=None) -> float:
        import requests

        start = time.time()
        p = self.preset
        payload: dict[str, Any] = {
            "prompt": prompt,
            "image_size": {"width": p["width"], "height": p["height"]},
            "seed": int(seed),
            "num_inference_steps": p.get("steps", 4),
            "enable_safety_checker": True,
        }
        response = requests.post(
            f"https://fal.run/fal-ai/{p['model']}",
            headers={"Authorization": f"Key {api_key()}", "Content-Type": "application/json"},
            json=payload, timeout=120,
        )
        response.raise_for_status()
        url = response.json()["images"][0]["url"]
        host = urlparse(url).hostname or ""
        if urlparse(url).scheme != "https" or not (host == "fal.media" or host.endswith(".fal.media")):
            raise RuntimeError("FAL_HOST_NOT_ALLOWED")
        image = requests.get(url, timeout=60)
        image.raise_for_status()
        if len(image.content) > MAX_BYTES:
            raise RuntimeError("FAL_IMAGE_TOO_LARGE")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(image.content)
        return time.time() - start

    def unload(self) -> None:
        pass
