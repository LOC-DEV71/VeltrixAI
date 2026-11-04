const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
process.env.YOUTUBE_CLIENT_ID = 'client-id';
process.env.YOUTUBE_CLIENT_SECRET = 'client-secret';
process.env.YOUTUBE_REDIRECT_URI = 'http://localhost:3001/api/youtube/callback';
process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.YOUTUBE_CLIENT_URL = 'http://localhost:5173';
process.env.YOUTUBE_DAILY_UPLOADS = '2';
const mongoose = require('mongoose');
const crypto = require('crypto');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { User } = require('../dist/models/User');
const { Job } = require('../dist/models/Job');
const { Video } = require('../dist/models/Video');
const { Scene } = require('../dist/models/Scene');
const { YouTubeConnection, YouTubeOAuthState } = require('../dist/models/YouTubeConnection');
const { savePlan, seedConfig } = require('../dist/services/PlanService');
const yt = require('../dist/providers/YouTubeProvider');
const svc = require('../dist/services/YouTubePublishService');

let replica, storageDir;
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replica.getUri());
  await Promise.all([User, Job, Video, YouTubeConnection, YouTubeOAuthState].map((m) => m.init()));
  await savePlan('PRO', seedConfig('PRO'), 0, null, 'YouTube test fixtures', true);
  storageDir = mkdtempSync(join(tmpdir(), 'yt-store-'));
});
after(async () => { await mongoose.disconnect(); await replica?.stop(); rmSync(storageDir, { recursive: true, force: true }); });
afterEach(() => mock.restoreAll());

const config = () => yt.getYouTubeConfig();
const user = () => User.create({ email: crypto.randomUUID() + '@example.invalid', displayName: 'YT test', plan: 'PRO' });
async function connected(owner, refreshToken = 'refresh-1') {
  await YouTubeConnection.create({ ownerId: owner, channelId: 'UC1', channelTitle: 'Kênh thử', refreshTokenEncrypted: yt.encryptToken(refreshToken, config().encryptionKey), scopes: yt.YOUTUBE_SCOPES, status: 'ACTIVE', connectedAt: new Date() });
}
async function video(owner) {
  const projectId = new mongoose.Types.ObjectId();
  await Scene.create({ projectId, order: 1, title: 'Trái Đất ngừng quay', narration: 'Điều gì sẽ xảy ra nếu Trái Đất ngừng quay?', visualDescription: 'x', estimatedDuration: 3, sourceContentRevision: 1 });
  const id = new mongoose.Types.ObjectId();
  writeFileSync(join(storageDir, `${id}.mp4`), Buffer.from('fake mp4 bytes'));
  return Video.create({ _id: id, ownerId: owner, projectId, contentId: new mongoose.Types.ObjectId(), jobId: new mongoose.Types.ObjectId(), contentRevision: 1, aspectRatio: '9:16', width: 1080, height: 1920, fps: 30, durationSeconds: 3, bytes: 14, storageKey: `${id}.mp4`, scenes: [{ sceneId: new mongoose.Types.ObjectId(), order: 1, highlightWord: '', imageQuery: 'earth', imageSource: 'PEXELS', credit: { photographer: 'Nhiếp ảnh A', photographerUrl: 'u', pageUrl: 'p' }, durationSeconds: 3 }] });
}

test('tokens are encrypted with AES-GCM and tampering is detected', () => {
  const key = config().encryptionKey;
  const sealed = yt.encryptToken('secret-refresh', key);
  assert.ok(!sealed.includes('secret-refresh'));
  assert.equal(yt.decryptToken(sealed, key), 'secret-refresh');
  const [iv, data, tag] = sealed.split('.');
  assert.throws(() => yt.decryptToken([iv, data.replace(/^./, (c) => (c === '0' ? '1' : '0')), tag].join('.'), key));
  assert.equal(yt.getYouTubeConfig({}), null);
});

test('connect: PKCE + single-use state, stores only the encrypted refresh token', async () => {
  const owner = (await user())._id;
  const { url } = await svc.startConnect(owner, '/auto-video');
  const params = new URL(url).searchParams;
  assert.equal(params.get('access_type'), 'offline');
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.ok(params.get('scope').includes('youtube.upload'));
  const state = params.get('state');
  const stored = await YouTubeOAuthState.findOne({ ownerId: owner }).lean();
  assert.notEqual(stored.stateHash, state); // only the hash is stored
  assert.equal(params.get('code_challenge'), yt.pkceChallenge(stored.codeVerifier));

  mock.method(globalThis, 'fetch', async (url, init) => {
    const u = String(url);
    if (u === 'https://oauth2.googleapis.com/token') {
      assert.equal(new URLSearchParams(init.body).get('code_verifier'), stored.codeVerifier);
      return Response.json({ access_token: 'access', refresh_token: 'refresh-plain', scope: yt.YOUTUBE_SCOPES.join(' ') });
    }
    if (u.startsWith('https://www.googleapis.com/youtube/v3/channels')) {
      return Response.json({ items: [{ id: 'UCabc', snippet: { title: 'Kênh của tôi', thumbnails: { medium: { url: 'https://example.com/avatar.jpg' } } } }] });
    }
    return new Response('{}');
  });
  assert.equal(await svc.completeConnect(state, 'auth-code', undefined), 'http://localhost:5173/auto-video?youtube=connected');
  const saved = await YouTubeConnection.findOne({ ownerId: owner }).select('+refreshTokenEncrypted').lean();
  assert.equal(saved.channelTitle, 'Kênh của tôi');
  assert.equal(saved.channelAvatar, 'https://example.com/avatar.jpg');
  assert.ok(!saved.refreshTokenEncrypted.includes('refresh-plain'));
  assert.equal(yt.decryptToken(saved.refreshTokenEncrypted, config().encryptionKey), 'refresh-plain');
  // Replaying the same state fails.
  assert.equal(await svc.completeConnect(state, 'auth-code', undefined), 'http://localhost:5173/auto-video?youtube=error&reason=invalid_state');
  const view = await svc.getConnection(owner);
  assert.equal(view.connected, true);
  assert.equal(view.status, 'CONNECTED');
  assert.equal(view.channelAvatar, 'https://example.com/avatar.jpg');
  assert.equal('refreshTokenEncrypted' in view, false);
});

test('connect without the upload scope is rejected and the token revoked', async () => {
  const owner = (await user())._id;
  const state = new URL((await svc.startConnect(owner)).url).searchParams.get('state');
  const revoked = [];
  mock.method(globalThis, 'fetch', async (url) => {
    const u = String(url);
    if (u === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'a', refresh_token: 'r', scope: 'https://www.googleapis.com/auth/youtube.readonly' });
    if (u.startsWith('https://oauth2.googleapis.com/revoke')) { revoked.push(u); return new Response(''); }
    return new Response('{}');
  });
  assert.equal(await svc.completeConnect(state, 'code', undefined), 'http://localhost:5173/auto-video?youtube=error&reason=missing_scope');
  assert.equal(revoked.length, 1);
  assert.equal(await YouTubeConnection.exists({ ownerId: owner }), null);
});

test('checkYouTubeEnv reports missing variables by name only', () => {
  const checkEmpty = yt.checkYouTubeEnv({});
  assert.equal(checkEmpty.ok, false);
  assert.ok(checkEmpty.missing.includes('YOUTUBE_CLIENT_ID'));
  assert.ok(checkEmpty.missing.includes('YOUTUBE_CLIENT_SECRET'));
  assert.ok(checkEmpty.missing.includes('YOUTUBE_REDIRECT_URI'));
  assert.ok(checkEmpty.missing.includes('YOUTUBE_TOKEN_ENCRYPTION_KEY'));

  const checkGood = yt.checkYouTubeEnv({
    YOUTUBE_CLIENT_ID: 'id',
    YOUTUBE_CLIENT_SECRET: 'secret',
    YOUTUBE_REDIRECT_URI: 'http://localhost:3001/api/youtube/callback',
    YOUTUBE_CLIENT_URL: 'http://localhost:5173',
    YOUTUBE_DAILY_UPLOADS: '3',
    YOUTUBE_TOKEN_ENCRYPTION_KEY: 'b'.repeat(64),
  });
  assert.equal(checkGood.ok, true);
  assert.equal(checkGood.missing.length, 0);
});

test('getStartOfDayInVietnam computes 00:00:00 VN time (UTC+7)', () => {
  const sampleUtc = new Date(Date.UTC(2026, 10, 4, 3, 0, 0)); // 10:00 AM VN on Nov 4
  const startOfDay = svc.getStartOfDayInVietnam(sampleUtc);
  // Nov 4 00:00:00 VN is Nov 3 17:00:00 UTC
  assert.equal(startOfDay.toISOString(), '2026-11-03T17:00:00.000Z');
});

test('upload declares synthetic media, not made for kids, and only follows Google upload URLs', async () => {
  const file = join(storageDir, 'upload.mp4'); writeFileSync(file, Buffer.from('0123456789'));
  let metadata;
  mock.method(globalThis, 'fetch', async (url, init) => {
    if (init.method === 'POST') { metadata = JSON.parse(init.body); return new Response('', { status: 200, headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=1' } }); }
    return Response.json({ id: 'yt123', status: { privacyStatus: 'private' } });
  });
  const result = await yt.uploadVideo('token', file, { title: 'T', description: 'D', tags: [], privacy: 'private' });
  assert.equal(result.youtubeVideoId, 'yt123');
  assert.equal(metadata.status.containsSyntheticMedia, true);
  assert.equal(metadata.status.selfDeclaredMadeForKids, false);
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => new Response('', { status: 200, headers: { location: 'https://evil.example.com/x' } }));
  await assert.rejects(() => yt.uploadVideo('token', file, { title: 'T', description: 'D', tags: [], privacy: 'private' }), /YOUTUBE_UPLOAD_FAILED/);
  assert.equal(yt.uploadErrorCode(403, { error: { errors: [{ reason: 'quotaExceeded' }] } }), 'YOUTUBE_QUOTA_EXCEEDED');
});

test('publish job: requires connection, reuses, respects daily limit, and saves the YouTube link', async () => {
  const owner = (await user())._id;
  const v = await video(owner);
  await assert.rejects(() => svc.createYouTubePublishJob(owner, String(v._id), {}), /YOUTUBE_NOT_CONNECTED/);
  await connected(owner);
  const { job } = await svc.createYouTubePublishJob(owner, String(v._id), { privacy: 'public', title: 'Nếu Trái Đất ngừng quay?' });
  assert.equal(job.payload.privacy, 'public');
  assert.ok(job.payload.description.includes('AI'));
  assert.ok(job.payload.description.includes('Nhiếp ảnh A'));
  assert.ok(job.payload.description.includes('#Shorts'));
  assert.equal((await svc.createYouTubePublishJob(owner, String(v._id), {})).reused, true);
  await svc.createYouTubePublishJob(owner, String((await video(owner))._id), {});
  const third = await video(owner);
  await assert.rejects(() => svc.createYouTubePublishJob(owner, String(third._id), {}), /YOUTUBE_DAILY_LIMIT/);

  const claimed = await svc.claimPublishJob(String(job._id));
  let uploadedTitle;
  await svc.processPublishJob(claimed, { config: config(), storageDir, refresh: async (_c, token) => { assert.equal(token, 'refresh-1'); return 'access'; }, upload: async (_t, path, meta) => { uploadedTitle = meta.title; assert.ok(path.endsWith(v.storageKey)); return { youtubeVideoId: 'abc', privacy: 'public' }; } });
  const done = await Job.findById(job._id).lean();
  assert.equal(done.status, 'COMPLETED');
  assert.equal(uploadedTitle, 'Nếu Trái Đất ngừng quay?');
  assert.equal((await Video.findById(v._id).lean()).youtube.url, 'https://www.youtube.com/watch?v=abc');
});

test('revoked Google access marks the connection for re-authorization', async () => {
  const owner = (await user())._id;
  const v = await video(owner);
  await connected(owner);
  const { job } = await svc.createYouTubePublishJob(owner, String(v._id), {});
  await svc.processPublishJob(await svc.claimPublishJob(String(job._id)), { config: config(), storageDir, refresh: async () => { throw new yt.YouTubeError('YOUTUBE_REAUTH_REQUIRED', 401); } });
  assert.equal((await Job.findById(job._id).lean()).error, 'YOUTUBE_REAUTH_REQUIRED');
  assert.equal((await YouTubeConnection.findOne({ ownerId: owner }).lean()).status, 'NEEDS_REAUTH');
  assert.equal((await svc.getConnection(owner)).needsReauth, true);
});

test('scheduled publish: upload is private with publishAt; invalid or past times are refused', async () => {
  // Provider: publishAt forces private (YouTube only schedules private videos).
  const file = join(storageDir, 'sched.mp4'); writeFileSync(file, Buffer.from('0123456789'));
  let resource;
  mock.method(globalThis, 'fetch', async (url, init) => {
    if (init.method === 'POST') { resource = JSON.parse(init.body); return new Response('', { status: 200, headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=2' } }); }
    return Response.json({ id: 'yt9', status: { privacyStatus: 'private' } });
  });
  const at = new Date(Date.now() + 3 * 3600_000).toISOString();
  await yt.uploadVideo('token', file, { title: 'T', description: 'D', tags: [], privacy: 'public', publishAt: at });
  assert.equal(resource.status.privacyStatus, 'private');
  assert.equal(resource.status.publishAt, at);
  mock.restoreAll();

  // Service: validation, payload, and what reaches the uploader.
  assert.equal(svc.parsePublishAt(''), null);
  assert.throws(() => svc.parsePublishAt(new Date(Date.now() + 60_000).toISOString()), /YOUTUBE_PUBLISH_AT_INVALID/);
  assert.throws(() => svc.parsePublishAt('not a date'), /YOUTUBE_PUBLISH_AT_INVALID/);
  const owner = (await user())._id;
  const v = await video(owner);
  await connected(owner);
  await assert.rejects(() => svc.createYouTubePublishJob(owner, String(v._id), { publishAt: new Date(Date.now() - 3600_000).toISOString() }), /YOUTUBE_PUBLISH_AT_INVALID/);
  // Auto runs (lateOk): a time that passed while rendering becomes "in 15 minutes".
  const late = await svc.createYouTubePublishJob(owner, String(v._id), { publishAt: new Date(Date.now() - 3600_000).toISOString(), lateOk: true, playlistId: 'PL1', categoryId: '27' });
  const lateAt = Date.parse(late.job.payload.publishAt);
  assert.ok(lateAt > Date.now() + 14 * 60_000 && lateAt < Date.now() + 16 * 60_000);
  assert.equal(late.job.payload.playlistId, 'PL1');
  assert.equal(late.job.payload.categoryId, '27');
  let meta;
  await svc.processPublishJob(await svc.claimPublishJob(String(late.job._id)), { config: config(), storageDir, refresh: async () => 'access', upload: async (_t, _p, m) => { meta = m; return { youtubeVideoId: 'sch', privacy: 'private' }; }, thumbnail: async () => true, playlist: async () => true });
  assert.ok(Date.parse(meta.publishAt) >= Date.now() + 14 * 60_000);
});
