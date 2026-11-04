// Stock backgrounds for video scenes: Pexels vertical videos first, then photos (when PEXELS_API_KEY
// is set). Results and downloads are cached on disk. Without a key the renderer uses its animated gradient.
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface StockVideo {
  bytes: Buffer;
  extension: 'mp4';
  source: 'PEXELS_VIDEO';
  credit: { photographer: string; photographerUrl: string; pageUrl: string };
  providerId: string;
}

export interface StockImage {
  bytes: Buffer;
  extension: 'jpg' | 'png' | 'webp' | 'svg';
  source: 'PEXELS' | 'GENERATED';
  credit?: { photographer: string; photographerUrl: string; pageUrl: string };
  providerId?: string;
}

export type Orientation = 'portrait' | 'landscape';
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_HOSTS = new Set(['images.pexels.com']);
const VIDEO_HOSTS = new Set(['videos.pexels.com']);
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
const SEARCH_TTL_MS = 7 * 24 * 3600_000;
const TYPES: Record<string, StockImage['extension']> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const PALETTES = [['#1e3a8a', '#0f172a'], ['#7c2d12', '#1c1917'], ['#14532d', '#052e16'], ['#581c87', '#1e1b4b'], ['#155e75', '#0c0a09'], ['#9f1239', '#1c1917']];

export function generatedBackground(index: number, width: number, height: number): StockImage {
  const [from, to] = PALETTES[index % PALETTES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/></svg>`;
  return { bytes: Buffer.from(svg), extension: 'svg', source: 'GENERATED' };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal, redirect: 'error' }); }
  finally { clearTimeout(timer); }
}

/** Downloads an image only from allowed hosts, with type and size limits. */
export async function downloadImage(url: string): Promise<{ bytes: Buffer; extension: StockImage['extension'] }> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) throw new Error('STOCK_HOST_NOT_ALLOWED');
  const response = await fetchWithTimeout(url, {}, 20000);
  if (!response.ok) throw new Error('STOCK_DOWNLOAD_FAILED');
  const type = (response.headers.get('content-type') || '').split(';')[0].trim();
  const extension = TYPES[type];
  if (!extension) throw new Error('STOCK_TYPE_NOT_ALLOWED');
  if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('STOCK_TOO_LARGE');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('STOCK_TOO_LARGE');
  return { bytes, extension };
}

/** Downloads a stock video only from the Pexels video CDN over https, mp4 only, size-capped. */
export async function downloadVideo(url: string): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !VIDEO_HOSTS.has(parsed.hostname)) throw new Error('STOCK_HOST_NOT_ALLOWED');
  const response = await fetchWithTimeout(url, {}, 60000);
  if (!response.ok) throw new Error('STOCK_DOWNLOAD_FAILED');
  const type = (response.headers.get('content-type') || '').split(';')[0].trim();
  if (type !== 'video/mp4') throw new Error('STOCK_TYPE_NOT_ALLOWED');
  if (Number(response.headers.get('content-length') || 0) > MAX_VIDEO_BYTES) throw new Error('STOCK_TOO_LARGE');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_VIDEO_BYTES) throw new Error('STOCK_TOO_LARGE');
  return bytes;
}

interface VideoFile { quality?: string; file_type?: string; width?: number; height?: number; link?: string }

/** Picks the mp4 rendition closest to (but preferably not above) the target width, in the right orientation. */
export function pickVideoFile(files: VideoFile[], orientation: Orientation, targetWidth: number): VideoFile | null {
  const usable = files.filter((f) => f.file_type === 'video/mp4' && typeof f.link === 'string' && Number(f.width) >= 360 && Number(f.height) >= 360
    && (orientation === 'portrait' ? Number(f.height) >= Number(f.width) : Number(f.width) >= Number(f.height)));
  const score = (f: VideoFile) => { const w = Number(f.width); return w > targetWidth * 1.4 ? 10_000 + w : Math.abs(targetWidth - w); };
  return usable.sort((a, b) => score(a) - score(b))[0] || null;
}

export class PexelsProvider {
  /** `cacheDir` enables the on-disk cache for search results and downloads. */
  constructor(private readonly apiKey: string, private readonly cacheDir?: string) {}

  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>, encode: (v: T) => Buffer, decode: (b: Buffer) => T): Promise<T> {
    if (!this.cacheDir) return load();
    const file = join(this.cacheDir, createHash('sha256').update(key).digest('hex').slice(0, 32));
    try {
      const info = await stat(file);
      if (Date.now() - info.mtimeMs < ttlMs) return decode(await readFile(file));
    } catch { /* miss */ }
    const value = await load();
    await mkdir(this.cacheDir, { recursive: true }).then(() => writeFile(file, encode(value))).catch(() => undefined);
    return value;
  }

  private json<T>(key: string, load: () => Promise<T>) {
    return this.cached(key, SEARCH_TTL_MS, load, (v) => Buffer.from(JSON.stringify(v)), (b) => JSON.parse(b.toString('utf8')));
  }

  /** Searches Pexels videos and returns the first clip not in `exclude`. Null when nothing usable. */
  async searchVideo(query: string, orientation: Orientation, width: number, exclude: Set<string>): Promise<StockVideo | null> {
    const results = await this.json(`video-search:${orientation}:${query}`, async () => {
      const url = `https://api.pexels.com/videos/search?${new URLSearchParams({ query, orientation, per_page: '12', size: 'medium' })}`;
      const response = await fetchWithTimeout(url, { headers: { Authorization: this.apiKey } }, 15000);
      if (response.status === 429) throw new Error('STOCK_RATE_LIMITED');
      if (!response.ok) throw new Error('STOCK_SEARCH_FAILED');
      const body: any = await response.json();
      return (Array.isArray(body?.videos) ? body.videos : []).map((v: any) => {
        const file = pickVideoFile(Array.isArray(v?.video_files) ? v.video_files : [], orientation, width);
        return file && Number(v?.duration) >= 3 ? { id: String(v.id), link: String(file.link), user: String(v?.user?.name || ''), userUrl: String(v?.user?.url || ''), url: String(v?.url || '') } : null;
      }).filter(Boolean) as Array<{ id: string; link: string; user: string; userUrl: string; url: string }>;
    });
    for (const v of results) {
      if (!v.id || exclude.has(v.id)) continue;
      try {
        const bytes = await this.cached(`video-file:${v.link}`, Infinity, () => downloadVideo(v.link), (b) => b, (b) => b);
        return { bytes, extension: 'mp4', source: 'PEXELS_VIDEO', providerId: v.id, credit: { photographer: v.user, photographerUrl: v.userUrl, pageUrl: v.url } };
      } catch { continue; }
    }
    return null;
  }

  /** Searches Pexels photos and returns the first one not in `exclude`. Null when nothing usable. */
  async search(query: string, orientation: Orientation, width: number, height: number, exclude: Set<string>): Promise<StockImage | null> {
    const photos = await this.json(`photo-search:${orientation}:${query}`, async () => {
      const url = `https://api.pexels.com/v1/search?${new URLSearchParams({ query, orientation, per_page: '10', size: 'large' })}`;
      const response = await fetchWithTimeout(url, { headers: { Authorization: this.apiKey } }, 15000);
      if (response.status === 429) throw new Error('STOCK_RATE_LIMITED');
      if (!response.ok) throw new Error('STOCK_SEARCH_FAILED');
      const body: any = await response.json();
      return (Array.isArray(body?.photos) ? body.photos : []).map((photo: any) => ({
        id: String(photo?.id ?? ''), original: photo?.src?.original,
        photographer: String(photo?.photographer || ''), photographerUrl: String(photo?.photographer_url || ''), pageUrl: String(photo?.url || ''),
      }));
    });
    for (const photo of photos as Array<{ id: string; original: unknown; photographer: string; photographerUrl: string; pageUrl: string }>) {
      if (!photo.id || exclude.has(photo.id) || typeof photo.original !== 'string') continue;
      const sized = `${photo.original}?${new URLSearchParams({ auto: 'compress', cs: 'tinysrgb', fit: 'crop', w: String(width), h: String(height) })}`;
      try {
        const image = await this.cached(`photo-file:${sized}`, Infinity, () => downloadImage(sized),
          (v) => Buffer.concat([Buffer.from(v.extension.padEnd(4, ' ')), v.bytes]), (b) => ({ extension: b.subarray(0, 4).toString().trim() as StockImage['extension'], bytes: b.subarray(4) }));
        return { ...image, source: 'PEXELS', providerId: photo.id, credit: { photographer: photo.photographer, photographerUrl: photo.photographerUrl, pageUrl: photo.pageUrl } };
      } catch { continue; }
    }
    return null;
  }
}

export function createStockProvider(env: NodeJS.ProcessEnv = process.env, cacheDir?: string): PexelsProvider | null {
  const key = env.PEXELS_API_KEY?.trim();
  return key ? new PexelsProvider(key, cacheDir) : null;
}
