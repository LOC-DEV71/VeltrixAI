# Hiển thị thời hạn gói

Admin → Người dùng → Quản lý → Ghi đè gói cước → chọn gói. Modal cho chọn cấp thủ công không thời hạn, theo tháng, hoặc theo năm; nhập ngày bắt đầu theo giờ Việt Nam.

Backend lưu `User.planPeriod` với `billingCycle`, `startsAt`, `endsAt`. Ngày hết hạn do backend tính bằng một hoặc mười hai tháng lịch. Nếu ngày bắt đầu ở cuối tháng, ngày kết thúc được giới hạn ở ngày cuối của tháng đích. Mọi thay đổi được ghi vào `AdminAuditLog` trong cùng transaction; route yêu cầu quyền `users.manage` và CSRF.

`GET /api/users/me` trả `subscriptionPeriod` an toàn: ngày đầu/cuối, trạng thái, ngày còn lại, phần trăm tháng hiện tại và phần trăm toàn kỳ. Với gói năm: sau một tháng lịch còn 91,67%; sau sáu tháng còn 50%; khi hết hạn còn 0%. Thanh tháng được tính riêng trong tháng đăng ký hiện tại, không lấy tháng dương lịch làm mốc.

Client Cài đặt hiển thị thanh tháng và thêm thanh năm bên dưới nếu chu kỳ là năm. Phần trăm biểu thị thời gian, không phải Credit. Dữ liệu làm mới mỗi phút khi trang hiển thị và khi lấy lại focus.

Tài khoản cũ không được tự gán chu kỳ hoặc lấy ngày tham gia làm ngày đăng ký. Khi chưa có thời hạn, client thông báo rõ. Gói Free không có thời hạn đăng ký trả phí. Chuyển sang gói khác bằng cấp thủ công xóa thời hạn của gói cũ. Gửi `planPeriod: null` xóa thời hạn; bỏ trường này khi giữ nguyên tier sẽ giữ lại thời hạn hiện có.

Đây là dữ liệu thời hạn được Admin ghi nhận. Không tạo giao dịch thanh toán, tự gia hạn, tự cấp Credit hoặc tự thay đổi quyền theo ngày hết hạn; các luồng đó phải được tích hợp với đăng ký/thanh toán thật riêng.
