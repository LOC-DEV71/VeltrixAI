const path = require('path');
const mongoose = require('mongoose');
const { chromium } = require(path.resolve(__dirname, '../../web-client/node_modules/playwright'));
require('dotenv').config();

const ARTIFACT_DIR = 'C:/Users/lamch/.gemini/antigravity/brain/2b4aa894-98f1-479b-ab37-f72c589e9f48';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const { User } = require('../dist/models/User');
  const { Session } = require('../dist/models/Session');
  const { YouTubeConnection } = require('../dist/models/YouTubeConnection');

  const user = await User.findOne({ status: 'ACTIVE' });
  if (!user) throw new Error('No user');

  const session = await Session.create({
    userId: user._id,
    tokenFamily: 'family-screenshot-2',
    refreshTokenHash: 'hash',
    userAgent: 'playwright',
    ipAddress: '127.0.0.1',
    expiresAt: new Date(Date.now() + 24 * 3600_000),
  });

  const { signAccessToken } = require('../dist/utils/jwt');
  const token = signAccessToken({ sessionId: session._id.toString() });

  // Clean any old connection for clean state 1
  await YouTubeConnection.deleteMany({ ownerId: user._id });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1600 },
  });

  await context.addCookies([
    {
      name: 'accessToken',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const page = await context.newPage();

  console.log('1. Capturing AutoVideo form (not connected)...');
  await page.goto('http://localhost:5173/auto-video');
  await page.waitForTimeout(2000);
  const fieldset = page.locator('fieldset:has-text("Xuất bản YouTube")');
  await fieldset.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'yt_autovideo_fieldset_not_connected.png') });

  console.log('2. Capturing AutoVideo form (connected)...');
  await YouTubeConnection.create({
    ownerId: user._id,
    channelId: 'UC_TEST_CHANNEL_123',
    channelTitle: 'Creator AI Studio Việt Nam',
    channelAvatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150',
    refreshTokenEncrypted: 'mock_encrypted_refresh_token',
    scopes: ['https://www.googleapis.com/auth/youtube.upload'],
    status: 'ACTIVE',
    connectedAt: new Date(),
  });

  await page.goto('http://localhost:5173/auto-video');
  await page.waitForTimeout(2000);
  const fieldsetConn = page.locator('fieldset:has-text("Xuất bản YouTube")');
  await fieldsetConn.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'yt_autovideo_fieldset_connected.png') });

  // Clean up
  await YouTubeConnection.deleteMany({ ownerId: user._id });
  await Session.deleteOne({ _id: session._id });
  await browser.close();
  await mongoose.disconnect();
  console.log('Extra screenshots captured!');
}

main().catch(console.error);
