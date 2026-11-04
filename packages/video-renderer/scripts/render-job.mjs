// Renders one video from a manifest written by the backend video worker.
//
//   node scripts/render-job.mjs --manifest <path/to/manifest.json>
//
// Manifest (validated with zod, see src/schema.ts):
//   { assetsDir, outputPath, fps, width, height, music,
//     scenes: [{ scene: <storyboard scene>, audio?, audioSeconds, background: { kind, file? } }] }
// Files are names inside assetsDir, served to headless Chrome from 127.0.0.1.
//
// Steps: prepare backgrounds (ffmpeg) -> render (Remotion, cached bundle) -> loudness to -14 LUFS.
// Stdout protocol (one per line):  PROGRESS <0..1>   |   DONE <json>
// Errors go to stderr as:          ERROR <CODE> [detail]
import { rmSync, statSync } from 'node:fs';
import { cpus, freemem } from 'node:os';
import { join } from 'node:path';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { argValue, cachedBundle, ffmpeg, inputPropsFor, prepareBackgrounds, readManifest, serveAssets } from './lib.mjs';

const TARGET_LUFS = -14;
// GPU compositing (ANGLE) renders ~2x faster here; Linux servers without a GPU need software GL.
const GL = process.env.VIDEO_RENDER_GL || (process.platform === 'linux' ? 'swangle' : 'angle');
// Measured on a 16-thread Ryzen: throughput plateaus around 10 tabs, more only adds contention.
const CONCURRENCY = Number(process.env.VIDEO_RENDER_CONCURRENCY) || Math.max(2, Math.min(Math.floor(cpus().length * 0.5), Math.floor((freemem() / (1024 ** 3) - 1.5) / 0.7), 8));
const manifest = readManifest(argValue('--manifest'));
const started = Date.now();
let last = -1;
const report = (fraction) => {
  const step = Math.floor(fraction * 50); // every 2%
  if (step !== last) { last = step; process.stdout.write(`PROGRESS ${Math.min(1, fraction).toFixed(2)}\n`); }
};

/** Two-pass EBU R128 loudness normalization. Video stream is copied untouched. */
async function normalizeLoudness(input, output) {
  const filter = `loudnorm=I=${TARGET_LUFS}:TP=-2:LRA=11`; // TP -2 leaves headroom for AAC overshoot
  const probe = await ffmpeg(['-hide_banner', '-i', input, '-vn', '-af', `${filter}:print_format=json`, '-f', 'null', '-'], { reject: true });
  const json = String(probe.stderr).slice(String(probe.stderr).lastIndexOf('{'));
  const m = JSON.parse(json.slice(0, json.indexOf('}') + 1));
  const measured = `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  await ffmpeg(['-hide_banner', '-y', '-i', input, '-c:v', 'copy', '-af', `${filter}:${measured},aresample=48000`, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output]);
  return { inputLufs: Number(m.input_i), targetLufs: TARGET_LUFS };
}

let assets;
const temp = join(manifest.assetsDir, 'render-raw.mp4');
try {
  report(0);
  const backgrounds = await prepareBackgrounds(manifest, (f) => report(0.06 * f));
  assets = await serveAssets(manifest.assetsDir);
  const inputProps = inputPropsFor(manifest, backgrounds, assets.url);
  const serveUrl = await cachedBundle();
  report(0.08);
  const composition = await selectComposition({ serveUrl, id: 'AutoVideo', inputProps, timeoutInMilliseconds: 120_000, chromiumOptions: { gl: GL } });
  await renderMedia({
    composition, serveUrl, inputProps, codec: 'h264', outputLocation: temp, overwrite: true,
    imageFormat: 'jpeg', jpegQuality: 88, crf: 20, x264Preset: 'veryfast', audioCodec: 'aac',
    concurrency: Number(process.env.VIDEO_RENDER_CONCURRENCY) || (composition.durationInFrames > 3600 ? Math.min(CONCURRENCY, 5) : CONCURRENCY), timeoutInMilliseconds: 120_000, offthreadVideoCacheSizeInBytes: 256 * 1024 * 1024, chromiumOptions: { gl: GL },
    onProgress: ({ progress }) => report(0.08 + progress * 0.84),
  });
  report(0.93);
  const loudness = await normalizeLoudness(temp, manifest.outputPath);
  report(1);
  process.stdout.write(`DONE ${JSON.stringify({
    durationInFrames: composition.durationInFrames, fps: composition.fps, bytes: statSync(manifest.outputPath).size,
    renderSeconds: Math.round((Date.now() - started) / 100) / 10, loudness,
    backgrounds: backgrounds.map((b) => b.kind),
  })}\n`);
} catch (error) {
  process.stderr.write(`ERROR RENDER_FAILED ${String(error?.message || error).slice(0, 300).replace(/\s+/g, ' ')}\n`);
  process.exitCode = 1;
} finally {
  assets?.close();
  rmSync(temp, { force: true });
}
