# CDX-001 — Sửa lỗi không lưu được cảnh

Ngày 2026-10-01, kiểm tra DB theo content trong ảnh người dùng: ba job gần nhất đều FAILED với lỗi `Cannot call create() with a session and multiple documents unless ordered: true is set`.

Nguyên nhân: ContentWorker gọi Scene.create với nhiều document và Mongo session nhưng thiếu `ordered: true`. Gemini đã qua bước lấy/parse output, nhưng transaction ghi cảnh thất bại. Test mock trước đây không kiểm tra điều kiện này của Mongoose.

Đã thêm `ordered: true` vào Scene.create, bổ sung assertion tương ứng cho test worker và build lại dist.

Kiểm tra:

- Build và 12 tests content PASS.
- Kiểm tra DB thật: tạo 3 cảnh trong transaction với session + ordered, sau đó abort transaction và xác nhận không còn fixture. PASS. Không gọi Gemini hoặc tạo job cho user.

Frontend cần Antigravity sửa: ContentEditorPage đang đọc `job.error` khi FAILED, API jobs đã chốt trả `data.failedReason`. Dùng failedReason để hiển thị lỗi cụ thể; kiểm tra lại polling/cleanup nếu UI vẫn LOADING dù response job đã FAILED.

Khởi động lại backend chạy dist để nạp bản mới; job FAILED cũ không được tự chạy lại. Sau restart, người dùng có thể tải lại trang và tạo một job mới. Không tự động retry job nhằm tránh gọi AI/trừ credit ngoài ý muốn.
