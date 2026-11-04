const path = require('path');
const mongoose = require('mongoose');
const { chromium } = require(path.resolve(__dirname, '../../web-client/node_modules/playwright'));
require('dotenv').config();

const ARTIFACT_DIR = 'C:/Users/lamch/.gemini/antigravity/brain/2b4aa894-98f1-479b-ab37-f72c589e9f48';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const { User } = require('../dist/models/User');
  const { Session } = require('../dist/models/Session');
  const user = await User.findOne({ status: 'ACTIVE' });
  const session = await Session.create({
    userId: user._id,
    tokenFamily: 'family-verify-font',
    refreshTokenHash: 'hash',
    userAgent: 'playwright',
    ipAddress: '127.0.0.1',
    expiresAt: new Date(Date.now() + 24 * 3600_000),
  });

  const { signAccessToken } = require('../dist/utils/jwt');
  const token = signAccessToken({ sessionId: session._id.toString() });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await context.addCookies([{ name: 'accessToken', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();

  console.log('Capturing /auto-video with font and link updates...');
  await page.goto('http://localhost:5173/auto-video');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'autovideo_fixed_font_link.png') });

  const connectBtn = page.locator('a[href="/account/settings"]:has-text("Kết nối YouTube")');
  const isLink = (await connectBtn.count()) > 0;
  console.log('Is connect button an <a> link to /account/settings?', isLink);

  await Session.deleteOne({ _id: session._id });
  await browser.close();
  await mongoose.disconnect();
}

run().catch(console.error);

