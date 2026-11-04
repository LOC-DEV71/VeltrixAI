// Typed view of presets.json, the single source of truth shared with generate.py (Python) and the
// backend (apps/backend-api/src/services/ImageGenService.ts reads the JSON at runtime).
import config from './presets.json';

export type PresetId = 'fast' | 'balanced' | 'quality' | 'cloud';

export interface ImagePreset {
  id: PresetId;
  label: string;
  kind: 'local' | 'fal';
  /** Hugging Face repo (local) or fal.ai model path (cloud). */
  model: string;
  family?: 'sd15' | 'sdxl';
  variant?: string;
  vae?: string;
  lora?: { repo: string; file: string };
  steps: number;
  guidance?: number;
  scheduler?: 'dpmpp_2m_karras' | 'euler_trailing';
  /** Generation size; images are upscaled to output.width x output.height. */
  width: number;
  height: number;
  /** Memory options so the preset fits a 6 GB GPU / 16 GB RAM machine. */
  memory?: { attentionSlicing: boolean; vaeTiling: boolean; cpuOffload: boolean };
  /** Default seconds per image until real runs are measured. */
  estimateSeconds: number;
  downloadGB: number;
  requiresEnv?: string;
}

export interface PresetConfig {
  default: PresetId;
  /** Out-of-VRAM fallback chain, heaviest first. */
  fallbackOrder: PresetId[];
  presets: ImagePreset[];
  output: { width: number; height: number };
}

export const PRESETS = config as PresetConfig;
export const presetById = (id: string) => PRESETS.presets.find((p) => p.id === id);

/**
 * generateImage({ prompt, negative, width, height, seed, theme }) -> image file path is implemented
 * by generate.py (`run` command, one EVENT line per image). The backend wraps it in
 * ImageGenService.runImageWorker so one process (one model load) serves all scenes of a video.
 */
export interface GenerateImageInput { prompt: string; negative?: string; width?: number; height?: number; seed: number; theme?: string; preset?: PresetId }
