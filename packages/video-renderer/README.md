# @creatorai/video-renderer

Remotion renderer for Veltrix AI Shorts (1080×1920, 30 fps). The design and motion rules come from [docs/VIDEO_STYLE.md](../../docs/VIDEO_STYLE.md).

## Pipeline

The backend video worker (`apps/backend-api/src/workers/VideoWorker.ts`) builds each video in these steps:

1. **Storyboard** (`services/VideoStoryboard.ts`)
   - The LLM turns each narrated scene into `{ type, title, subtitle, icon, emphasis, data, bg_keywords }`.
   - The output is validated with zod. When it is invalid, the planner retries up to 2 more times and puts the validation errors in the prompt.
   - If it is still invalid, the planner keeps the scenes that validated on their own, fills the rest with heuristics, and repairs the order: hook first, cta last, no two neighbours with the same type.
2. **Backgrounds**. It tries, in order:
   - a vertical Pexels video;
   - a Pexels photo;
   - the renderer's animated gradient.

   Searches and downloads are cached in `.runtime/media-cache`.
3. **Word timings** (`services/WordTiming.ts`)
   - Neither the TTS nor Whisper is available to provide timestamps, so the worker estimates them from the audio energy.
   - Words are placed on voiced time only, never in silence. Punctuation snaps to the real pauses, and numbers count as several syllables.
4. **Render**. `scripts/render-job.mjs --manifest m.json` runs these steps:
   - validates the manifest with `src/schema.ts`;
   - fits and blurs the backgrounds with ffmpeg;
   - renders with Remotion, using a cached bundle and GPU compositing;
   - normalizes loudness to **-14 LUFS** in two passes.

## Layout

| File | Role |
|---|---|
| `src/schema.ts` | Zod schema for storyboard scenes and the manifest. It is the contract with the backend, and backend tests validate against it. |
| `src/theme.ts` | Colors (#0B0B1A, #7C5CFF, #FFD23F, #3DE0FF), glass, safe area (12% top, 20% bottom), type sizes. |
| `src/motion.ts` | Springs and eased curves, stagger, float and pulse. `cue()` finds the frame at which a phrase is spoken. |
| `src/layers.tsx` | Layers 1-3: Ken Burns media with a dark scrim, color grade, and grid/particles/light streak. |
| `src/templates/*` | One component per scene type: hook, icon_card, stat, list, compare, scale, timeline, quote, cta. |
| `src/Captions.tsx` | Captions of 2-4 words with the spoken word highlighted. Emphasis words are yellow. |
| `src/transitions.ts` | Slide, zoom-through, wipe and blur, rotated so a kind never repeats back to back. |
| `src/Video.tsx` | Timeline: overlapping scenes, voice, SFX (whoosh/pop/tick) and music ducked under the voice. |

## Commands

- `node scripts/make-audio-assets.mjs` synthesizes the SFX and the 32 s ambient loop in `public/`. These are original sounds, so there is nothing to license.
- `node scripts/check-frames.mjs --manifest m.json --out dir [--count 8]` renders evenly spaced stills for the self-check in VIDEO_STYLE.md.
- `npx remotion studio src/index.ts` previews all nine templates with sample data.

### Environment variables

- `VIDEO_RENDER_GL` defaults to `angle`, or `swangle` on Linux servers without a GPU.
- `VIDEO_RENDER_CONCURRENCY` defaults to 60% of the CPU threads, capped at 10.

## Known gaps

- **Background blur.** Remotion's bundled ffmpeg has no blur filters. Backgrounds are blurred by downscaling them ×10 and scaling them back up, which looks close to a 6-8 px blur.
- **Word timing.** Timestamps are estimated from the audio, not taken from Whisper. To use Whisper, plug it into `alignWords`.
- **Pexels.** Without `PEXELS_API_KEY`, every scene uses the animated gradient, so backgrounds do not match the content.
- **Landscape.** 16:9 videos are laid out on the 1080×1920 design canvas and centered in the frame. The background still fills the whole frame.
