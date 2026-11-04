# Đồng bộ Admin theo Plans / Users / Voices

## Audit trước khi sửa

Router nằm ở `apps/web-admin/src/adminRoutes.ts`; nội dung route được chọn trong `App.tsx`. Sidebar và header dùng chung `AdminShell`, giữ nguyên thiết kế đã duyệt.

| Route | Trước | Sau |
| --- | --- | --- |
| `/` | Các card rời, spinner, chưa hiện AI health | Metric strip, nhóm sức khỏe dịch vụ, trạng thái hàng đợi và cảnh báo từ API |
| `/jobs` | ID tài khoản không có tên/email; drawer chỉ có bảng mô tả | Tên/email/ID sao chép, mở hồ sơ, loại tác vụ và trạng thái Credit tiếng Việt, thời gian tương đối |
| `/developers` | Token và request có hai bảng chia cùng page gây khó hiểu | Tabs Token / Request, quyền hiện hành, pagination 10, xác nhận quyền truy cập trong modal riêng |
| `/contents` | Toolbar và bảng theo style cũ | Bộ lọc có label/chip, bảng thống nhất; giữ tab dung lượng và chỉ xem metadata |
| `/credits` | Mã tài khoản khó tra cứu | Tên/email/ID, sổ biến động Credit, bộ lọc chung, 10 dòng/trang |
| `/orders` | Bố cục tài chính riêng lẻ | Danh sách đơn và quyền lợi, drawer hồ sơ/tiến trình/thanh toán cùng bộ style |
| `/payments` | Bảng rộng, trạng thái tải/lỗi sơ sài | Sổ kết quả VNPay, xác nhận IPN hoặc nguồn dữ liệu cũ, skeleton và retry |
| `/cashflow` | Style card/gradient khác chuẩn | Bộ lọc, báo cáo thu thật, sổ thu, accent indigo; tách rõ sandbox |
| `/reconciliation` | Bảng không có tên khách | Danh tính tài khoản, phân loại đối soát, trạng thái lỗi/empty có hướng dẫn |
| `/admins` | Form placeholder, quyền dạng chuỗi, không có preview | Form có label/giới hạn, quyền theo nhóm, kiểm duyệt trước lưu; phiên có tên/email admin |
| `/audit` | Bảng style cũ, ngày tuyệt đối | Nhật ký cùng table system, lọc đối tượng, thời gian tương đối và ngày đầy đủ |
| `/settings` | Một bảng mô tả và modal đơn giản | Section cấu hình, giá trị/đơn vị/mô tả, validation, preview trước/sau, lý do và xác nhận |
| `/plans`, `/users`, `/voices` | Thiết kế tham chiếu đã duyệt | Giữ bố cục; thêm thời gian tương đối. Users có ID sao chép, tìm bằng ID và deep link hồ sơ |

Các vấn đề chung: token/style không đồng nhất với ba trang mẫu; spinner trong bảng/drawer; filter không có label và gọi API mỗi ký tự; modal có thể chồng drawer; request chi tiết trả muộn có thể mở lại drawer đã đóng; chỉ hiện ID nên khó truy vết khách hàng. Các API phân trang vẫn trả tối đa 10 bản ghi.

## Component và quy ước dùng chung

- `design-system/OperationsUI.tsx`: ConfigProvider chỉ cho phần outlet; font Be Vietnam Pro, indigo #4F46E5, text #172033, border #E8EBF2, radius 12–16. Drawer/modal cùng spacing, responsive và footer.
- `design-system/components.tsx`: PageHeader, Section, MetricStrip, DataTable, StatePanel, FilterChips, StatusBadge, FormField và ChangePreview. Export CSV chỉ áp dụng những dòng đã chọn trên trang hiện tại.
- `components/AccountReference.tsx`: tên/email, ID có thể sao chép, link `/users?userId=...` khi có quyền `users.read`.
- `components/AdminTime.tsx` và `adminTime.ts`: cùng một đồng hồ cập nhật 30 giây, tooltip ngày giờ UTC+7. Dưới phút: “Vừa xong”; dưới giờ: phút; dưới 24 giờ: giờ; dưới 30 ngày: ngày; tiếp theo tháng/năm với quy ước 30/365 ngày. Ngày tương lai, thời hạn sử dụng và bộ lọc ngày giữ ngày cụ thể.
- Cấu hình và phân quyền: giá trị hợp lệ/đã thay đổi → kiểm duyệt → nhập lý do → xác nhận. Giữ `expectedRevision`, CSRF, backend RBAC và audit. Drawer được tháo khi mở modal, không chồng lớp.

## Backend bổ sung

`AdminIdentities.ts` tham chiếu danh tính bằng một query cho cả trang, chỉ chọn `_id`, `displayName`, `email`. Jobs, chi tiết job, đối soát, nội dung và sổ Credit nhận thông tin này. Phiên admin cũng tham chiếu tên/email nhân viên. Không thay đổi dữ liệu nguồn hay pipeline AI/TTS/Credit.

Tìm kiếm Users nhận ID chính xác ngoài tên/email; chuỗi tìm kiếm được escape để tìm literal, kiểm tra kiểu/độ dài đầu vào. Tài khoản không còn tồn tại giữ ID và trạng thái thiếu danh tính; API hồ sơ vẫn kiểm tra quyền truy cập như trước.

Đơn hàng, thanh toán và dòng tiền giữ endpoint, định nghĩa và ngày hạch toán riêng. Dòng tiền chưa có phí/hoàn tiền/quyết toán thì ghi rõ thiếu dữ liệu; không suy ra tiền mặt từ Credit.

## Kiểm tra

- `npm run build` tại web-admin: typecheck và Vite bundle.
- `npm run build` / `npm run typecheck` tại backend-api.
- `node --test tests/admin-identities.test.cjs tests/admin-control.test.cjs tests/admin-finance.test.cjs` tại backend-api: database test riêng; danh tính, ID tìm kiếm, quyền/CSRF/revision, pagination, thanh toán và tính toàn vẹn dữ liệu. Test ngày tài chính dùng đồng hồ cố định để không phụ thuộc ngày chạy.
- `node --test --test-isolation=none tests/admin-time.test.mjs tests/admin-login-route.test.mjs` tại web-admin: biên phút/giờ/ngày/tháng/năm, ngày không hợp lệ/tương lai, hồi quy đăng nhập.
- `node tests/operations-browser.cjs` tại web-admin: 12 trang còn lại ở 1440/820/390px; không tràn ngang toàn trang; tham chiếu job → hồ sơ đúng ID; preview cấu hình/lý do; modal không chồng drawer; retry, pagination và response muộn; chi tiết thanh toán, empty/permission/read-only. Dùng fixture chỉ trong test và file build thật, không thay API ứng dụng.
- Lint các file thay đổi. Không thêm dependency hoặc cấu hình deployment. Bundle admin vẫn có cảnh báo kích thước chunk; chưa đổi chiến lược chia bundle trong phạm vi này.

Kiểm thử tự động UI dùng fixture, không chứng minh trạng thái kết nối các dịch vụ đang chạy hoặc thao tác trên tài khoản production. Các kiểm thử backend chạy trên MongoDB tạm, không sửa dữ liệu người dùng thật.

Kết quả: build/typecheck admin và backend đạt; 20 test backend và 5 test thời gian/đăng nhập đạt. 12 route vận hành/tài chính đạt kiểm tra ở ba chiều rộng và các luồng thao tác nêu trên. Lint exit 0, còn cảnh báo React hooks/fast refresh của hệ thống; Vite còn cảnh báo bundle lớn. Sidebar và header giữ bố cục cũ đã duyệt; chỉ đổi thời gian trong danh sách thông báo.
