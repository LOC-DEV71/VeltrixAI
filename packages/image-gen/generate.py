"""Image generation worker. One process per job: it loads one model, makes N images, then exits,
which frees all VRAM (the "unload" step of the video pipeline).

  python generate.py run <job.json>      generate images, one EVENT line per step
  python generate.py status              which presets are installed / available
  python generate.py download <preset>   fetch a preset's weights with progress events

Job: { "preset": "balanced", "theme": "veltrix", "cacheDir": "...", "allowFallback": true,
       "items": [{ "id": "scene-1", "imagePrompt": "...", "seed": 1234 }] }
Events (stdout, one per line): EVENT {"type": "...", ...}
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

from style import build_prompt  # noqa: E402

CONFIG = json.loads((ROOT / "presets.json").read_text(encoding="utf-8"))
PRESETS = {p["id"]: p for p in CONFIG["presets"]}
OUTPUT = CONFIG["output"]


def emit(kind: str, **data: Any) -> None:
    sys.stdout.write("EVENT " + json.dumps({"type": kind, **data}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


# ---- memory sampling (peak VRAM on the device, peak RAM of this process) ----
class MemoryMonitor:
    def __init__(self) -> None:
        self.peak_vram = 0
        self.peak_ram = 0
        self.min_free_ram = None
        self.cuda_ready = threading.Event()  # set by the main thread after the model is loaded
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        import psutil
        process = psutil.Process()
        while not self._stop.is_set():
            try:
                self.peak_ram = max(self.peak_ram, process.memory_info().rss)
                free = psutil.virtual_memory().available
                self.min_free_ram = free if self.min_free_ram is None else min(self.min_free_ram, free)
                # Never import torch here: importing it from this thread while the main thread loads
                # CUDA DLLs deadlocked on Windows. Sample VRAM only once the model is on the GPU.
                torch = sys.modules.get("torch")
                if torch is not None and self.cuda_ready.is_set():
                    free_vram, total_vram = torch.cuda.mem_get_info()
                    self.peak_vram = max(self.peak_vram, total_vram - free_vram)
            except Exception:
                pass
            self._stop.wait(0.2)

    def start(self) -> "MemoryMonitor":
        self._thread.start()
        return self

    def stop(self) -> dict[str, int]:
        self._stop.set()
        self._thread.join(timeout=1)
        mb = lambda b: int(round((b or 0) / 1048576))
        return {"peakVramMB": mb(self.peak_vram), "peakRamMB": mb(self.peak_ram), "minFreeRamMB": mb(self.min_free_ram)}


# ---- model cache inspection (Hugging Face hub cache) ----
def hub_dir() -> Path:
    home = os.environ.get("HF_HOME") or str(Path.home() / ".cache" / "huggingface")
    return Path(os.environ.get("HF_HUB_CACHE") or Path(home) / "hub")


def repo_dirs(preset: dict[str, Any]) -> list[Path]:
    repos = [preset["model"]] + ([preset["vae"]] if preset.get("vae") else []) + ([preset["lora"]["repo"]] if preset.get("lora") else [])
    return [hub_dir() / ("models--" + r.replace("/", "--")) for r in repos]


def dir_bytes(path: Path) -> int:
    """Bytes on disk under path. Files appear, grow and get renamed during a download, so the
    walk itself may fail mid-way: never raise, the next sample retries."""
    total = 0
    try:
        for root, _dirs, files in os.walk(path):
            for name in files:
                try:
                    full = os.path.join(root, name)
                    if not os.path.islink(full):
                        total += os.path.getsize(full)
                except OSError:
                    pass
    except OSError:
        pass
    return total


def local_stack() -> dict[str, Any]:
    """Whether torch + diffusers are installed (checked without importing torch, which is slow)."""
    import importlib.util
    missing = [m for m in ("torch", "diffusers", "transformers", "accelerate", "safetensors", "psutil", "PIL") if importlib.util.find_spec(m) is None]
    if "lora" in json.dumps(CONFIG) and importlib.util.find_spec("peft") is None:
        missing.append("peft")
    return {"ready": not missing, "missing": missing}


def preset_status(preset: dict[str, Any]) -> dict[str, Any]:
    if preset["kind"] == "fal":
        from providers.fal_flux import api_key
        return {"id": preset["id"], "available": bool(api_key()), "installed": True, "downloadGB": 0}
    have = sum(dir_bytes(d) for d in repo_dirs(preset)) / 1e9
    installed = all(d.exists() for d in repo_dirs(preset)) and have >= preset["downloadGB"] * 0.85
    return {"id": preset["id"], "available": True, "installed": installed, "downloadGB": preset["downloadGB"], "haveGB": round(have, 2)}


class DownloadWatcher:
    """Reports download progress by watching the hub cache grow while the pipeline loads."""

    def __init__(self, preset: dict[str, Any]) -> None:
        self.preset = preset
        self.start_bytes = sum(dir_bytes(d) for d in repo_dirs(preset))
        self.total = preset["downloadGB"] * 1e9
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        last = -1
        while not self._stop.wait(1.0):
            try:
                have = sum(dir_bytes(d) for d in repo_dirs(self.preset))
            except Exception:  # keep reporting; a failed sample must not end the thread
                continue
            percent = min(99, int(have * 100 / self.total)) if self.total else 0
            if percent != last and have > self.start_bytes:
                last = percent
                emit("download", preset=self.preset["id"], percent=percent, downloadedGB=round(have / 1e9, 2), totalGB=self.preset["downloadGB"])

    def __enter__(self):
        if not preset_status(self.preset)["installed"]:
            emit("download", preset=self.preset["id"], percent=0, downloadedGB=round(self.start_bytes / 1e9, 2), totalGB=self.preset["downloadGB"])
            self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._stop.set()


# ---- generation ----
def make_provider(preset: dict[str, Any]):
    if preset["kind"] == "fal":
        from providers.fal_flux import FalFlux
        return FalFlux(preset)
    from providers.local_diffusion import LocalDiffusion
    return LocalDiffusion(preset)


def cache_key(preset: dict[str, Any], prompt: str, negative: str, seed: int) -> str:
    fields = {k: preset.get(k) for k in ("kind", "model", "variant", "vae", "lora", "steps", "guidance", "scheduler", "width", "height")}
    blob = json.dumps({"preset": fields, "prompt": prompt, "negative": negative, "seed": seed, "out": OUTPUT}, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]


def finish_image(raw: Path, final: Path) -> None:
    """Upscale to the output frame (cover + center crop), Lanczos."""
    from PIL import Image
    with Image.open(raw) as im:
        im = im.convert("RGB")
        w, h = OUTPUT["width"], OUTPUT["height"]
        scale = max(w / im.width, h / im.height)
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
        left, top = (im.width - w) // 2, (im.height - h) // 2
        im.crop((left, top, left + w, top + h)).save(final, format="PNG", optimize=False)


def with_hook(final: Path, item: dict[str, Any], theme: str | None = None) -> Path:
    """Thumbnail items carry a hook: return a copy of the image with it drawn as a banner."""
    hook = str(item.get("hook") or "").strip()
    if not hook:
        return final
    from banner import add_hook_banner
    out = final.with_name(f"{final.stem}.hook-{hashlib.sha256((hook + (theme or '')).encode('utf-8')).hexdigest()[:10]}.png")
    try:
        if not out.exists():
            add_hook_banner(final, out, hook, theme)
        return out
    except Exception as error:  # noqa: BLE001 - a banner problem must not lose the image
        emit("warning", id=item.get("id"), code="THUMBNAIL_BANNER_FAILED", message=str(error)[:300])
        return final


def is_oom(error: BaseException) -> bool:
    text = str(error).lower()
    return type(error).__name__ == "OutOfMemoryError" or "out of memory" in text or "cuda error: out of memory" in text


def lighter(preset_id: str) -> str | None:
    order = CONFIG["fallbackOrder"]
    return order[order.index(preset_id) + 1] if preset_id in order and order.index(preset_id) + 1 < len(order) else None


def run(job: dict[str, Any]) -> int:
    cache = Path(job["cacheDir"]).resolve()
    cache.mkdir(parents=True, exist_ok=True)
    current = job.get("preset") or CONFIG["default"]
    if current not in PRESETS:
        emit("error", code="IMAGE_PRESET_UNKNOWN", preset=current)
        return 2
    stack = local_stack()
    if PRESETS[current]["kind"] == "local" and not stack["ready"]:
        # Not installed yet (or a partial install): say so once per scene instead of a vague failure.
        for item in job["items"]:
            emit("error", id=item["id"], code="IMAGE_GEN_NOT_INSTALLED", preset=current, message="missing: " + ", ".join(stack["missing"]))
        emit("done", failures=len(job["items"]), peakVramMB=0, peakRamMB=0, minFreeRamMB=0)
        return 0
    allow_fallback = job.get("allowFallback", True)
    monitor = MemoryMonitor().start()
    provider = None
    loaded_id = None
    failures = 0
    load_errors: dict[str, str] = {}  # a preset that failed to load is not retried for every scene
    try:
        for item in job["items"]:
            prompt, negative = build_prompt(item["imagePrompt"], job.get("theme"))
            seed = int(item["seed"])
            preset_id, downgraded_from = current, None
            while True:
                preset = PRESETS[preset_id]
                final = cache / f"{cache_key(preset, prompt, negative, seed)}.png"
                if final.exists():
                    emit("image", id=item["id"], path=str(with_hook(final, item, job.get("theme"))), seconds=0, preset=preset_id, cached=True, seed=seed, downgradedFrom=downgraded_from)
                    break
                if preset_id in load_errors:
                    failures += 1
                    emit("error", id=item["id"], code="IMAGE_MODEL_LOAD_FAILED", preset=preset_id, message=load_errors[preset_id])
                    break
                try:
                    if loaded_id != preset_id:
                        if provider:
                            provider.unload()
                        emit("loading", preset=preset_id)
                        if preset["kind"] == "local" and preset_status(preset)["installed"]:
                            # Weights are on disk: never wait on the Hub. On a slow network its metadata
                            # checks alone stalled SDXL loading for 15+ minutes.
                            os.environ["HF_HUB_OFFLINE"] = "1"
                        provider = make_provider(preset)
                        with DownloadWatcher(preset) if preset["kind"] == "local" else _Null():
                            seconds = provider.load()
                        loaded_id = preset_id
                        monitor.cuda_ready.set()
                        emit("loaded", preset=preset_id, seconds=round(seconds, 1))
                    raw = cache / f"{final.stem}.raw.png"
                    seconds = provider.generate(prompt, negative, seed, raw, on_step=lambda s, t, _id=item["id"]: emit("step", id=_id, step=s, total=t))
                    finish_image(raw, final)
                    raw.unlink(missing_ok=True)
                    emit("image", id=item["id"], path=str(with_hook(final, item, job.get("theme"))), seconds=round(seconds, 2), preset=preset_id, cached=False, seed=seed, downgradedFrom=downgraded_from)
                    break
                except Exception as error:  # noqa: BLE001 - every failure is reported per image
                    oom = is_oom(error)
                    if oom and allow_fallback and lighter(preset_id) and PRESETS[lighter(preset_id)]["kind"] == "local":
                        # Out of VRAM: drop to a lighter preset for this scene and the rest of the job.
                        emit("downgrade", id=item["id"], fromPreset=preset_id, toPreset=lighter(preset_id), reason="OOM")
                        if provider:
                            provider.unload()
                        provider, loaded_id = None, None
                        downgraded_from = downgraded_from or preset_id
                        preset_id = current = lighter(preset_id)
                        continue
                    failures += 1
                    loading_failed = loaded_id != preset_id
                    if loading_failed and not oom:
                        load_errors[preset_id] = str(error)[:300]
                    code = "IMAGE_OOM" if oom else "IMAGE_MODEL_LOAD_FAILED" if loading_failed else "IMAGE_GENERATION_FAILED"
                    emit("error", id=item["id"], code=code, preset=preset_id, message=str(error)[:300])
                    break
    finally:
        if provider:
            provider.unload()
        emit("done", failures=failures, **monitor.stop())
    return 0


class _Null:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def main(argv: list[str]) -> int:
    command = argv[1] if len(argv) > 1 else ""
    if command == "status":
        emit("status", presets=[preset_status(p) for p in CONFIG["presets"]], default=CONFIG["default"], stack=local_stack())
        return 0
    if command == "download" and len(argv) > 2 and argv[2] in PRESETS:
        preset = PRESETS[argv[2]]
        provider = make_provider(preset)
        with DownloadWatcher(preset):
            provider.load()
        provider.unload()
        emit("download", preset=preset["id"], percent=100, totalGB=preset["downloadGB"])
        return 0
    if command == "run" and len(argv) > 2:
        return run(json.loads(Path(argv[2]).read_text(encoding="utf-8")))
    sys.stderr.write(__doc__ or "")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
