# Nhãn gói trên client

Admin → Gói & quyền lợi → Quản lý gói → Tổng quan → **Gắn nhãn Thường được dùng**.

`overview.popular` là boolean, mặc định `false` cho cấu hình cũ. Lưu thông qua quy trình xem diff, nhập lý do, kiểm tra phiên bản và audit hiện có. Nhãn độc lập với `overview.highlighted`; không thay đổi quyền lợi, giá hoặc snapshot của tác vụ.

Client hiển thị ba avatar minh họa, nhãn và số tài khoản đang hoạt động thuộc gói. `GET /api/plans` bổ sung `popularity.activeUsers`, thống kê từ `User.status = ACTIVE` và `User.plan`. Đây là số tài khoản hiện tại, không phải tổng khách mua gói trong quá khứ. Không trả tên, email hay ảnh của khách.

Nếu chưa có người dùng, hiển thị lời giới thiệu thay vì số liệu giả. Khi số thực lớn hơn 9.432, hiển thị “Hơn 9.432 người đang sử dụng gói này”. Không có input nhập một lượng khách giả; ba avatar có nhãn hỗ trợ truy cập “Avatar minh họa”.
