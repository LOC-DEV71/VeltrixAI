# Trang Người dùng theo thiết kế Stitch

Phạm vi: nội dung route `/users`. Không sửa `AdminShell`, sidebar, topbar, route khác hoặc API/backend. Mẫu sử dụng từ bốn thư mục `a._danh_s_ch_ng_i_d_ng`, `b._ng_n_chi_ti_t_ng_i_d_ng`, `c._h_p_t_ng_credit`, `d._h_p_c_p_nh_t_g_i_th_i_h_n` trong thư mục thiết kế người dùng cung cấp.

## Trước và sau

| Phần | Trước | Sau |
| --- | --- | --- |
| Danh sách | Card/màu riêng lẻ, tìm kiếm khi submit, số thứ tự tính theo 20 dòng | Typography Be Vietnam Pro, bảng nền nhẹ, tìm kiếm khi nhập, lọc trạng thái từ server, đúng 10 dòng/trang |
| Chi tiết | Thông tin dồn vào một card, mô tả ví khó đọc | Header tài khoản, ID có sao chép, tách Credit khả dụng/tạm giữ, phân nhóm gói và tác vụ |
| Tặng Credit | Form nhỏ, chưa xem trước số dư, modal chồng Drawer | Modal riêng thay thế Drawer, gợi ý số lượng, trước/sau, kiểm tra số nguyên và lý do, khóa gửi trùng |
| Đổi gói | Nút ghi đè và modal thời hạn rời rạc | Gói hiện tại → sắp áp dụng, chu kỳ/ngày bắt đầu, hạn dự kiến theo tháng lịch, xác nhận ảnh hưởng trước khi lưu |
| Lỗi/tải/rỗng | Chủ yếu spinner/toast | Skeleton, lỗi có thử lại, trạng thái rỗng có xóa lọc, lỗi thao tác giữ dữ liệu để thử lại hoặc tải lại tài khoản |
| Quyền | Nút thao tác bị disabled | Quyền chỉ đọc vẫn xem chi tiết; ẩn tặng Credit, đổi gói và khóa/mở khóa |

Các phần dùng chung trong module: `UserIdentity`, `PlanBadge`, `UserStatus`, `LoadingRows`; token, spacing, palette và các component Ant Design dùng thống nhất qua ConfigProvider cục bộ. CSS được đặt trong `UserManagement.css`, không tác động sidebar.

## Nghiệp vụ được giữ

- List gọi server với `page`, `limit=10`, `search`, `status`; hủy request cũ để tránh ghi đè dữ liệu khi tìm nhanh. Khi tổng số dòng giảm, đưa về trang còn hợp lệ.
- Ba thống kê trạng thái/gói chỉ tính trong trang đang xem; tổng tài khoản khớp bộ lọc lấy từ server. Không dùng KPI toàn hệ thống giả.
- Tặng Credit vẫn gọi `/api/admin/users/:id/credits`, có CSRF và cùng Idempotency-Key khi thử lại. Khóa gửi trong lúc xử lý. Credit được cộng vào bucket PAID; không thay đổi bucket hoặc hạn sử dụng.
- Khóa/mở khóa vẫn yêu cầu lý do, `confirmed:true`, `expectedRevision`. Không bỏ kiểm tra quyền hay revision của backend.
- Đổi gói giữ nguyên contract PUT `/api/admin/users/:id/plan`: tier và planPeriod. Chỉ có các gói thật Free, Basic Student, Plus Creator, Pro và ba chu kỳ đang được hỗ trợ. Preview ngày cuối tháng tính đúng như backend.
- Cấp gói thủ công không tự cộng Credit, tạo thanh toán hay hoàn tiền. Hiển thị rõ điều này trong phần xác nhận. Lịch sử nhiều đơn Plus/Pro vẫn được hiển thị, kèm gói đang chọn, nguồn kích hoạt, ngày bắt đầu, ngày hết hạn và phân trang 10.
- Các nội dung mẫu không có API tương ứng (chỉnh hồ sơ, tier Enterprise, chứng nhận ISO, số hạn mức giả, lời hứa realtime toàn bộ hồ sơ, lý do đổi gói chưa được backend lưu) không được dựng thành chức năng giả. Nhật ký đổi gói hiện tại của backend vẫn ghi trước/sau.
- Không tạo/sửa dữ liệu sản xuất để kiểm thử.

## Kiểm tra

- `npm run build`: bao gồm TypeScript project build và Vite production build.
- `npm run lint`: không có lỗi; cảnh báo còn lại thuộc các module cũ.
- `npm run test:users:design`: Chrome thật, fetch fixtures trong một profile riêng. Kiểm tra pagination 10, STT trang hai, tìm/lọc, tài khoản có hai gói, số dư trước/sau, CSRF, gửi kép/thử lại cùng key, lịch tháng/năm, lý do/revision khóa tài khoản, hủy bản nháp, quyền chỉ đọc, retry/rỗng, kích thước 1600/1280/768/390.
- `node tests/control-browser-local.cjs`: kiểm tra hồi quy 15 route, sidebar chung/active/màu/font và menu mobile.

Ảnh `.artifacts/users-design-*-fixture.png` được chụp từ dữ liệu kiểm thử cô lập; không phải số liệu vận hành thật.
