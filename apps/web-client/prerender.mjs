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
const port = 3055;

async function run() {
  console.log(`Bắt đầu chạy server tĩnh trên port ${port}...`);
  const app = express();
  
  // Phục vụ file tĩnh từ thư mục dist, nếu không tìm thấy fallback về index.html
  app.use(express.static(distDir));
  app.use((req, res) => {
    res.sendFile(path.resolve(distDir, 'index.html'));
  });
  
  const server = app.listen(port, async () => {
    console.log('Khởi động Playwright...');
    const browser = await chromium.launch({ headless: true });
    
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
      } finally {
        await page.close();
      }
    }
    
    await browser.close();
    server.close();
    
    console.log('\nTạo Sitemap & Robots.txt...');
    generateSitemap(routes);
    generateRobotsTxt();
    console.log('Hoàn thành Prerender!');
    process.exit(0);
  });
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

run();
