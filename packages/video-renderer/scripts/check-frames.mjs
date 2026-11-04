// Self-check from docs/VIDEO_STYLE.md: renders N evenly spaced stills of a manifest with renderStill.
//
//   node scripts/check-frames.mjs --manifest <manifest.json> --out <dir> [--count 8] [--frames 12,40,90]
//
// Prints one line per still: FRAME <n> <scene#> <type> <path>
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openBrowser, renderStill, selectComposition } from '@remotion/renderer';
import { argValue, cachedBundle, fail, inputPropsFor, prepareBackgrounds, readManifest, serveAssets } from './lib.mjs';

const manifest = readManifest(argValue('--manifest'));
const out = argValue('--out') || fail('CHECK_OUT_MISSING');
const count = Number(argValue('--count') || 8);
mkdirSync(out, { recursive: true });

const assets = await serveAssets(manifest.assetsDir);
const browser = await openBrowser('chrome', { chromiumOptions: { gl: process.env.VIDEO_RENDER_GL || (process.platform === 'linux' ? 'swangle' : 'angle') } });
try {
  const inputProps = inputPropsFor(manifest, await prepareBackgrounds(manifest), assets.url);
  const serveUrl = await cachedBundle();
  const composition = await selectComposition({ serveUrl, id: 'AutoVideo', inputProps, puppeteerInstance: browser });
  const total = composition.durationInFrames;
  const frames = argValue('--frames')
    ? argValue('--frames').split(',').map(Number)
    : Array.from({ length: count }, (_, i) => Math.min(total - 1, Math.round(((i + 0.5) / count) * total)));
  const starts = inputProps.scenes.reduce((acc, s, i) => [...acc, i ? acc[i - 1] + inputProps.scenes[i - 1].durationInFrames : 0], []);
  for (const frame of frames) {
    const scene = starts.filter((s) => s <= frame).length - 1;
    const path = join(out, `frame-${String(frame).padStart(5, '0')}.png`);
    await renderStill({ composition, serveUrl, inputProps, frame, output: path, imageFormat: 'png', puppeteerInstance: browser });
    process.stdout.write(`FRAME ${frame} ${scene + 1} ${inputProps.scenes[scene].scene.type} ${path}\n`);
  }
} finally {
  await browser.close({ silent: true });
  assets.close();
}
