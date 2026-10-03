# Trang Gói & quyền lợi theo thiết kế Stitch

Phạm vi nội dung: `/plans`, bộ chỉnh sửa gói và hộp xác nhận. Theo yêu cầu tiếp theo của người dùng, sidebar sáng, logo Veltrix AI / ADMIN CORE và trạng thái active đã chuyển thành component/style chung cho toàn bộ 15 route Admin. Các màn hình khác giữ nghiệp vụ và layout nội dung hiện có. Đợt tái cấu trúc toàn bộ Admin trước đó đã dừng theo yêu cầu người dùng.

## Thiết kế đối chiếu

Thư mục người dùng cung cấp: `C:\Users\lamch\Downloads\stitch_veltrix_plans_entitlements_admin`.

- A: danh sách gói — nền sáng, ba khối thống kê, lọc trạng thái, bảng có mã gói và quyền clone.
- B: chỉnh sửa Clone — drawer rộng, menu dọc, header tóm tắt, trường giới hạn có đơn vị.
- C: Nội dung AI — các nhóm Viết nội dung, Phân cảnh, Prompt, Tạo lại, Lịch sử và Lưu trữ.
- D: xác nhận — so sánh trước/sau, cảnh báo ảnh hưởng, lý do, xác nhận và phiên bản dự kiến.

Font Be Vietnam Pro được tự host, kèm giấy phép OFL. Màu indigo/lavender, spacing và cấu trúc bám mẫu. Giá, tổng gói, phần trăm hoạt động, phiên bản, thời điểm cập nhật, giới hạn và danh sách trường lấy từ API thật. Không thêm Enterprise, công nghệ clone mới hoặc nhãn chứng nhận chỉ có trong mẫu minh họa.

## Trước / sau

| Trước | Sau |
|---|---|
| Plans nằm trong App, form chia hai cột dày trường | Module Plans riêng; menu dọc tám mục; form từng section |
| Có phần trăm 66.7%, phiên bản mẫu, nút phân trang không hoạt động | Thống kê tính từ dữ liệu; search/filter/sort hoạt động; pagination thật 10 gói/trang |
| Review modal phủ drawer đang mở | Drawer rời khỏi DOM khi review; quay lại giữ nguyên draft/mục đang sửa |
| Mã trường khó đọc trong bảng diff | Label, nhóm, đơn vị, giá trị trước/sau; mã vẫn có để truy vết |
| Mô tả trường dài, lặp lại quy tắc backend | Mô tả thao tác ngắn; tooltip giữ quy tắc đầy đủ từ schema |
| Loading spinner bảng | Skeleton danh sách và khối thống kê; error có retry |

## Các luồng được giữ

Schema động; kiểm tra server; CSRF; expectedRevision; cảnh báo rời trang khi chưa lưu; review trước khi save; lý do tối thiểu; xác nhận giảm quyền lợi/tăng giá; audit phân trang 10; rollback tạo phiên bản mới; archive; quyền chỉ xem; snapshot tác vụ cũ. Không thay đổi API hoặc dữ liệu cấu hình đang chạy.

Form chỉ trình bày các trường đang có trong schema. Không hardcode hạn mức vào frontend. Khi tạo cấu hình mới, admin nhập các giá trị bắt buộc thay vì nhận quota đoán sẵn.

## Kiểm tra

- `npm run build`: typecheck và build thành công. Bundle hiện còn cảnh báo kích thước >500 kB của toàn ứng dụng.
- `npm run lint`: không có lỗi; repository còn cảnh báo tại các module khác.
- `npm run test:plans:design`: Chromium với fixture tách biệt; không viết cấu hình người dùng thật. Kiểm tra tất cả trường schema, số liệu/filter, sửa Clone/Nội dung, review không chồng overlay, reason/confirm/CSRF/revision, rollback/archive preview, conflict giữ draft, guard chưa lưu, chỉ xem, error/retry và empty.
- Viewport kiểm tra: 1600, 1280, 768, 390px; danh sách, drawer và review không làm tràn viewport.
- `node --test tests/plans.test.cjs`: 55/55 qua; bao gồm validation, quyền, boundary, snapshot, rollback, optimistic concurrency và audit.

Ảnh trong `.artifacts/plans-design-*.png` là ảnh kiểm thử fixture, không phải số liệu vận hành. Ảnh chính: `list-desktop`, `clone-desktop`, `content-desktop`, `review-desktop`, và các biến thể `1280`, `768`, `390`.

Files: `apps/web-admin/src/Plans.tsx`, `Plans.css`, integration trong `App.tsx`, sidebar dùng chung trong `AdminShell.tsx` và `AdminShell.css`, browser test `tests/plans-design-browser.cjs`. `tests/control-browser-local.cjs` kiểm tra sidebar giống nhau trên toàn bộ 15 route, menu đúng quyền, active link và thao tác mobile/Escape.
