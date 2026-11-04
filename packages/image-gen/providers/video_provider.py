"""Image-to-video provider interface (reserved, DISABLED).

This machine cannot run image-to-video locally, so backgrounds are still images moved by a camera
(see packages/video-renderer/src/camera.ts, driven by each scene's videoPrompt). When a cloud
provider is wanted later (e.g. FAL Kling or Veo), implement `animate()` here and set
IMAGE_TO_VIDEO_ENABLED=1. Nothing calls this yet.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol


class VideoProvider(Protocol):
    name: str

    def available(self) -> bool: ...

    def animate(self, image: Path, video_prompt: str, seconds: float, seed: int, output: Path) -> Path:
        """Turns one still into a short clip that follows `video_prompt`. Returns the mp4 path."""
        ...


class DisabledVideoProvider:
    name = "disabled"

    def available(self) -> bool:
        return False

    def animate(self, image: Path, video_prompt: str, seconds: float, seed: int, output: Path) -> Path:
        raise RuntimeError("IMAGE_TO_VIDEO_DISABLED")


def get_video_provider() -> VideoProvider:
    # Reserved switch. Only the disabled provider exists today.
    if os.environ.get("IMAGE_TO_VIDEO_ENABLED") == "1":
        raise RuntimeError("IMAGE_TO_VIDEO_NOT_IMPLEMENTED")
    return DisabledVideoProvider()
