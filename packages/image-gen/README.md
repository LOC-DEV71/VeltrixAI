# packages/image-gen

AI background images for video scenes. Each scene's own `imagePrompt` (written with the script) is used as is. Only the theme's style suffix and one shared negative prompt are added; no LLM rewrites the prompt.

## Where it sits in the pipeline

The auto-video run (`apps/backend-api/src/services/AutoVideoService.ts`) goes through these steps:

1. Gemma writes the script and splits it into scenes.
2. The storyboard is planned, then Gemma is **stopped** with `services/ai/stop.cjs`, because llama-server has no unload call. This frees the GPU.
3. **IMAGES**: one `IMAGE_GEN` job runs in the GPU worker (`workers/ImageWorker.ts`). It starts `generate.py run`, which loads one model, makes every image, and exits. The process exiting frees all VRAM.
   - If one scene fails or stalls, only that scene falls back to Pexels, then to the gradient. The job carries on.
4. TTS for each scene, with word timings.
5. Remotion render. A ready AI image becomes the scene background. The background moves with a camera chosen from the scene's `videoPrompt` (`packages/video-renderer/src/camera.ts`).

## Files

| File | Role |
|---|---|
| `presets.json` | Quality presets: model, steps, size, memory options, default time estimate, download size. Read by Python, the backend and the UI. |
| `presets.ts` | Typed view of `presets.json`. |
| `style.py` | Theme suffix + shared negative prompt. Only the `veltrix` theme exists for now. |
| `generate.py` | Worker process. Commands: `run <job.json>`, `status`, `download <preset>`. It handles the cache, falls back to a lighter preset on out-of-VRAM, upscales to 1080×1920, and samples peak VRAM and RAM. |
| `providers/local_diffusion.py` | SD 1.5 / SDXL through `diffusers`. |
| `providers/fal_flux.py` | FLUX on fal.ai. Enabled only when `FAL_KEY` is set. |
| `providers/video_provider.py` | Reserved image-to-video interface. Disabled. |
| `cache/` | Final images, named by a hash of preset + prompt + negative + seed + size. |

## Presets (6 GB GPU, 16 GB RAM)

| Id | Name | Model | Steps | Size | Memory |
|---|---|---|---|---|---|
| `fast` | Nhanh | Lykon/dreamshaper-8 (SD 1.5, fp16) | 20 | 512×896 | attention slicing |
| `balanced` | Cân bằng (default) | SDXL base fp16 + SDXL-Lightning 4-step LoRA | 4 | 768×1344 | CPU offload, VAE tiling |
| `quality` | Đẹp | SDXL base fp16 | 28 | 768×1344 | CPU offload, VAE tiling, slicing |
| `cloud` | Cloud | fal-ai/flux/schnell | 4 | 768×1344 | — (shown only with `FAL_KEY`) |

- `balanced` and `quality` share the SDXL base weights.
- Every image is upscaled with Lanczos to 1080×1920, cover-cropped.
- On out-of-VRAM, the worker moves down `quality → balanced → fast` for that scene and the rest of the job, and logs it.
- The time estimates shown in the form are running averages of real runs (`image_gen_stats` collection). Until a preset has run once, the defaults from `presets.json` are shown.

## Seeds

Each video has one base seed, derived from the project id. A scene's seed is `base + scene order`, which keeps the style consistent across scenes. "Tạo lại" adds `7919 × attempt` to get a new picture.

## Setup

The venv uses the CPython 3.12 runtime that ships with the TTS service:

```
services/tts/artifacts/runtime/python/cpython-3.12.10-windows-x86_64-none/python.exe -m venv packages/image-gen/.venv
packages/image-gen/.venv/Scripts/python -m pip install torch --index-url https://download.pytorch.org/whl/cu128
packages/image-gen/.venv/Scripts/python -m pip install -r packages/image-gen/requirements.txt
```

Model weights download the first time a preset is used, into the Hugging Face cache. The workflow shows the download progress.

Optional environment variables (backend `.env`): `FAL_KEY` (or `FAL_AI_API_KEY`), `HF_TOKEN`, `HF_HOME`.

## Origin of the code (AGPL-3.0)

Parts are adapted from **OpenMontage**, https://github.com/calesthio/OpenMontage (commit `195eab2`, license AGPL-3.0). That reference clone is kept outside the build in `_ref/OpenMontage` and ignored by git. This project is for personal use.

- `providers/local_diffusion.py` follows the `execute()` of `tools/graphics/local_diffusion.py`: fp16 on CUDA, a seeded `torch.Generator`, the `pipe(...)` call, and saving the image.
- `providers/fal_flux.py` follows `tools/graphics/flux_image.py`: the `FAL_KEY` / `FAL_AI_API_KEY` lookup, the payload, the `https://fal.run/fal-ai/<model>` call, and downloading the result.
- The idea of a per-theme prompt suffix and negative prompt comes from OpenMontage `styles/*.yaml` (`image_prompt_prefix`, `image_negative_prompt`). The `veltrix` text itself is new.
- Not taken: `tools/base_tool.py`, the tool registry, `styles/playbook_loader.py`, pipelines, skills, other providers, video, TTS and music.
