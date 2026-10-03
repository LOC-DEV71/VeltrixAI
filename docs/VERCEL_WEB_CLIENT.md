# Deploy web-client lên Vercel

Thiết lập project:

- Root Directory: `apps/web-client`.
- Framework: Vite.
- Node.js: 24.x.
- Install Command: `npm ci --include=dev`.
- Build Command: `npm run build`.
- Output Directory: `dist`.

Các lệnh được khai báo trong `apps/web-client/vercel.json`. Nếu dashboard đang có override cũ, bỏ override hoặc đặt đúng các giá trị trên. Commit cả `package.json`, `package-lock.json`, `prerender.mjs` và `vercel.json`, sau đó redeploy.

Client được cài độc lập bằng npm trên Vercel. Giữ cấu hình pnpm hiện có của các ứng dụng khác. Không tạo lại lockfile npm từ `node_modules` chứa symlink pnpm trên máy local.

## Biến môi trường

- `VITE_APP_URL`: URL public của frontend, dùng trong sitemap.
- `VITE_API_URL`: URL HTTPS của backend, bao gồm prefix `/api` theo contract hiện tại.
- `VITE_GOOGLE_CLIENT_ID`: Google OAuth client ID của môi trường deploy.

Frontend mặc định trỏ API tới localhost nếu thiếu `VITE_API_URL`. Deploy frontend này không deploy backend, worker, TTS hay Gemma. Cấu hình origin frontend trong CORS và OAuth của hệ thống đang chạy.

## Prerender

Build tạo HTML cho `/`, `/pricing`, `/chinh-sach-dieu-khoan`, `/developer`, `/docs`, `/voices`, cùng sitemap và robots.txt. Trên Linux Vercel, script dùng Chromium đóng gói bởi `@sparticuz/chromium`, chỉ phục vụ build; không đưa Chromium vào bundle client.

Prerender giữ một browser context và một page xuyên suốt các route, rồi đóng browser ở cuối. Loại bỏ cờ `--single-process` của Chromium đóng gói để tránh crash khi chuyển hoặc đóng context. Không tạo/đóng context ẩn bằng `browser.newPage()` cho từng route.

Workflow `.github/workflows/web-client-build.yml` chạy typecheck và build trên Linux với `VERCEL=1`, dùng Chromium đóng gói như nhánh build Vercel và kiểm tra đủ 6 file HTML. Workflow chỉ kiểm thử, không deploy. Runner Ubuntu không hoàn toàn giống build image của Vercel; kết quả deployment vẫn cần kiểm tra trên Vercel.

Lỗi prerender làm build thất bại và script đóng browser/server khi kết thúc. Backend lỗi hoặc chưa cấu hình vẫn hiển thị trạng thái hiện có của ứng dụng; script không tạo dữ liệu thay thế.

Để prerender trên máy local sau khi cài dependency:

```sh
npm run prerender:install
npm run typecheck
npm run build
```

Sau deploy, kiểm tra truy cập trực tiếp `/login`, `/workspace`, `/content/scenes` và các trang public. Rewrite SPA trong `vercel.json` hỗ trợ mở đường dẫn trực tiếp.

Tài liệu tham khảo: [Vercel Project Configuration](https://vercel.com/docs/project-configuration), [Chromium với Playwright](https://github.com/Sparticuz/chromium#usage-with-playwright), [Playwright browser installation](https://playwright.dev/docs/browsers).
