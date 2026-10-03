# AG-ADMIN-UX-REBUILD-001

## Audit trước khi sửa

Audit source ngày 03/10/2026: router, shell, Plans trong App, UserManagement, VoiceManagement/AdminVoiceTools, ControlCenter, BillingManagement, chuông realtime, CSS và các browser test hiện có. 15 route quản trị, 1 route đăng nhập, fallback không tìm thấy. API đang chạy được giữ lại.

| Route | Chức năng hiện có | Vấn đề UI được tìm thấy |
|---|---|---|
| / | Users/API, tổng Credit, jobs, TTS/Worker | Quá nhiều card cùng cấp; thiếu Gemini, lựa chọn thời gian, credit usage; spinner |
| /users | Tra cứu, khóa/mở, đổi gói, cấp Credit, lịch sử | KPI và bảng khác style; màu inline; search chỉ khi submit; hành động quản trị lẫn thông tin |
| /plans | Schema động, preview/diff, version, archive, rollback, lịch sử | Drawer dày trường; chưa dùng header/form chung; review modal phủ drawer |
| /voices | Metadata/tag/avatar, nghe mẫu, quyền, default, audit | Filter riêng; nhiều thao tác ngang hàng; review phủ drawer |
| /contents | Metadata nội dung và audio storage | Filter ID tạo lỗi khi gõ; empty không hướng dẫn; thiếu sort |
| /jobs | Tra cứu, trạng thái, reservation, snapshot, retry | ID dài, hành động thiếu phân cấp; loading spinner; không có timeline |
| /developers | Lưu lượng, token/request, quota, khóa API | Lẫn KPI và bảng; filter ID từng phím; quyền hiện raw codes |
| /credits | Biến động sử dụng Credit | Filter/bảng riêng; giải thích ví chưa cùng language system |
| /orders | Đơn đăng ký và quyền lợi | Header/filter riêng, chưa có filter chip, selection hoặc sort |
| /payments | Receipt VNPay và legacy results | Layout riêng; trạng thái chưa dùng badge chung |
| /cashflow | Sổ thu, trend và phân bổ gói | CSS/component riêng, tiền thu cần giữ phân biệt với quyết toán |
| /reconciliation | Bất thường đơn và Credit | Bảng thô, empty chưa chỉ thao tác tiếp |
| /admins | Staff và phiên đăng nhập | Permissions raw codes; thiếu trang RBAC riêng; form không có diff |
| /audit | Nhật ký bất biến | Hành động raw codes; thiếu filter/search/sort đồng bộ |
| /settings | Ngưỡng lưu request và cảnh báo | Modal input không có preview hiện tại/sắp lưu |
| /login | Đăng nhập admin + CSRF | Font/style riêng; spinner toàn màn hình |
| fallback | Không tìm thấy route | Hiển thị nhãn “Đang phát triển” gây hiểu nhầm |

### Những lỗi hệ thống

- Font Inter/Segoe UI; primary #635bdb; sidebar tối cố định, không collapse, không command palette/dark mode.
- Page heading, toolbar, summary, table, empty/error/loading lặp lại trong ít nhất bốn module. CSS hardcoded và inline spacing 10/17/21/25px không theo 4/8.
- Ant Table/Modal/Drawer dùng trực tiếp mỗi nơi; page size đúng 10 nhưng loading dùng Spin hoặc spinner bảng.
- ID filter của ControlCenter gọi API cho từng ký tự chưa hợp lệ; request UI dễ nhấp nháy lỗi.
- RBAC đã kiểm tra backend nhưng cách hiển thị quyền và hành động chưa rõ. Không có self-account route.
- Chuông giữ nghiệp vụ socket, nhưng toast ở góc trên và popover inline style chưa đồng bộ.
- State permission-denied/fallback không có hành động quay lại. Error thiếu phân loại nguyên nhân. Empty thiếu hướng dẫn.
- Nghiệp vụ tài chính mới đã tách API; phải giữ receipt/sổ thu, snapshot, CSRF, audit và các giới hạn phân trang.

Responsive đã có media queries và các test cũ ở finance/control, nhưng chưa có một bộ nghiệm thu mọi route trên desktop/tablet/mobile. Đây là phần cần bổ sung, không coi audit source là bằng chứng browser toàn bộ.

## Quyết định tái cấu trúc

1. Design tokens và Ant theme chung: Be Vietnam Pro self-hosted, Light mặc định, palette và spacing thống nhất; Dark tùy chọn.
2. Shell và navigation registry duy nhất; collapse, breadcrumb, global command search, health, thông báo và tài khoản.
3. Component system: PageHeader, DataTable, FilterChips, StatePanel, StatusBadge, MetricStrip, Section, FormField, ChangePreview, ActionMenu, AdminDrawer/AdminModal, PermissionsView.
4. Mọi màn hình dùng components chung. Giữ API/nghiệp vụ; bổ sung chỉ API đọc cho health/search/sort/self-account và kiểm tra quyền server.
5. Dashboard lấy dữ liệu thực theo thời gian; health Gemini phân biệt cấu hình/quan sát thành công với probe trực tiếp. Không tạo progress, chart hoặc số liệu minh họa trong app.
6. Review editor dùng cùng drawer với bước form/review để tránh modal trên drawer. Hành động nguy hiểm có lý do/confirm và kiểm tra quyền.

## Báo cáo sau và nghiệm thu

Được cập nhật sau khi hoàn thành triển khai và chạy kiểm tra. Ảnh chụp browser sử dụng fixture tách biệt, chỉ để kiểm tra giao diện; ứng dụng chạy bằng API thật và không dùng fixture làm fallback.
