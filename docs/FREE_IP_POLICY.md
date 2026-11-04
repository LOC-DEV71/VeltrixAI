# Kiểm soát tài khoản Free theo IP

Quy tắc xác nhận ngày 04/10/2026: tối đa 3 tài khoản Free **duy nhất** / IP / tháng; Credit riêng từng tài khoản. Cửa sổ tháng dùng UTC `YYYY-MM`, giống lịch cấp Credit hiện tại. Không thay đổi CreditService, ví trả phí, TTS, content hoặc phiên đang tồn tại.

## Xác thực và atomic

Google và OTP đã xác minh dùng chung `admitVerifiedAccount`. IP lấy từ `req.ip` do Express áp dụng cấu hình `TRUST_PROXY`; không tự tin cậy header X-Forwarded-For. IPv4, IPv4-mapped IPv6 và IPv6 được chuẩn hóa. Hệ thống không dùng một IP “unknown” chung khi mất thông tin kết nối.

Sau xác minh, transaction đọc tài khoản, kiểm tra gói và ghi liên kết vào `FreeIpWindow` của IP/tháng. Mỗi lượt Free ghi cùng một document để MongoDB phát hiện xung đột, rồi retry transaction; kiểm tra số lượng và tạo user/workspace/project nằm trong cùng transaction. Lượt vượt giới hạn ghi lịch sử và cờ nghi vấn, commit, rồi trả HTTP 403 `FREE_IP_ACCOUNT_LIMIT`. Không đi vào bước cấp Credit, tạo Session hay đặt cookie access/refresh. Đăng ký bị từ chối không tạo tài khoản mồ côi.

Gói trả phí thủ công tiếp tục theo cách nhận diện gói hiện tại. Gói mua qua thanh toán được miễn khi còn đơn trả phí hiệu lực (bao gồm đơn khác còn hạn), có hỗ trợ đơn cũ lưu thời hạn trên user. Không đặt lại hay thu hồi Credit của gói trả phí.

Lượt lỗi xác minh Google/OTP không tạo liên kết hay cờ nghi vấn. Refresh/session hiện hữu không chạy lại giới hạn đăng nhập này. Tháng mới có danh sách mới, nhưng lịch sử và cờ theo dõi tháng trước được giữ. Không backfill IP từ các session cũ vì chúng chưa lưu IP đáng tin cậy.

MongoDB phải hỗ trợ transactions (replica set/Atlas, như nghiệp vụ thanh toán hiện tại). Cần cấu hình proxy đúng đường truyền triển khai: mặc định `TRUST_PROXY=false` bỏ qua forwarded headers; chỉ tin cậy proxy thực sự đứng trước backend. Khi xác định IP hoặc transaction thất bại, không cấp session mới.

## Lịch sử và admin

`FreeIpDenial` lưu IP, tháng, user ID nếu tài khoản tồn tại, email đã xác minh, thời điểm, số tài khoản liên kết, lý do và loại đăng nhập/đăng ký. Không lưu token Google hoặc OTP. ID sự kiện là hash của IP/tháng/email/định danh lượt xác minh (hash credential Google hoặc challenge OTP); retry cùng lượt xác minh không nhân bản lịch sử/thông báo. Lượt xác minh mới tạo sự kiện mới.

Các endpoint yêu cầu phiên admin và `users.read`:

- `GET /api/admin/users/ip-networks?month=YYYY-MM&ip=...&page=1`: IP/tháng, tối đa 10 dòng.
- `GET /api/admin/users/ip-history?ip=...&month=YYYY-MM&page=1`: tài khoản liên kết và lịch sử IP/tháng, 10 lượt từ chối/trang.
- `GET /api/admin/users/ip-history?page=1`: lịch sử toàn hệ thống, 10 sự kiện/trang, dùng để phục hồi thông báo sau mất kết nối.
- `GET /api/admin/users?search=IP`: tài khoản đã liên kết trong tháng hiện tại; tìm email/tên/ID tiếp tục hoạt động.

Namespace `/admin-security`, sự kiện `security:free-ip`: xác thực cookie admin, kiểm tra origin và quyền `users.read` khi kết nối và trước mỗi lần phát. Cờ “Nghi vấn spam tài khoản” chỉ theo dõi; tài khoản đã liên kết vẫn đăng nhập được. Admin xem lịch sử theo tháng trong Người dùng → Kiểm soát tài khoản Free theo IP, hoặc mở từ chuông cảnh báo/header. Hồ sơ user có 10 liên kết IP gần nhất và lối vào tra cứu.

Thông báo client dùng một hộp trắng cố định góc dưới phải, không overlay, không timeout, không đóng bằng Escape hay click bên ngoài; chỉ nút X đóng. Không chứa dữ liệu tài khoản khác. Hiện chưa có kênh hỗ trợ chính thức: không hiển thị link/email; chỉ bật `VITE_SUPPORT_ENABLED=true` sau khi `/support` thực sự hoạt động.

## Kiểm thử

`npm run build` tại backend, sau đó `node --test tests/free-ip-policy.test.cjs` kiểm tra transaction đồng thời, Google/OTP đã xác minh, không cấp session/cookie khi từ chối, đăng ký không tạo user mồ côi, gói trả phí, đổi tháng, chuẩn hóa/trust proxy, realtime và quyền admin, dedupe và phân trang.

`node apps/web-admin/tests/free-ip-browser.cjs` kiểm tra cảnh báo client qua luồng đăng nhập thật của UI với API fixture, chỉ đóng bằng X, responsive; tra cứu/lịch sử IP, liên kết user, retry và phân trang admin. Fixture chỉ ở kiểm thử, không dùng trong ứng dụng.

Kết quả: build/typecheck backend, Admin và client (kèm prerender) thành công. 16 kiểm thử backend cho IP, danh tính user và tài chính thành công; kiểm thử Chromium client/Admin thành công ở 1440/820/390px. Lint các module mới không có lỗi; toàn bộ LandingPage còn 10 lỗi Rules of Hooks có sẵn trong bản HEAD trước thay đổi này. Không sửa hệ thống animation của landing trong nhiệm vụ IP.

## Các phần thay đổi

- Backend: models/FreeIpPolicy, services/FreeIpPolicy, AuthController, AdminIpPolicyController, AdminUserController, routes/adminUsers, BillingRealtime.
- Admin: AdminSecurityBell, IpAccountMonitor, UserManagement, AdminShell, userMessages.
- Client: FreeIpNotice/CSS, helper freeIpPolicy/supportUrl, AuthContext, LoginPage; link hỗ trợ tại Sidebar/Docs/Policies và contactPoint trên LandingPage lấy từ env.
- Tài liệu: AUTH_AND_PERMISSIONS và báo cáo này; các file env của backend/client/TTS, cùng env.example backend/client/Admin/worker/TTS được thêm comment tiếng Việt theo từng key. Giá trị env thật giữ nguyên; mẫu client sửa URL gốc API về `/api` và bổ sung APP_URL/GOOGLE_CLIENT_ID.

`VITE_APP_URL=http://localhost:5173` là địa chỉ client; `VITE_SUPPORT_URL=http://localhost:5175` là địa chỉ ứng dụng Support riêng. Không phải biến cùng mục đích. Các key VITE_ công khai trong bundle, không dùng để chứa token dịch vụ/secret thanh toán.
