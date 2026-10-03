# Thông báo thanh toán qua Socket.IO

Backend phục vụ Socket.IO trên `/socket.io`, cùng cổng với API. Hai namespace:

- `/admin-billing`: xác thực cookie `adminAccessToken`, chỉ OWNER/ADMIN.
- `/billing`: xác thực cookie `accessToken`, chỉ nhận đơn của chính tài khoản.

Sự kiện `billing:order` gồm mã đơn, trạng thái, tên gói, số tiền, chu kỳ,
môi trường thử nghiệm/thực tế và ngày giao dịch. Không gửi token, thông tin
thẻ, cấu hình provider hoặc toàn bộ snapshot. Admin nhận thêm ID chủ đơn.
Room được backend xác định; client không được tự chọn room.

Đơn mới thông báo trạng thái PENDING. PAID/FAILED chỉ phát sau khi IPN VNPay
đã được kiểm tra và transaction MongoDB commit. IPN lặp không phát lại.
Phiên và quyền được kiểm tra lại trước mỗi thông báo và định kỳ khi kết nối.

Chuông admin hiển thị 10 thanh toán thành công gần nhất và số thông báo mới
nhận trong phiên đang mở. Bảng tài chính tự tải lại theo sự kiện. Client tải
lại thông báo, credit và gói. Kết nối lại sẽ tải lịch sử từ database;
HTTP kiểm tra định kỳ bổ sung cho trường hợp mất kết nối/sự kiện.

## Deploy

- Proxy cả `/api` và `/socket.io` về backend, bật WebSocket upgrade.
- `CORS_ORIGINS` phải có đúng origin HTTPS của client và admin; không dùng `*`.
- Cookie phải được gửi đến backend theo cấu hình domain/SameSite hiện có.
- Bản này dùng một tiến trình API. Nếu chạy nhiều replica API, cần adapter
  pub/sub dùng chung trước khi chia traffic realtime giữa các replica.
  Lịch sử database vẫn là nguồn dữ liệu để khôi phục khi reconnect.

Kiểm thử: build backend rồi chạy `node --test tests/billing.test.cjs` tại
`apps/backend-api`. Kiểm thử dùng database tạm, không tạo thanh toán thật.
