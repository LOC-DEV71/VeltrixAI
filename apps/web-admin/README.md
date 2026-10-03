# Veltrix Admin

Chạy local: `pnpm --filter web-admin dev` (cổng 5174).

Các đường dẫn: `/`, `/login`, `/users`, `/plans`, `/voices`, `/contents`,
`/jobs`, `/credits`, `/payments`, `/admins`, `/audit`, `/settings`.
Những module chưa triển khai vẫn hiển thị trạng thái “Sắp có”.

Router giữ trang khi tải lại và hỗ trợ lịch sử trình duyệt. Chưa đăng nhập
sẽ chuyển đến `/login`; đăng nhập thành công trở lại trang đã yêu cầu.
Chuyển trang hoặc đóng bảng chỉnh sửa khi có thay đổi chưa lưu sẽ mở modal.
Đóng tab hoặc tải lại sử dụng cảnh báo chuẩn của trình duyệt.

Khi triển khai static build, cấu hình hosting trả `index.html` cho đường dẫn
giao diện chưa có file. Vite dev/preview đã hỗ trợ SPA fallback. Với Nginx:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

Định tuyến `/api/` riêng đến Backend trước SPA fallback. Không trả `index.html`
cho API. Chạy `pnpm --filter web-admin build` để kiểm tra TypeScript và bundle.
