# Thư viện giọng — UI chung Admin

Phạm vi: nội dung route `/voices`, theo ngôn ngữ thiết kế đã duyệt ở trang Gói và Người dùng. Giữ nguyên sidebar, topbar, backend và các API nghiệp vụ. `App.tsx` chỉ truyền trạng thái router đang hỏi xác nhận rời trang để các overlay giọng không chồng lên hộp xác nhận chung.

## Trước / sau

| Phần | Trước | Sau |
| --- | --- | --- |
| Danh sách | Card và bảng dùng style cũ, spinner | Be Vietnam Pro, palette/spacing chung, thống kê từ aggregate thật, filter chip, skeleton và error retry |
| Chi tiết | Form dài trong Drawer 640px | Drawer 920px, phân nhóm Thông tin, Audio nghe thử và Lịch sử, footer cố định |
| Lưu thông tin | Modal chồng Drawer; trường position bị bỏ khỏi payload | Drawer tạm ẩn khi review, bảng trước/sau; gửi cả position theo contract hiện có |
| Tạo giọng | Một form dồn tất cả trường và xác nhận chồng modal | Ba bước Thông tin → Quyền/hiển thị → Mẫu/xác nhận, đầy đủ trường và consent |
| Tạo audio mẫu | Form chen trong thông tin và popup confirm chồng Drawer | Modal riêng, xác nhận công bố, text/reason/giới hạn từ server, giữ key khi thử lại |
| Sắp xếp | Modal cơ bản | Danh sách kéo thả, nút lên/xuống, lý do và pagination 10, xác nhận khi bỏ bản nháp/chuyển trang |
| Chờ Worker | Spinner và lời nhắc chung | Trạng thái QUEUED / PROCESSING / COMPLETED / FAILED lấy từ job thật, ID sao chép và theo dõi lại khi mất kết nối |

## Thành phần dùng chung trong module

- `VoiceIdentity`, `VoiceStatus`: avatar/name/language/gender/default, status nhất quán giữa bảng, Drawer và modal.
- `VoiceAuditNote`, `VoiceJobState`: thông tin nhật ký và trạng thái Worker.
- `voiceModel.ts`: kiểu dữ liệu, tên trường, formatter và nhãn dùng chung.
- Ant Design dùng token cục bộ trong `VoiceManagement`; CSS scoped trong `VoiceManagement.css`.

## Nghiệp vụ được giữ

- Giọng hệ thống và giọng nhân bản vẫn dùng cùng DTO/API; mẫu tham chiếu của giọng riêng không bị phát công khai.
- Danh sách và lịch sử dùng `limit=10`, search/filter từ server, request cũ được abort. Giọng PENDING trong trang được kiểm tra lại định kỳ.
- Các thao tác quản trị chỉ hiện khi server trả `canManage`; quyền chỉ đọc vẫn xem thông tin và nghe audio hệ thống. Backend vẫn kiểm tra RBAC và CSRF.
- Sửa thông tin giữ `expectedVersion`, reason và xác nhận giảm quyền/thu hồi. Giọng mặc định phải hoạt động và dành cho tất cả gói. Không cho hồi sinh giọng clone đã bị thu hồi.
- Avatar giữ upload Cloudinary với `/veltrixai/voice-avatars/`, PNG/JPG/WebP tối đa 5 MB, chỉ tải khi lưu; không đổi cấu hình Cloudinary.
- Tạo giọng giữ name, language, gender, tags, position, entitlement, default, status, avatar URL/upload, WAV, preview text, reason và ba consent. File WAV vẫn đi qua chuẩn hóa/kiểm tra hiện có.
- Tạo giọng/audio mẫu giữ Idempotency-Key khi thử lại và khóa gửi kép. `waitVoiceJob` chỉ thêm callback trạng thái cho UI; không sửa chính sách Worker.
- Sắp xếp gửi page, ID/version và lý do; không thay đổi cách server quyết toán thứ tự.
- Bản nháp được giữ khi hủy xác nhận; trạng thái đọc file/chờ tác vụ cũng được đưa vào guard rời trang.
- Không thêm số liệu giả, phần trăm tiến độ giả hoặc tạo giọng thật để kiểm thử.

## Kiểm tra

- `npm run build`: TypeScript và Vite production build.
- `npm run lint`: không có lỗi; cảnh báo còn lại thuộc các module cũ.
- `npm run test:voices:design`: Chromium thật với API/ảnh/WAV cô lập. Kiểm tra phân trang, lọc/tìm, phát WAV, detail/history, payload position/avatar/version/CSRF, review một overlay, preview retry cùng key, trạng thái Worker, guard bản nháp, kéo thả, form ba bước/consent/WAV, gửi kép, read-only, empty/error retry và viewport 1600/1280/768/390.
- `node tests/control-browser-local.cjs`: hồi quy 15 route và sidebar dùng chung.

Ảnh `.artifacts/voices-design-*-fixture.png` chỉ minh họa dữ liệu kiểm thử, không phải thống kê hoặc giọng sản xuất. Kiểm tra UI không xác nhận dịch vụ TTS/Cloudinary trên môi trường deploy đang hoạt động.
