const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { fallbackQuery, sanitizeHighlight, sanitizeQuery, parsePlan, planScenes } = require('../dist/services/VideoPlanning');
const { downloadImage, downloadVideo, pickVideoFile, PexelsProvider, generatedBackground, createStockProvider } = require('../dist/providers/StockMediaProvider');
const { mkdtempSync, readdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

afterEach(() => mock.restoreAll());
const scene = { narration: 'Nếu Trái Đất ngừng quay, gió sẽ thổi với tốc độ 1.600 km/h.', imagePrompt: 'Cinematic shot of the Earth stopping rotation, violent winds, --ar 9:16' };

test('fallback query comes from the English image prompt without flags or filler words', () => {
  assert.equal(fallbackQuery(scene), 'earth stopping rotation violent winds');
  assert.equal(fallbackQuery({ narration: 'x', imagePrompt: '' }), 'abstract background');
  assert.equal(fallbackQuery({ narration: 'x', imagePrompt: 'Phố cổ Hà Nội ban đêm' }), 'pho co ha noi ban'); // diacritics stripped
});

test('highlight must literally appear in narration and be short', () => {
  assert.equal(sanitizeHighlight('ngừng quay', scene.narration), 'ngừng quay');
  assert.equal(sanitizeHighlight('NGỪNG QUAY', scene.narration), 'NGỪNG QUAY');
  assert.equal(sanitizeHighlight('mặt trăng', scene.narration), '');
  assert.equal(sanitizeHighlight('gió sẽ thổi với tốc độ', scene.narration), ''); // > 4 words
  assert.equal(sanitizeHighlight(42, scene.narration), '');
});

test('queries must be plain Latin keywords, otherwise fall back', () => {
  assert.equal(sanitizeQuery('Planet Earth storm', scene), 'planet earth storm');
  assert.equal(sanitizeQuery('Trái Đất', scene), fallbackQuery(scene));
  assert.equal(sanitizeQuery('<script>', scene), fallbackQuery(scene));
});

test('parsePlan tolerates prose, missing items and bad JSON', () => {
  const plans = parsePlan('Kết quả: [{"highlightWord":"ngừng quay","imageQuery":"earth wind"}]', [scene, scene]);
  assert.deepEqual(plans[0], { highlightWord: 'ngừng quay', imageQuery: 'earth wind' });
  assert.deepEqual(plans[1], { highlightWord: '', imageQuery: fallbackQuery(scene) });
  assert.equal(parsePlan('not json', [scene])[0].imageQuery, fallbackQuery(scene));
});

test('planScenes falls back when the provider fails or is absent, and keeps narration as JSON data', async () => {
  const failing = { identity: { kind: 'gemini', model: 'x' }, generate: async () => { throw new Error('down'); } };
  assert.deepEqual(await planScenes(failing, [scene]), { plans: [{ highlightWord: '', imageQuery: fallbackQuery(scene) }], usedAi: false });
  assert.equal((await planScenes(null, [scene])).usedAi, false);
  let prompt = '';
  const ok = { identity: { kind: 'gemini', model: 'x' }, generate: async (r) => { prompt = r.prompt; return { text: '[{"highlightWord":"gió","imageQuery":"strong wind"}]' }; } };
  const result = await planScenes(ok, [scene]);
  assert.equal(result.usedAi, true);
  assert.equal(result.plans[0].highlightWord, 'gió');
  assert.ok(prompt.includes(JSON.stringify(scene.narration).slice(1, -1)));
});

test('image download only from Pexels CDN over https, with type checks', async () => {
  await assert.rejects(() => downloadImage('https://evil.example.com/a.jpg'), /STOCK_HOST_NOT_ALLOWED/);
  await assert.rejects(() => downloadImage('http://images.pexels.com/a.jpg'), /STOCK_HOST_NOT_ALLOWED/);
  mock.method(globalThis, 'fetch', async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  await assert.rejects(() => downloadImage('https://images.pexels.com/a.jpg'), /STOCK_TYPE_NOT_ALLOWED/);
});

test('Pexels search skips excluded photos, sends the key, and records credit', async () => {
  const calls = [];
  mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), auth: init?.headers?.Authorization });
    if (String(url).startsWith('https://api.pexels.com/')) return Response.json({ photos: [
      { id: 1, photographer: 'A', photographer_url: 'https://www.pexels.com/@a', url: 'https://www.pexels.com/photo/1', src: { original: 'https://images.pexels.com/photos/1/a.jpeg' } },
      { id: 2, photographer: 'B', photographer_url: 'https://www.pexels.com/@b', url: 'https://www.pexels.com/photo/2', src: { original: 'https://images.pexels.com/photos/2/b.jpeg' } },
    ] });
    return new Response(Buffer.from([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  });
  const image = await new PexelsProvider('test-key').search('earth wind', 'portrait', 1080, 1920, new Set(['1']));
  assert.equal(image.providerId, '2');
  assert.equal(image.credit.photographer, 'B');
  assert.equal(calls[0].auth, 'test-key');
  assert.ok(calls[0].url.includes('orientation=portrait'));
  assert.ok(calls[1].url.startsWith('https://images.pexels.com/photos/2/b.jpeg?') && calls[1].url.includes('w=1080') && calls[1].url.includes('h=1920'));
});

test('generated background is a valid SVG and provider is optional', () => {
  const bg = generatedBackground(7, 1080, 1920);
  assert.equal(bg.extension, 'svg');
  assert.ok(bg.bytes.toString().startsWith('<svg'));
  assert.equal(createStockProvider({}), null);
  assert.ok(createStockProvider({ PEXELS_API_KEY: 'k' }) instanceof PexelsProvider);
});

test('video download only from the Pexels video CDN, mp4 only', async () => {
  await assert.rejects(() => downloadVideo('https://player.vimeo.com/x.mp4'), /STOCK_HOST_NOT_ALLOWED/);
  await assert.rejects(() => downloadVideo('http://videos.pexels.com/x.mp4'), /STOCK_HOST_NOT_ALLOWED/);
  mock.method(globalThis, 'fetch', async () => new Response('x', { status: 200, headers: { 'content-type': 'text/html' } }));
  await assert.rejects(() => downloadVideo('https://videos.pexels.com/video-files/1/a.mp4'), /STOCK_TYPE_NOT_ALLOWED/);
});

test('picks the portrait mp4 closest to the frame width without going far above it', () => {
  const files = [
    { file_type: 'video/mp4', width: 2160, height: 3840, link: 'https://videos.pexels.com/4k.mp4' },
    { file_type: 'video/mp4', width: 1080, height: 1920, link: 'https://videos.pexels.com/hd.mp4' },
    { file_type: 'video/mp4', width: 540, height: 960, link: 'https://videos.pexels.com/sd.mp4' },
    { file_type: 'video/mp4', width: 1920, height: 1080, link: 'https://videos.pexels.com/landscape.mp4' },
    { file_type: 'video/webm', width: 1080, height: 1920, link: 'https://videos.pexels.com/hd.webm' },
  ];
  assert.equal(pickVideoFile(files, 'portrait', 1080).link, 'https://videos.pexels.com/hd.mp4');
  assert.equal(pickVideoFile(files, 'landscape', 1920).link, 'https://videos.pexels.com/landscape.mp4');
  assert.equal(pickVideoFile(files.slice(0, 1), 'portrait', 1080).link, 'https://videos.pexels.com/4k.mp4'); // only option
  assert.equal(pickVideoFile([], 'portrait', 1080), null);
});

test('video search skips short and excluded clips, and the disk cache avoids repeat requests', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'stock-cache-'));
  const calls = [];
  mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('https://api.pexels.com/videos/search')) return Response.json({ videos: [
      { id: 10, duration: 2, url: 'https://www.pexels.com/video/10', user: { name: 'Short', url: 'u' }, video_files: [{ file_type: 'video/mp4', width: 1080, height: 1920, link: 'https://videos.pexels.com/10.mp4' }] },
      { id: 11, duration: 12, url: 'https://www.pexels.com/video/11', user: { name: 'Excluded', url: 'u' }, video_files: [{ file_type: 'video/mp4', width: 1080, height: 1920, link: 'https://videos.pexels.com/11.mp4' }] },
      { id: 12, duration: 9, url: 'https://www.pexels.com/video/12', user: { name: 'Mai', url: 'https://www.pexels.com/@mai' }, video_files: [{ file_type: 'video/mp4', width: 1080, height: 1920, link: 'https://videos.pexels.com/12.mp4' }] },
    ] });
    return new Response(Buffer.from('mp4-bytes'), { status: 200, headers: { 'content-type': 'video/mp4' } });
  });
  try {
    const stock = new PexelsProvider('test-key', cacheDir);
    const first = await stock.searchVideo('galaxy', 'portrait', 1080, new Set(['11']));
    assert.equal(first.providerId, '12');
    assert.equal(first.source, 'PEXELS_VIDEO');
    assert.equal(first.credit.photographer, 'Mai');
    assert.equal(first.bytes.toString(), 'mp4-bytes');
    assert.ok(calls[0].includes('orientation=portrait'));
    const again = await stock.searchVideo('galaxy', 'portrait', 1080, new Set(['11']));
    assert.equal(again.providerId, '12');
    assert.equal(calls.length, 2, 'second search served from cache'); // 1 search + 1 download in total
    assert.equal(readdirSync(cacheDir).length, 2);
  } finally { rmSync(cacheDir, { recursive: true, force: true }); }
});
