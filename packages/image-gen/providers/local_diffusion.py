"""Local Stable Diffusion (SD 1.5 / SDXL) via diffusers.

Adapted from OpenMontage tools/graphics/local_diffusion.py (AGPL-3.0, https://github.com/calesthio/OpenMontage):
the generation core (fp16 on CUDA, seeded torch.Generator, pipe(...) call, save) follows its execute().
Added here: SDXL, LoRA, schedulers, memory options for 6 GB GPUs, reuse of one loaded pipeline
across images, explicit unload.
"""
from __future__ import annotations

import gc
import time
from pathlib import Path
from typing import Any, Callable


class LocalDiffusion:
    def __init__(self, preset: dict[str, Any], on_download: Callable[[dict[str, Any]], None] | None = None):
        self.preset = preset
        self.on_download = on_download
        self.pipe = None

    # ---- loading ----
    def _scheduler(self, pipe):
        from diffusers import DPMSolverMultistepScheduler, EulerDiscreteScheduler
        name = self.preset.get("scheduler")
        if name == "dpmpp_2m_karras":
            # Some checkpoints ship a DEIS config; force DPM-Solver++ (2M) with Karras sigmas.
            return DPMSolverMultistepScheduler.from_config(
                pipe.scheduler.config, algorithm_type="dpmsolver++", solver_order=2, use_karras_sigmas=True, final_sigmas_type="zero")
        if name == "euler_trailing":  # what SDXL-Lightning expects
            return EulerDiscreteScheduler.from_config(pipe.scheduler.config, timestep_spacing="trailing")
        return pipe.scheduler

    def load(self) -> float:
        import torch
        from diffusers import AutoencoderKL, StableDiffusionPipeline, StableDiffusionXLPipeline

        start = time.time()
        p = self.preset
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device == "cuda" else torch.float32
        kwargs: dict[str, Any] = {"torch_dtype": dtype, "use_safetensors": True}
        if p.get("variant") and device == "cuda":
            kwargs["variant"] = p["variant"]
        if p.get("vae"):
            kwargs["vae"] = AutoencoderKL.from_pretrained(p["vae"], torch_dtype=dtype)
        cls = StableDiffusionXLPipeline if p["family"] == "sdxl" else StableDiffusionPipeline
        if p["family"] == "sd15":
            kwargs["safety_checker"] = None
            kwargs["requires_safety_checker"] = False
        pipe = cls.from_pretrained(p["model"], **kwargs)
        pipe.scheduler = self._scheduler(pipe)
        if p.get("lora"):
            pipe.load_lora_weights(p["lora"]["repo"], weight_name=p["lora"]["file"])
            pipe.fuse_lora()
        memory = p.get("memory", {})
        if memory.get("attentionSlicing"):
            pipe.enable_attention_slicing()
        if memory.get("vaeTiling"):
            pipe.vae.enable_tiling()
        if device == "cuda" and memory.get("cpuOffload"):
            pipe.enable_model_cpu_offload()  # one component on the GPU at a time
        else:
            pipe = pipe.to(device)
        pipe.set_progress_bar_config(disable=True)
        self.pipe, self.device = pipe, device
        return time.time() - start

    # ---- generation (core follows OpenMontage execute()) ----
    def generate(self, prompt: str, negative: str, seed: int, output_path: Path, cancelled: Callable[[], bool] = lambda: False,
                 on_step: Callable[[int, int], None] | None = None) -> float:
        import torch

        if self.pipe is None:
            self.load()
        p = self.preset
        start = time.time()
        generator = torch.Generator(device="cpu").manual_seed(int(seed))  # CPU generator: same image with or without offload

        total = int(p["steps"])

        def stop_when_cancelled(pipe, step, timestep, callback_kwargs):
            if on_step:
                on_step(step + 1, total)  # one event per denoising step, for a smooth progress bar
            if cancelled():
                pipe._interrupt = True
            return callback_kwargs

        call: dict[str, Any] = dict(
            prompt=prompt, width=p["width"], height=p["height"], num_inference_steps=p["steps"],
            guidance_scale=p["guidance"], generator=generator, callback_on_step_end=stop_when_cancelled,
        )
        if p.get("guidance", 0) > 1:  # negative prompts only apply with classifier-free guidance
            call["negative_prompt"] = negative
        image = self.pipe(**call).images[0]
        if cancelled():
            raise InterruptedError("cancelled")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        image.save(str(output_path))
        return time.time() - start

    def unload(self) -> None:
        import torch
        self.pipe = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
