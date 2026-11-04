// Shared steps for render-job.mjs (full video) and check-frames.mjs (self-check stills).
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { RenderInternals } from '@remotion/renderer';
import { manifestSchema, sceneFrames } from '../src/schema.ts';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const fail = (code, detail = '') => { process.stderr.write(`ERROR ${code}${detail ? ` ${detail}` : ''}\n`); process.exit(1); };
export const argValue = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

/** Reads and validates the manifest with the zod schema. Exits with ERROR RENDER_MANIFEST_INVALID. */
export function readManifest(path) {
  if (!path) fail('RENDER_MANIFEST_MISSING');
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch { fail('RENDER_MANIFEST_INVALID', 'unreadable json'); }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    fail('RENDER_MANIFEST_INVALID', issues.replace(/\s+/g, ' ').slice(0, 300));
  }
  return parsed.data;
}

export const ffmpeg = (args, options = {}) => RenderInternals.callFf({ bin: 'ffmpeg', args, indent: false, logLevel: 'error', binariesDirectory: null, cancelSignal: undefined, options });

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
// Remotion's bundled ffmpeg has no blur filters, so blur = area-downscale by BLUR_FACTOR, then bicubic
// upscale. Visually close to a ~6-8 px gaussian at 1080p, and it makes the clip cheap to decode.
const BLUR_FACTOR = 10;
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Fits each background to the frame once with ffmpeg: crop to size, blur, loop/trim videos to the
 * scene length, drop their audio. Much cheaper than blurring every frame in the browser.
 * Returns per-scene { kind, file, blurred }. Any failure keeps the original file and CSS blur.
 */
export async function prepareBackgrounds(manifest, onStep = () => {}) {
  const { assetsDir, width, height, fps } = manifest;
  const result = [];
  for (let i = 0; i < manifest.scenes.length; i++) {
    const item = manifest.scenes[i];
    const bg = item.background;
    onStep(i / manifest.scenes.length);
    if (bg.kind === 'gradient') { result.push({ kind: 'gradient' }); continue; }
    const input = safeAsset(assetsDir, bg.file);
    const ext = extname(input).toLowerCase();
    const fit = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},scale=${even(width / BLUR_FACTOR)}:${even(height / BLUR_FACTOR)}:flags=area,scale=${width}:${height}:flags=bicubic`;
    try {
      if (bg.kind === 'video' && VIDEO_EXT.has(ext)) {
        const seconds = (sceneFrames(item.audioSeconds, fps) + 12) / fps;
        const out = `prepared-${i}.mp4`;
        await ffmpeg(['-y', '-stream_loop', '-1', '-i', input, '-t', seconds.toFixed(2), '-an', '-vf', `${fit},fps=${fps},format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', join(assetsDir, out)]);
        result.push({ kind: 'video', file: out, blurred: true });
      } else if (bg.kind === 'image' && bg.real && IMAGE_EXT.has(ext)) {
        // Archival photo: sharp (a blurred face is unrecognisable), Lanczos, crop biased to the top where faces usually are.
        const out = `prepared-${i}.jpg`;
        await ffmpeg(['-y', '-i', input, '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}:(in_w-${width})/2:(in_h-${height})*0.15`, '-frames:v', '1', '-q:v', '2', join(assetsDir, out)]);
        result.push({ kind: 'image', file: out, blurred: true, real: true, credit: bg.credit });
      } else if (bg.kind === 'image' && IMAGE_EXT.has(ext)) {
        const out = `prepared-${i}.jpg`;
        await ffmpeg(['-y', '-i', input, '-vf', fit, '-frames:v', '1', '-q:v', '3', join(assetsDir, out)]);
        result.push({ kind: 'image', file: out, blurred: true });
      } else result.push({ kind: bg.kind === 'video' ? 'video' : 'image', file: bg.file, blurred: false });
    } catch {
      result.push({ kind: bg.kind, file: bg.file, blurred: false, ...(bg.real ? { real: true, credit: bg.credit } : {}) });
    }
  }
  return result;
}

function safeAsset(base, name) {
  const target = resolve(base, name);
  if (name.includes('/') || name.includes('\\') || !target.startsWith(resolve(base) + sep) || !existsSync(target)) fail('RENDER_MANIFEST_INVALID', `missing asset ${name}`);
  return target;
}

const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

/** Serves files directly inside assetsDir to the headless browser, on 127.0.0.1 only. Supports Range for video. */
export async function serveAssets(assetsDir) {
  const base = resolve(assetsDir);
  const server = createServer((req, res) => {
    const name = decodeURIComponent((req.url || '').split('?')[0].replace(/^\/+/, ''));
    const target = resolve(base, name);
    const type = TYPES[extname(target).toLowerCase()];
    if (req.method !== 'GET' || !name || name.includes('/') || name.includes('\\') || !target.startsWith(base + sep) || !type || !existsSync(target)) { res.writeHead(404).end(); return; }
    const size = statSync(target).size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
    if (range) {
      const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      createReadStream(target, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': size });
      createReadStream(target).pipe(res);
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { url: (file) => `${origin}/${encodeURIComponent(file)}`, close: () => server.close() };
}

/** Composition props from a validated manifest. */
export function inputPropsFor(manifest, backgrounds, url) {
  return {
    fps: manifest.fps, width: manifest.width, height: manifest.height,
    musicSrc: manifest.music ? 'music/ambient-1.wav' : null,
    sfx: true,
    theme: manifest.theme, seed: manifest.seed,
    scenes: manifest.scenes.map((item, i) => {
      const bg = backgrounds[i];
      return {
        scene: item.scene,
        audioSrc: item.audio ? url(item.audio) : null,
        durationInFrames: sceneFrames(item.audioSeconds, manifest.fps),
        background: bg.kind === 'gradient' ? { kind: 'gradient' } : { kind: bg.kind, src: url(bg.file), blurred: bg.blurred, ...(bg.real ? { real: true, credit: bg.credit ?? item.background.credit } : {}) },
      };
    }),
  };
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

/**
 * Bundles the composition once per source version. The webpack bundle takes ~10-20 s, so reusing it
 * across renders is the single biggest speed win for short videos.
 */
export async function cachedBundle() {
  const hash = createHash('sha256');
  for (const file of [...walk(join(root, 'src')), ...walk(join(root, 'public'))].sort()) {
    hash.update(relative(root, file)); hash.update(readFileSync(file));
  }
  hash.update(readFileSync(join(root, 'package.json')));
  const outDir = join(root, 'node_modules', '.cache', 'creatorai-bundles', hash.digest('hex').slice(0, 16));
  if (existsSync(join(outDir, 'index.html'))) return outDir;
  // Build in a temp dir and rename, so a crash never leaves a half-written bundle behind.
  const temp = `${outDir}.tmp-${process.pid}`;
  await bundle({ entryPoint: join(root, 'src', 'index.ts'), publicDir: join(root, 'public'), outDir: temp });
  try { renameSync(temp, outDir); } catch { rmSync(temp, { recursive: true, force: true }); }
  return existsSync(join(outDir, 'index.html')) ? outDir : fail('RENDER_BUNDLE_FAILED');
}
