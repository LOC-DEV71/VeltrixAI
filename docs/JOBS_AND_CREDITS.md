# Hệ thống Job và Credit (Jobs & Credits) - v0.2

## 1. Cơ chế Quản lý Credit (Wallets & Ledgers)

Hệ thống dùng mô hình Ví (Wallet) và Sổ Cái (Ledger) bất biến trong MongoDB để đảm bảo lượng Credit không bao giờ âm hoặc bị nhân đôi. Khái niệm `amount` mơ hồ bị loại bỏ, thay bằng `available` và `reserved`.

### 1.1. Ví dụ Bắt buộc về Biến động Số dư
*Các giao dịch luôn ghi nhận sự thay đổi (`deltaAvailable`, `deltaReserved`) và cộng dồn vào `wallets` bằng Transaction.*

- **1. Cấp Credit (GRANT 100)**
  - Ledger: `GRANT` | `deltaAvailable: +100`, `deltaReserved: 0`
  - Wallet: `available: 100`, `reserved: 0`
- **2. Tạm giữ (RESERVE 20)**
  - Ledger: `RESERVE` | `deltaAvailable: -20`, `deltaReserved: +20`
  - Wallet: `available: 80`, `reserved: 20`
- **3. Chốt phí thực tế (SETTLE phí 15)**
  - Ledger: `SETTLE` | `deltaAvailable: +5`, `deltaReserved: -20` (Trả lại 5 thừa, trừ hẳn 20 giữ).
  - Wallet: `available: 85`, `reserved: 0`
- **4. Hủy/Thất bại (FAILED)**
  - Ledger: `RELEASE` | `deltaAvailable: +20`, `deltaReserved: -20`
  - Wallet: `available: 100`, `reserved: 0`

### 1.2. Invariants & Rules
- Credit là số nguyên đại diện cho đơn vị nhỏ nhất.
- Sử dụng `credit_lots` để lưu các kỳ hạn khác nhau trong cùng một bucket.
- Sử dụng `credit_reservations` thay vì chỉ lưu 1 mã ID. Mỗi reservation quản lý mảng allocations tới các lot.
- Khi SETTLE và RELEASE, hai hành động này cạnh tranh thay đổi trạng thái `HELD` của `credit_reservations`. Chỉ một bên được thành công (Compare-and-Swap/Transaction).
- Không tự thu vượt reservation, không ghi nợ. Nếu chi phí Provider vượt dự toán, hệ thống (System) chịu phần vượt; giới hạn rủi ro bằng cách cap độ dài text/audio ở input.
- Credit hết hạn không được tái kích hoạt: Khi RELEASE, nếu `credit_lot` nguồn đã hết hạn, phần trả về phải được ghi giao dịch `EXPIRE` ngay trong cùng transaction.
- Hết hạn Subscription không đồng nghĩa xóa ngay Free Credit, chỉ hết hạn lượng Credit của kỳ đó theo lot.
- Lịch cấp phát Free tuân theo múi giờ `Asia/Ho_Chi_Minh`.
- Idempotency cho Ledger phân biệt chi tiết từng Wallet và Allocation. Cập nhật Ví, Reservation, Ledger và Lot trong chung 1 Transaction.

## 2. Hệ thống Job & Transactional Outbox

### 2.1. Phân chia trách nhiệm
- **MongoDB**: Đóng vai trò nguồn lưu trữ bền vững (Durable) của nghiệp vụ.
- **BullMQ (Redis)**: Đóng vai trò thực thi (Execution), quản lý Timeout, Delay, Retry và Concurrency.
- **Internal Python API**: Nhận request từ Node.js Worker qua HTTP, không trực tiếp lắng nghe BullMQ.

### 2.2. Transactional Outbox Pattern
Vấn đề: Lưu Job vào MongoDB thành công nhưng push BullMQ thất bại dẫn đến treo Job (hoặc ngược lại).
Giải pháp:
1. Mở MongoDB Transaction.
2. Kiểm tra và RESERVE Credit trong `wallets`, ghi `credit_ledgers`.
3. Tạo `jobs` record (trạng thái QUEUED).
4. Tạo `outbox` record.
5. Commit Transaction.
6. Dispatcher (cron/listener) đọc `outbox` và push vào BullMQ, sau đó mark outbox DISPATCHED. Chạy lại an toàn vì push vào BullMQ có JobID (Idempotent).

### 2.3. Xử lý Worker & Lỗi
- Worker Node.js nhận Job từ BullMQ. Node.js sẽ gọi HTTP sang Python TTS hoặc Gemini API.
- Worker sử dụng cơ chế `executionClaim` (ghi worker_id + timestamp vào DB) để tránh Worker cũ (bị treo) response ghi đè kết quả của Worker mới (đã retry).
- Không có "Exactly Once" với Provider. Idempotency nằm ở tầng nghiệp vụ MongoDB. Worker đọc trạng thái Job (transition từ QUEUED/PROCESSING). Nếu không hợp lệ thì từ chối.
- Chốt Credit (Settle/Release) và cập nhật Trạng thái Job tối đa MỘT LẦN ở mức nghiệp vụ.
- **Revoke Voice**: Worker kiểm tra trạng thái Voice trước khi gọi Provider (Inference) và kiểm tra lại trước khi Publish (Ghi kết quả). Nếu phát hiện bị Revoke, hủy kết quả, xóa file tạm, đánh FAILED và RELEASE credit đúng 1 lần.
