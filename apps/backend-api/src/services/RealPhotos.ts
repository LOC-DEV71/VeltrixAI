// Real archival photos for scenes about real people, events and places. Image models cannot draw a
// specific real person, so when the storyboard names a `subject` ("Ho Chi Minh", "Dien Bien Phu"),
// we look it up on Wikimedia Commons and use a freely licensed photo instead of an AI image.
//
// Only Public domain / CC0 / CC BY / CC BY-SA files are used, and the author and license are stored
// with the image (credit) so they can be shown and added to the video description.
import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { Scene } from '../models/Scene';
import { SceneImage } from '../models/SceneImage';
import { imageCacheDir } from './ImageGenService';

const API = 'https://commons.wikimedia.org/w/api.php';
// Wikimedia asks automated clients for a descriptive User-Agent.
const USER_AGENT = 'CreatorAI/1.0 (local personal video tool; Wikimedia Commons image lookup)';
const FREE_LICENSE = /^(public domain|pd\b|cc0|cc[ -]by(-sa)?[ -]?\d|cc[ -]by(-sa)?$)/i;
const MAX_BYTES = 12 * 1024 * 1024;

export interface CommonsPhoto { title: string; url: string; width: number; height: number; license: string; artist: string; pageUrl: string }

/** Lowercase without Vietnamese diacritics, so "Võ Nguyên Giáp" matches "Vo_Nguyen_Giap.jpg". */
const fold = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
const stripHtml = (html: string) => html.replace(/<(\w+)[^>]*display:\s*none[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

const toPhoto = (page: any) => {
  const info = page.imageinfo?.[0];
  const meta = info?.extmetadata ?? {};
  return {
    title: String(page.title || ''), url: String(info?.thumburl || info?.url || ''), width: Number(info?.width) || 0, height: Number(info?.height) || 0,
    mime: String(info?.mime || ''), license: stripHtml(String(meta.LicenseShortName?.value || '')), artist: stripHtml(String(meta.Artist?.value || '')).slice(0, 120),
    pageUrl: String(info?.descriptionurl || ''),
  };
};
const usable = (p: ReturnType<typeof toPhoto>) => p.url && /image\/(jpeg|png)/.test(p.mime) && FREE_LICENSE.test(p.license) && Math.min(p.width, p.height) >= 250
  && !/\b(map|flag|coat of arms|logo|stamp|signature|banknote|diagram|chart|grave|tomb)\b/i.test(p.title);
const IMAGE_PROPS = { prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1080', iiextmetadatafilter: 'LicenseShortName|Artist' };

const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** GET JSON with a polite retry on 429/503 (Wikimedia rate limits), honouring Retry-After up to 8 s. */
async function getJson(url: string, fetchImpl: typeof fetch, tries = 3): Promise<any> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(12000) });
    if (res.ok) return res.json();
    if (res.status !== 429 && res.status !== 503) return null;
    const after = Number(res.headers.get('retry-after'));
    await wait(Math.min(8000, Number.isFinite(after) && after > 0 ? after * 1000 : 1500 * (attempt + 1)));
  }
  return null;
}

const subjectCache = new Map<string, Promise<Awaited<ReturnType<typeof lookupSubject>>>>();

/**
 * The Wikidata entity for a name ("Ho Chi Minh" -> the person Q36014, not the city), with its main
 * image (P18) and Commons category (P373). Null when nothing matches.
 */
export function resolveSubject(name: string, fetchImpl: typeof fetch = fetch) {
  const key = name.toLowerCase();
  if (!subjectCache.has(key)) subjectCache.set(key, lookupSubject(name, fetchImpl).then((v) => { if (!v) subjectCache.delete(key); return v; }, () => { subjectCache.delete(key); return null; }));
  return subjectCache.get(key)!;
}

async function lookupSubject(name: string, fetchImpl: typeof fetch): Promise<{ id: string; label: string; image: string | null; category: string | null } | null> {
  const found = await getJson(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbsearchentities', search: name, language: 'en', uselang: 'en', type: 'item', limit: '1', format: 'json' })}`, fetchImpl);
  const hit = found?.search?.[0];
  if (!hit?.id) return null;
  const entity = (await getJson(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetentities', ids: hit.id, props: 'claims', format: 'json' })}`, fetchImpl))?.entities?.[hit.id];
  const claim = (p: string) => entity?.claims?.[p]?.[0]?.mainsnak?.datavalue?.value ?? null;
  return { id: hit.id, label: String(hit.label || name), image: claim('P18'), category: claim('P373') };
}

/**
 * Freely licensed photos of a subject: its Wikidata main image first, then files from its own
 * Commons category. Falls back to a title-matched full-text search only when Wikidata has no entity.
 */
export async function searchCommons(query: string, fetchImpl: typeof fetch = fetch): Promise<CommonsPhoto[]> {
  const subject = await resolveSubject(query, fetchImpl).catch(() => null);
  const pages: any[] = [];
  if (subject?.image) {
    const main = await getJson(`${API}?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', titles: `File:${subject.image}`, ...IMAGE_PROPS })}`, fetchImpl);
    pages.push(...(main?.query?.pages ?? []));
  }
  if (subject?.category) {
    const members = await getJson(`${API}?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', generator: 'categorymembers', gcmtitle: `Category:${subject.category}`, gcmtype: 'file', gcmlimit: '40', ...IMAGE_PROPS })}`, fetchImpl);
    pages.push(...(members?.query?.pages ?? []));
  }
  if (!subject) {
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const found = await getJson(`${API}?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrnamespace: '6', gsrlimit: '20', gsrsearch: `intitle:"${query}" filetype:bitmap`, ...IMAGE_PROPS })}`, fetchImpl);
    pages.push(...(found?.query?.pages ?? []).filter((p: any) => words.every((w) => String(p.title).toLowerCase().includes(w))));
  }
  const seen = new Set<string>();
  const mainTitle = subject?.image ? `File:${subject.image}` : '';
  const photos = pages.map(toPhoto).filter((p) => usable(p) && (p.title === mainTitle || Math.min(p.width, p.height) >= 400) && !seen.has(p.url) && seen.add(p.url));
  // Category members can be loosely related (a plant photographed in a park named after the person),
  // so rank: the Wikidata main image, then files whose title names the subject, then portrait first.
  const names = [...new Set([...(subject?.label || '').split(/\s+/), ...query.split(/\s+/)].map((w) => fold(w)).filter((w) => w.length > 2))];
  const score = (p: { title: string; width: number; height: number }) => (p.title === mainTitle ? 100 : 0) + names.filter((w) => fold(p.title).includes(w)).length * 10 + (p.height >= p.width ? 1 : 0);
  return photos.filter((p) => score(p) >= 10).sort((a, b) => score(b) - score(a)).map(({ mime: _m, ...photo }) => photo);
}

export const creditLine = (p: CommonsPhoto) => `${p.artist || 'Không rõ tác giả'} / Wikimedia Commons (${p.license})`;

/**
 * For every scene whose storyboard names a real subject, stores a real photo as the scene's image
 * (SceneImage preset "wikimedia", READY). Scenes sharing a subject get different photos. Scenes the
 * user already has an image for are left alone. Never throws: a scene without a hit keeps the
 * normal AI image / stock / gradient path.
 */
export async function attachRealPhotos(projectId: mongoose.Types.ObjectId, ownerId: mongoose.Types.ObjectId, fetchImpl: typeof fetch = fetch) {
  const scenes = await Scene.find({ projectId }).sort({ order: 1 }).lean();
  const bySubject = new Map<string, CommonsPhoto[]>();
  const used = new Set<string>();
  let attached = 0;
  for (const scene of scenes) {
    const subject = String((scene.storyboard as any)?.subject || '').trim();
    if (!subject) continue;
    const existing = await SceneImage.findOne({ sceneId: scene._id }).lean();
    if (existing && (existing.promptEdited || existing.status === 'READY' || existing.status === 'GENERATING')) continue;
    try {
      if (!bySubject.has(subject)) bySubject.set(subject, await searchCommons(subject, fetchImpl).catch(() => []));
      const photo = bySubject.get(subject)!.find((p) => !used.has(p.url));
      if (!photo) continue;
      const res = await fetchImpl(photo.url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20000) });
      const bytes = Buffer.from(await res.arrayBuffer());
      if (!res.ok || bytes.length < 2000 || bytes.length > MAX_BYTES) continue;
      const dir = join(imageCacheDir(), 'real');
      await mkdir(dir, { recursive: true });
      const file = join(dir, `${crypto.createHash('sha256').update(photo.url).digest('hex').slice(0, 24)}${/\.png($|\?)/i.test(photo.url) ? '.png' : '.jpg'}`);
      await writeFile(file, bytes);
      used.add(photo.url);
      await SceneImage.updateOne({ sceneId: scene._id }, {
        $set: { ownerId, projectId, order: scene.order, status: 'READY', prompt: subject, preset: 'wikimedia', file, seconds: 0, error: null, credit: creditLine(photo), sourceUrl: photo.pageUrl, downgradedFrom: null, cached: false },
        $setOnInsert: { promptEdited: false, seed: 0, attempt: 0 },
      }, { upsert: true });
      attached++;
    } catch { /* keep the AI / stock path for this scene */ }
  }
  return attached;
}
