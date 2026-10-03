# AG-016 — Bàn giao và phân công từ 2026-10-01

## Phạm vi đã được người dùng xác nhận

- Antigravity phụ trách Frontend, chỉ sửa `apps/web-client` và `apps/web-admin` sau bàn giao.
- Codex phụ trách Backend. Giới hạn hai ứng dụng frontend không áp dụng cho Codex.
- `packages/contracts` và `packages/design-tokens` là phần dùng chung: đề xuất trước để Lead điều phối.
- Antigravity chuyển lỗi backend cho Codex với endpoint, request/response đã che secret và bước tái hiện; không tự sửa backend.

## Hiện trạng backend được tiếp nhận

Workspace không có repository Git, nên không thể xác nhận diff, tác giả hoặc danh sách đầy đủ file đã sửa trước phiên này. Codex chưa sửa mã backend trong phiên bàn giao này; không có thao tác sửa backend đang chạy của Codex cần hoàn tất hay hoàn tác.

Báo cáo `docs/reports/AG-016.md` và mã hiện tại cho thấy:

| File | Hiện trạng |
| --- | --- |
| `apps/backend-api/src/controllers/AuthController.ts` | Google và OTP login gọi cấp credit cho cả tài khoản mới/cũ; bỏ qua lỗi đã nhận trong tháng hoặc vượt giới hạn thiết bị. |
| `apps/backend-api/src/services/CreditService.ts` | Đọc `FREE_GRANT_AMOUNT` từ SystemSettings, mặc định 2.000; cấp credit trong transaction. Báo cáo cũ không nêu rõ file này trong danh sách diff, nên chỉ xác nhận hiện trạng mã. |
| `apps/backend-api/src/workers/queue.ts` | Queue giả lập bằng `setTimeout`, `connection = null`, trả `mock-job-id`. Chưa có queue Redis thật. |
| `apps/backend-api/src/workers/ContentWorker.ts` | Có worker xử lý content; BullMQ worker chỉ được tạo khi có connection. Hiện queue giả lập gọi trực tiếp hàm xử lý. |

## Kết quả kiểm tra trong phiên bàn giao

- `pnpm --filter @creatorai/backend-api typecheck`: PASS.
- `pnpm --filter @creatorai/backend-api test`: không khởi động được do `spawn EPERM` khi tải Vitest/Vite config trong sandbox. Yêu cầu chạy ngoài sandbox bị người dùng từ chối; chưa có kết quả test case trong phiên này.
- Truy vấn listener local port 6379 không trả listener; đây không xác nhận được tình trạng Redis ở địa chỉ khác.
- Các kết luận PASS login/credit của báo cáo cũ chưa được tái kiểm chứng end-to-end trong phiên này.

## Backend còn dở / cần Codex kiểm chứng

- Queue Redis thật và nghiệm thu content còn dở. Không tự khởi động queue/worker hay gọi dịch vụ AI khi bàn giao.
- `tests/integration.test.ts` vẫn truyền đối số thứ tư `amount` vào `grantFreeCredits`, trong khi hàm hiện nhận ba đối số. Typecheck hiện chỉ bao gồm `src`, nên PASS không bao phủ sự lệch này trong test.
- Cấp credit dùng User-Agent làm device ID; cần kiểm chứng yêu cầu nhận diện thiết bị và giới hạn cấp credit.
- Cấp credit được gọi trước kiểm tra tài khoản BANNED. Cần kiểm chứng hành vi mong muốn trước khi chốt nghiệm thu.
- Login trả user chưa kèm credits; `GET /api/users/me` trả thông tin credits. Frontend cần tải dữ liệu ví để hiển thị sau login.

## Điểm kiểm tra frontend dành cho Antigravity

Đây là nhận xét từ đọc mã, chưa phải kết quả kiểm thử UI thực tế:

- Login UI: kiểm tra Google/OTP, lỗi, thao tác nhanh và logout/login lại.
- CSRF client (`apps/web-client/src/api.ts`): các request ghi đồng thời có thể cùng tải và xoay token; logout chưa xóa token lưu trong bộ nhớ; khi tải token lỗi, interceptor vẫn cho request ghi tiếp tục. Kiểm tra với cookie/header đã che giá trị.
- Polling (`ContentEditorPage.tsx`): `setInterval` chưa có cleanup khi unmount/đổi content, chưa giới hạn thời gian chờ và có thể gửi request chồng nhau. Kiểm tra COMPLETED/FAILED, lỗi mạng và chuyển trang.
- Credit: `AuthContext.tsx` đặt user từ response login, chưa tải `/users/me` ngay sau login; refresh credit hiện chỉ gọi khi tạo content COMPLETED, chưa gọi khi FAILED/hoàn credit.
- Content/chia cảnh: nút lưu/chia cảnh trong editor chưa nối handler; `ScenesPage.tsx` hiện dùng dữ liệu cảnh cố định, chưa lấy cảnh thật theo content/project.

Khi phát hiện lỗi backend, ghi endpoint, môi trường, bước tái hiện, HTTP status, request/response thực tế và mong đợi. Che credential Google, OTP, cookie, Authorization, CSRF token, API key và dữ liệu cá nhân. Với nhận xét chỉ từ mã, ghi rõ chưa tái hiện, không ghi response suy đoán thành response thực tế.
