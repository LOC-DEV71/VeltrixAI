import { chromium } from '@playwright/test';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, 'dist');

if (!fs.existsSync(distDir)) {
  console.error("Vui lòng chạy 'npm run build' hoặc 'vite build' trước khi prerender.");
  process.exit(1);
}

const routes = [
  '/',
  '/pricing',
  '/chinh-sach-dieu-khoan',
  '/developer',
  '/docs',
  '/voices'
];

// Load environment variables
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '.env.local'), override: true });

const baseUrl = process.env.VITE_APP_URL || 'https://veltrix.ai';
const appShell = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');

async function launchBrowser() {
  if (process.env.VERCEL && process.platform === 'linux') {
    const { default: serverlessChromium } = await import('@sparticuz/chromium');
    return chromium.launch({
      headless: true,
      args: serverlessChromium.args,
      executablePath: await serverlessChromium.executablePath(),
    });
  }
  return chromium.launch({ headless: true });
}

async function run() {
  const app = express();
  
  // Phục vụ file tĩnh từ thư mục dist, nếu không tìm thấy fallback về index.html
  // Serve the original SPA shell for every route, never an earlier prerender.
  app.get(routes, (_req, res) => res.type('html').send(appShell));
  app.use(express.static(distDir));
  app.use((req, res) => {
    res.type('html').send(appShell);
  });
  
  const server = app.listen(0, '127.0.0.1');
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const port = server.address().port;
    console.log('Khởi động Playwright...');
    browser = await launchBrowser();
    
    for (const route of routes) {
      console.log(`Đang prerender: ${route}`);
      const page = await browser.newPage();
      
      try {
        await page.goto(`http://localhost:${port}${route}`, { waitUntil: 'networkidle' });
        
        // Chờ React render nội dung vào #root (kiểm tra có child nodes)
        await page.waitForFunction(() => {
          const root = document.getElementById('root');
          return root && root.innerHTML.trim().length > 50;
        }, { timeout: 10000 });
        
        const html = await page.content();
        
        const routePath = route === '/' ? '/index.html' : `${route}/index.html`;
        const fullPath = path.join(distDir, routePath);
        
        // Đảm bảo thư mục tồn tại
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(fullPath, html);
        console.log(`Đã lưu ${routePath}`);
      } catch (err) {
        console.error(`Lỗi khi prerender ${route}:`, err.message);
        throw err;
      } finally {
        await page.close();
      }
    }
    
    console.log('\nTạo Sitemap & Robots.txt...');
    generateSitemap(routes);
    generateRobotsTxt();
    console.log('Hoàn thành Prerender!');
  } finally {
    try {
      await browser?.close();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

function generateSitemap(urls) {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;
  for (const route of urls) {
    const isHome = route === '/';
    const loc = isHome ? baseUrl : `${baseUrl}${route}`;
    xml += `  <url>
    <loc>${loc}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>${isHome ? 'daily' : 'weekly'}</changefreq>
    <priority>${isHome ? '1.0' : '0.8'}</priority>
  </url>
`;
  }
  xml += `</urlset>`;
  fs.writeFileSync(path.join(distDir, 'sitemap.xml'), xml);
}

function generateRobotsTxt() {
  const txt = `User-agent: *
Allow: /
Disallow: /workspace
Disallow: /content
Disallow: /tts
Disallow: /account
Disallow: /login

Sitemap: ${baseUrl}/sitemap.xml
`;
  fs.writeFileSync(path.join(distDir, 'robots.txt'), txt);
}

run().catch((err) => {
  console.error('Prerender failed:', err.message);
  process.exitCode = 1;
});
