const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

process.env.YOUTUBE_CLIENT_ID = 'test-client-id';
process.env.YOUTUBE_CLIENT_SECRET = 'test-client-secret';
process.env.YOUTUBE_REDIRECT_URI = 'http://localhost:3001/api/youtube/callback';
process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY = 'c'.repeat(64);
process.env.YOUTUBE_CLIENT_URL = 'http://localhost:5173';
process.env.YOUTUBE_DAILY_UPLOADS = '3';
process.env.JWT_SECRET = 'test-jwt-secret-long-enough-32-chars';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test-yt-routes';

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const { User } = require('../dist/models/User');
const { Session } = require('../dist/models/Session');
const { YouTubeConnection, YouTubeOAuthState } = require('../dist/models/YouTubeConnection');
const youtubeRoutes = require('../dist/routes/youtube').default;
const { savePlan, seedConfig } = require('../dist/services/PlanService');
const { signAccessToken } = require('../dist/utils/jwt');

let replica, app, testUser, authCookies, csrfToken;

before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replica.getUri());
  await Promise.all([User, Session, YouTubeConnection, YouTubeOAuthState].map((m) => m.init()));
  await savePlan('PRO', seedConfig('PRO'), 0, null, 'YouTube route fixtures', true);

  testUser = await User.create({
    email: 'creator@example.com',
    passwordHash: 'hash',
    displayName: 'Creator',
    plan: 'PRO',
    status: 'ACTIVE',
  });

  const session = await Session.create({
    userId: testUser._id,
    tokenFamily: 'family-1',
    refreshTokenHash: 'hash',
    userAgent: 'test-agent',
    ipAddress: '127.0.0.1',
    expiresAt: new Date(Date.now() + 24 * 3600_000),
  });

  const token = signAccessToken({ sessionId: session._id.toString() }, '1h');
  csrfToken = 'd'.repeat(64);
  authCookies = [`accessToken=${token}`, `csrfToken=${csrfToken}`];

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/youtube', youtubeRoutes);
});

after(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

afterEach(() => mock.restoreAll());

test('GET /api/youtube/status when not connected returns 200 with NOT_CONNECTED and never 500', async () => {
  const res = await request(app)
    .get('/api/youtube/status')
    .set('Cookie', authCookies);

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.configured, true);
  assert.equal(res.body.data.status, 'NOT_CONNECTED');
  assert.equal(res.body.data.connected, false);
  assert.equal(res.body.data.needsReauth, false);
  assert.equal(res.body.data.channelTitle, null);
  assert.equal(res.body.data.channelAvatar, null);
  assert.equal(res.body.data.dailyLimit, 3);
  assert.equal(res.body.data.remainingToday, 3);
  assert.equal('refreshTokenEncrypted' in res.body.data, false);
  assert.equal('token' in res.body.data, false);
});

test('GET /api/youtube/auth-url generates valid Google OAuth URL with offline access and prompt consent', async () => {
  const res = await request(app)
    .get('/api/youtube/auth-url?returnPath=/account/settings')
    .set('Cookie', authCookies);

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.data.url);

  const parsedUrl = new URL(res.body.data.url);
  assert.equal(parsedUrl.origin, 'https://accounts.google.com');
  assert.equal(parsedUrl.pathname, '/o/oauth2/v2/auth');
  assert.equal(parsedUrl.searchParams.get('client_id'), 'test-client-id');
  assert.equal(parsedUrl.searchParams.get('access_type'), 'offline');
  assert.equal(parsedUrl.searchParams.get('prompt'), 'consent');
  assert.ok(parsedUrl.searchParams.get('state'));
  assert.ok(parsedUrl.searchParams.get('code_challenge'));
  assert.ok(parsedUrl.searchParams.get('scope').includes('youtube.upload'));
  assert.ok(parsedUrl.searchParams.get('scope').includes('youtube.readonly'));

  // Verify server-side state was saved
  const stateEntry = await YouTubeOAuthState.findOne({ ownerId: testUser._id });
  assert.ok(stateEntry);
  assert.equal(stateEntry.returnPath, '/account/settings');
});

test('POST /api/youtube/disconnect successfully disconnects and removes connection', async () => {
  // Simulate active connection
  await YouTubeConnection.create({
    ownerId: testUser._id,
    channelId: 'UC123',
    channelTitle: 'My Channel',
    channelAvatar: 'https://example.com/avatar.png',
    refreshTokenEncrypted: 'mock-encrypted-token',
    scopes: ['https://www.googleapis.com/auth/youtube.upload'],
    status: 'ACTIVE',
    connectedAt: new Date(),
  });

  const res = await request(app)
    .post('/api/youtube/disconnect')
    .set('Cookie', authCookies)
    .set('x-csrf-token', csrfToken);

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.connected, false);

  const exists = await YouTubeConnection.exists({ ownerId: testUser._id });
  assert.equal(exists, null);
});

test('GET /api/youtube/callback with invalid/expired state redirects with ?youtube=error&reason=invalid_state', async () => {
  const res = await request(app)
    .get('/api/youtube/callback?state=non-existent-state&code=any-code');

  assert.equal(res.status, 302);
  const location = new URL(res.headers.location);
  assert.equal(location.searchParams.get('youtube'), 'error');
  assert.equal(location.searchParams.get('reason'), 'invalid_state');
});
