# Quản trị vận hành Veltrix

Các trang admin mới: tổng quan `/`, tác vụ `/jobs`, Developer `/developers`, nội dung và dung lượng audio `/contents`, đối soát nội bộ `/reconciliation`, nhân viên và phiên đăng nhập `/admins`, nhật ký `/audit`, cài đặt `/settings`.

## Phân quyền

Chủ hệ thống quản lý nhân viên, phiên đăng nhập và cấu hình vận hành. Có các vai trò Quản trị, Vận hành, Tài chính, Hỗ trợ và Chỉ xem. Menu và API đều kiểm tra quyền. Tài chính không được thử lại tác vụ hoặc khóa Developer API; Vận hành không được xem doanh thu. Tài khoản chủ hệ thống và tài khoản đang thao tác được bảo vệ khỏi tự đổi vai trò/đình chỉ.

Tạo nhân viên cần mật khẩu ban đầu từ 12 đến 128 ký tự. Mật khẩu được băm scrypt với salt riêng. Khi đăng nhập thành công, mật khẩu băm SHA256 cũ được chuyển sang scrypt. Đổi vai trò/đình chỉ thu hồi các phiên đăng nhập hiện tại.

## API

Các route nằm tại `/api/admin/control`, yêu cầu cookie phiên admin. Mọi thay đổi yêu cầu CSRF, `reason` từ 5 đến 1000 ký tự và `confirmed: true`. Thay đổi API access, nhân viên, cấu hình và trạng thái người dùng yêu cầu `expectedRevision`; bản cũ trả `ADMIN_REVISION_CONFLICT`. Danh sách trả `{items,total,page,limit:10}`.

Developer: xem token đã che, request/status/latency và giới hạn hiện hành từ gói. Khóa API độc lập với trạng thái tài khoản. Không trả token/hash hoặc nội dung request. Nhật ký request có TTL cấu hình 1–365 ngày và bắt đầu ghi từ lúc triển khai tính năng; không phục dựng lịch sử cũ. Ký tự đã gửi không đồng nghĩa ký tự đã tính phí. Quota sử dụng tháng là quota chung ứng dụng và API.

Nhật ký admin là append-only qua model ứng dụng; các thay đổi mới ghi người thực hiện, thời gian, lý do và phiên bản/diff khi phù hợp. Giới hạn quyền ghi trực tiếp MongoDB ở môi trường sản xuất để tránh thao tác ngoài ứng dụng.

## Tác vụ và dịch vụ

Trang tác vụ chỉ trả trạng thái, mã lỗi an toàn, thông tin giữ Credit và phiên bản gói, không trả lời đọc/prompt/đường dẫn provider. Chỉ TTS độc lập đã thất bại được tạo yêu cầu thay thế. Yêu cầu thay thế dùng quyền/giá hiện tại và idempotency cố định theo tác vụ cũ để tránh giữ Credit hai lần; tác vụ cũ được giữ nguyên.

Worker TTS cập nhật heartbeat mỗi 20 giây; sau 60 giây không nhận heartbeat sẽ báo mất tín hiệu. Cần khởi động lại worker sau build để nạp mã heartbeat. Kiểm tra TTS là readiness HTTP; Cloudinary hiển thị trạng thái cấu hình, không phải kiểm tra upload thực tế. Ngưỡng tác vụ chờ/lỗi nằm trong SystemSettings `ADMIN_OPERATIONS` và được kiểm tra phiên bản khi sửa. Trang tự làm mới mỗi 30 giây; thông báo thanh toán dùng socket đã có.

## Thanh toán và đối soát

Các trang đơn hàng, thanh toán, dòng tiền và Credit tiếp tục dùng dữ liệu đã lưu và callback VNPay đã xác minh. Sandbox và production được tách riêng. Credit không được quy đổi thành doanh thu tiền mặt.

Đối soát nội bộ liệt kê đơn PENDING quá hạn, đơn PAID thiếu ngày/thời hạn, tác vụ đã kết thúc nhưng reservation vẫn HELD. Đây là cảnh báo để điều tra; không tự đổi trạng thái, hoàn tiền hay trả Credit. Chưa tích hợp truy vấn đối soát/hoàn tiền của provider hoặc sao kê ngân hàng, nên doanh thu này chưa phải số tiền quyết toán về ngân hàng.

Nội dung/lưu trữ chỉ hiện metadata và dung lượng audio đã lưu. Không mở nội dung hoặc audio riêng của khách và không có nút xóa hàng loạt.

## Kiểm tra

Backend: `npm run build`, `node --test tests/admin-control.test.cjs tests/developer-api.test.cjs tests/billing.test.cjs`.

Admin: `npm run build`, `node tests/control-browser-local.cjs` khi Vite chạy ở 5174. Kiểm tra trình duyệt dùng dữ liệu giả lập, không ghi vào tài khoản thật.
