# Sửa luồng Content / Scenes — 2026-10-01

Người dùng đã giao Codex phụ trách cả Frontend và Backend trong phiên này, thay thế giới hạn chỉ sửa Backend trước đó. Chưa thay đổi packages/contracts hoặc design-tokens.

## Đã sửa

- ScenesPage import useEffect, khắc phục ReferenceError gây crash trang chia cảnh.
- Tải cảnh có cancellation khi đổi content/rời trang, trạng thái loading/error/empty; nút quay lại giữ đúng content ID. Giữ GET content hiện có để lấy cả visualDescription và trạng thái audio.
- Sao chép imagePrompt/videoPrompt thực sự gọi Clipboard API, có báo lỗi và cleanup timer.
- ContentEditorPage đọc failedReason từ API job khi FAILED/CANCELLED, dừng trạng thái chờ và refresh số dư sau thành công/lỗi.
- Polling tuần tự, không gửi request chồng nhau; hủy khi đổi content/rời trang, giới hạn chờ 3 phút và timeout mỗi request 30 giây. Timeout phía UI không hủy job backend, thông báo tránh bấm tạo lại ngay.
- Tự tạo Project/Content khóa thao tác ngay khi bắt đầu; tên project lấy tối đa 10 từ đầu chủ đề và cập nhật content ID qua router, để nút chia cảnh không dùng ID null. Không retry tự động các POST tạo job.
- Dropdown nền tảng/tone lưu event.target.value, không lưu event object vào payload Gemini.
- Dọn khai báo/import không dùng đang khiến TypeScript build thất bại.
- Backend giữ bản sửa Scene.create(..., { session, ordered: true }) đã xác minh transaction DB thật ở phiên trước.

## Kiểm tra

- Frontend production build (TypeScript + Vite): PASS. Lần đầu trong sandbox lỗi spawn EPERM; lần chạy ngoài sandbox được phê duyệt và PASS.
- 5 tests frontend polling: PASS (terminal states, request tuần tự, abort, timeout, lỗi mạng).
- Backend build + 12 tests content: PASS.
- Frontend lint không có error; còn warnings ở các phần UI hiện có, gồm React set-state-in-effect và biến catch không dùng.
- Chưa kiểm thử browser end-to-end với phiên Google thật hoặc gọi Gemini có phí trong phiên này. Không tự tạo lại job của user.
