# Xác thực và Phân quyền (Auth & Permissions) - v0.2

## 1. Cơ chế Xác thực (Authentication)

### 1.1. Đăng nhập Google
- Client sử dụng Google Identity Services lấy `credential` token.
- Backend lấy thông tin qua thư viện Google, xác minh tính hợp lệ và trích xuất `sub` làm cơ sở duy nhất (`googleId`).
- `googleId` được đánh Partial Unique Index (chỉ tính những document có chứa trường này).
- **Không tự động liên kết tài khoản**: Nếu email từ Google trùng với email đã đăng ký qua OTP trước đó nhưng chưa có `googleId`, hệ thống không tự merge. Client phải thực hiện luồng "Chứng minh quyền sở hữu" (gửi mã OTP về email đó) để thực hiện liên kết (Link Account).

### 1.2. Đăng nhập OTP (Email)
- Email được chuẩn hóa (lowercase, trim) trước khi tra cứu.
- OTP Challenge lưu trong `otp_challenges` với `purpose` rõ ràng.
- Mã code gửi qua email được băm bằng secret của server (HMAC) trước khi lưu. Không log mã OTP ra terminal/file.
- Giới hạn attempts và thời gian sống. Việc tiêu thụ OTP (nhập đúng) là nguyên tử (`consumedAt` và `attempts`).

### 1.3. Session và Access Token
- Dùng mô hình Access Token ngắn hạn (HttpOnly Cookie) và Refresh Token dài hạn (Lưu Hash ở `sessions`).
- Bổ sung khái niệm `tokenFamily` (UUID) trên từng Session. Khi Rotate Refresh Token, `tokenFamily` được giữ nguyên.
- **Race Condition & Token Reuse**: Khi có 2 request refresh đồng thời, request đầu cấp token mới. Request sau nếu gửi token cũ nhưng nằm trong Grace Period (ví dụ 30s) sẽ được bỏ qua hoặc nhận lại token vừa tạo. Nếu token cũ được gửi NGOÀI Grace Period, hệ thống phát hiện rủi ro và **Revoke toàn bộ tokenFamily** lập tức.
- **Logout & Banning**: TTL chỉ dùng để dọn rác Database. Backend luôn chủ động kiểm tra trạng thái Session (`revokedAt`). Khi Ban user, mọi Session bị revoke. Access Token ngắn hạn sẽ chết sau vài phút, chặn can thiệp tiếp theo.

## 2. Mô hình Phân quyền

### 2.1. Quyền Quản Trị (Admin Roles & RBAC)
- Admin sử dụng hệ thống riêng với các collections độc lập (`admin_accounts`, `admin_sessions`, `admin_roles`, `admin_audit_logs`).
- Không dùng chung bảng `users` của Client để cấp quyền Admin. Endpoints quản trị xác thực riêng qua `AdminSession`.
- Áp dụng cơ chế Permission-based authorization thay vì chỉ check Role name. Ví dụ: `users.read`, `plans.update`. Hành động nhạy cảm đều lưu vào `admin_audit_logs`.

### 2.2. Gói cước và Tính năng (Plans & Entitlements)
- Nguồn chân lý duy nhất cho quyền lợi là collection `subscriptions`. Bất kỳ thông tin `plan` nào ở `users` cũng chỉ là Cache (được đồng bộ khi sub thay đổi).
- Gói PLUS và PRO chia sẻ **CÙNG MỘT TẬP TÍNH NĂNG** (mở khóa Clone Voice, Premium Voice). Điểm khác biệt duy nhất là lượng Credit được cấp hàng tháng hoặc mua lẻ.

### 2.3. Kiểm soát Sở Hữu (Ownership)
- Người dùng chỉ được can thiệp vào Workspace/Project/Media của mình.
- **Private Audio Access**: Audio từ tính năng Voice Cloning phải là Authenticated Delivery trên Cloudinary. Khi Client cần nghe, Backend kiểm tra quan hệ Ownership. Nếu hợp lệ, backend generate Signed URL tạm thời của Cloudinary và trả về. Tuyệt đối không lưu Signed URL tạm vào Database làm URL vĩnh viễn.

## 3. Chống Lạm Dụng (Abuse Control)

### 3.1. Device ID ngẫu nhiên
- Device ID KHÔNG phải là một hash tĩnh từ IP + User Agent (do dễ bị thay đổi/giả mạo ngẫu nhiên).
- Server tự tạo một chuỗi ngẫu nhiên định danh thiết bị (`device_identities`) và gắn vào HTTP-only Cookie dài hạn (VD: 10 năm) trên thiết bị của user.

### 3.2. Cấp phát Free Credit
- **Quy định 1**: Một user chỉ nhận được Free Credit tối đa 1 lần/tháng (bất kể đổi bao nhiêu máy).
- **Quy định 2**: Một thiết bị (Device ID) chỉ được dùng để nhận Free Credit cho tối đa 3 User khác nhau mỗi tháng.
- **Thực thi**: Khi cấp phát, thực hiện đếm trong `free_credit_grants`. Mọi cấp phát là giao dịch nguyên tử. Lịch sử cấp phát của các tháng cũ không bị xóa, số đếm tự reset nhờ query lọc theo YYYY-MM.
- **IP**: Địa chỉ IP chỉ là tín hiệu rủi ro. Không khóa tài khoản user chỉ vì trùng IP (nhà trọ, công ty).
