# Các vấn đề Mở & Phụ thuộc chưa xác minh (Open Questions)

Dưới đây là danh sách các phụ thuộc hệ thống chưa được kiểm chứng thực tế, cần làm rõ hoặc test hiệu năng trước khi đi vào giai đoạn Code Production:

## 1. Gemini API (Google AI)
- **Model ID**: `gemini-3.1-flash-lite` hiện là tên dự kiến. Cần gọi API xác minh mã Model ID chính thức hợp lệ.
- **Quota & Rate Limit**: Tài liệu hiện liệt kê là Free Tier, nhưng không bảo đảm SLA cho môi trường Production (như User đã đề cập). Cần làm rõ:
  - Giới hạn Request Per Minute (RPM) và Tokens Per Minute (TPM) thực tế của tài khoản hiện tại.
  - Xử lý khi chạm ngưỡng (Delay queue ở BullMQ bao lâu?).
  - Dự kiến khi nào chuyển sang gói Pay-as-you-go để đảm bảo ổn định.

## 2. Internal TTS Service (Python FastAPI + VieNeu/Gwen)
- **Tài nguyên Phần cứng**:
  - Adapter VieNeu/Gwen cần bao nhiêu VRAM (GPU) hoặc CPU để sinh audio trong thời gian chấp nhận được?
  - Hệ thống hiện tại có GPU không? Nếu chỉ dùng CPU, tốc độ sinh (RTF - Real Time Factor) là bao nhiêu?
- **Độ trễ (Latency)**: API gọi từ Node.js sang Python mất bao lâu cho 1 câu trung bình. Quyết định Timeout cho BullMQ Job TTS.
- **Concurrency**: FastAPI cấu hình Worker như thế nào để nhận nhiều request đồng thời mà không nghẽn phần cứng?

## 3. Hệ thống Lưu trữ & CDN (Cloudinary)
- **Giới hạn File**: Cloudinary free tier có giới hạn dung lượng lưu trữ (Storage) và băng thông (Bandwidth). Đối với app sinh Audio liên tục, cần đo đếm lượng Audio trung bình sinh ra/tháng để ước lượng chi phí.
- **Private Audio**: Đã chốt dùng Authenticated URL của Cloudinary. Cần xác minh độ trễ khi lấy Signed URL ở backend và tốc độ phát trên Frontend đối với URL loại này.

## 4. Cơ chế Sinh Device ID (Chống lạm dụng)
- Cần quyết định thư viện (FingerprintJS bản free, hay tự viết logic tạo hash từ User Agent + IP + Accept Language) ở Client/Backend để nhận diện thiết bị ở mức độ chấp nhận được.

## 5. Giá Gói & Credit
- Số lượng Credit cụ thể cho gói Free/Plus/Pro.
- Bảng quy đổi: 1 Credit = Bao nhiêu Token Gemini? 1 Credit = Bao nhiêu giây TTS? (Cần dựa vào chi phí từ mục 1, 2, 3 để chốt).


# Thiết kế Mô hình Dữ liệu (Data Model) - v0.1

Sử dụng MongoDB (Mongoose) làm Database chính.

## 1. Cấu trúc Collection & Schema cơ bản

### 1.1. Collection: `users`
- `_id`: ObjectId
- `email`: String (Index, Unique)
- `googleId`: String (Index, Sparse)
- `displayName`: String
- `avatarUrl`: String
- `plan`: Enum (`FREE`, `PLUS`, `PRO`) - Gói cước hiện tại.
- `roles`: Array[String] (Chỉ dùng cho Admin: `OWNER`, `ADMIN`, `SUPPORT`). Role của Client được mặc định thông qua ownership resource.
- `deviceHistory`: Array[{ deviceId: String, ip: String, firstSeen: Date, lastSeen: Date }]
- `status`: Enum (`ACTIVE`, `BANNED`)
- `createdAt`, `updatedAt`

### 1.2. Collection: `sessions`
- `_id`: ObjectId
- `userId`: ObjectId (Ref: `users`, Index)
- `refreshTokenHash`: String
- `deviceInfo`: String
- `expiresAt`: Date (TTL Index để tự xóa)
- `isRevoked`: Boolean

### 1.3. Collection: `projects`
- `_id`: ObjectId
- `userId`: ObjectId (Ref: `users`, Index)
- `name`: String
- `status`: Enum (`DRAFT`, `COMPLETED`)
- `createdAt`, `updatedAt`

### 1.4. Collection: `scenes`
- `_id`: ObjectId
- `projectId`: ObjectId (Ref: `projects`, Index)
- `order`: Number
- `content`: String (Nội dung kịch bản/lời đọc)
- `visualPrompt`: String (Mô tả cảnh để tạo ảnh/video)
- `voiceId`: ObjectId (Ref: `voices`)
- `audioId`: ObjectId (Ref: `audios`, lưu file âm thanh đã sinh)
- `version`: Number (Mã phiên bản nội dung để chống ghi đè nhầm kết quả TTS)
- `createdAt`, `updatedAt`

### 1.5. Collection: `voices`
- `_id`: ObjectId
- `name`: String
- `type`: Enum (`SYSTEM`, `CLONED`)
- `ownerId`: ObjectId (Ref: `users`, Nullable nếu là hệ thống)
- `providerVoiceId`: String (Mapping với engine TTS)
- `isPremium`: Boolean
- `createdAt`, `updatedAt`

### 1.6. Collection: `audios`
- `_id`: ObjectId
- `userId`: ObjectId (Ref: `users`, Index)
- `cloudinaryPublicId`: String
- `secureUrl`: String
- `duration`: Number
- `createdAt`

### 1.7. Collection: `credit_ledger` (Sổ cái Credit)
- `_id`: ObjectId
- `userId`: ObjectId (Ref: `users`, Index)
- `transactionType`: Enum (`GRANT_FREE`, `GRANT_PURCHASE`, `RESERVE`, `COMMIT`, `REFUND`)
- `amount`: Number (Âm nếu tiêu xài, Dương nếu nạp/cấp)
- `referenceId`: String (Mã Job hoặc Order liên kết)
- `description`: String
- `createdAt`
*(Balance của User sẽ được tính bằng cách sum(amount) dựa trên các giao dịch được chốt hoặc query cache có cơ chế đồng bộ)*

### 1.8. Collection: `jobs` (Trạng thái Tác vụ Bất đồng bộ)
*(Dữ liệu chính nằm ở Redis BullMQ, nhưng MongoDB giữ bản lưu lịch sử)*
- `_id`: ObjectId (Job ID)
- `userId`: ObjectId (Ref: `users`)
- `type`: Enum (`TTS`, `GEMINI_GENERATE`)
- `status`: Enum (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`)
- `payload`: Object
- `result`: Object
- `error`: String
- `createdAt`, `updatedAt`

## 2. Các Index quan trọng cần thiết lập
- `users`: `email` (Unique), `googleId` (Sparse)
- `sessions`: `userId`, `expiresAt` (TTL)
- `projects`: `userId`
- `scenes`: `projectId`, `order`
- `credit_ledger`: `userId` (Phục vụ tính tổng balance nhanh), `referenceId`
- `jobs`: `userId`, `status`


# Giao thức API (API Contract) - v0.1

Hệ thống cung cấp API RESTful cho Client và Admin (thông qua Node.js Backend).

## 1. Định dạng Phản hồi Tiêu chuẩn (Response Format)
Mọi response đều trả về chuẩn JSON, phân tách rõ ràng Thành công và Lỗi.

**Thành công (200, 201):**
```json
{
  "success": true,
  "data": { ... },
  "meta": { ... } // (Optional) Dùng cho phân trang
}
```

**Lỗi (400, 401, 403, 404, 500):**
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": [] // (Optional) Chi tiết lỗi validation (VD: từ Zod)
  }
}
```

## 2. Quy ước Phân trang (Pagination)
Dùng Offset-based pagination cơ bản cho V0.1:
- Query parameters: `?page=1&limit=20`
- Meta response:
```json
"meta": {
  "page": 1,
  "limit": 20,
  "totalItems": 150,
  "totalPages": 8
}
```

## 3. Các API Endpoints cơ bản (Draft)

### 3.1. Auth
- `POST /api/v1/auth/google`: Đăng nhập/Đăng ký qua Google Identity token.
- `POST /api/v1/auth/otp/send`: Yêu cầu gửi OTP qua email (Resend).
- `POST /api/v1/auth/otp/verify`: Xác nhận OTP.
- `POST /api/v1/auth/logout`: Thu hồi session và xóa cookie.

### 3.2. Projects & Scenes
- `GET /api/v1/projects`: Lấy danh sách Project của User.
- `POST /api/v1/projects`: Tạo Project mới.
- `GET /api/v1/projects/:id/scenes`: Lấy các cảnh trong Project.
- `POST /api/v1/projects/:id/scenes`: Tạo thêm cảnh.
- `PUT /api/v1/projects/:id/scenes/:sceneId`: Cập nhật nội dung cảnh.
- `POST /api/v1/projects/:id/scenes/:sceneId/split`: Yêu cầu AI (Gemini) chia cảnh.

### 3.3. Job & TTS (Async Actions)
- `POST /api/v1/tts/generate`: Gửi yêu cầu sinh audio (Độc lập hoặc thuộc Scene). 
  *Body*: `{ text, voiceId, projectId (optional), sceneId (optional), version }`
- `GET /api/v1/jobs/:jobId`: Polling trạng thái Job (TTS hoặc AI Content). Trả về status (`PROCESSING`, `COMPLETED`, `FAILED`).

### 3.4. Credits
- `GET /api/v1/credits/balance`: Xem số dư hiện tại.
- `GET /api/v1/credits/history`: Xem lịch sử trừ/nhận tiền.

## 4. Quản lý Lỗi (Error Handling Convention)
- `INVALID_INPUT` (400): Lỗi validate (thiếu trường, sai định dạng).
- `UNAUTHORIZED` (401): Cookie hết hạn, không có token.
- `FORBIDDEN` (403): User không có quyền sở hữu tài nguyên hoặc Admin role không đủ.
- `INSUFFICIENT_CREDITS` (403): Hết credit để thực hiện AI/TTS.
- `RESOURCE_NOT_FOUND` (404): Không tìm thấy bản ghi.
- `RATE_LIMIT_EXCEEDED` (429): Gọi API quá nhanh.
- `INTERNAL_SERVER_ERROR` (500): Lỗi backend không kiểm soát được.


# Xác thực và Phân quyền (Auth & Permissions) - v0.1

## 1. Cơ chế Xác thực (Authentication)
- **Phương thức đăng nhập:**
  - Google Identity Services (Xác thực bằng tài khoản Google, lấy JWT và verify ở Backend). Backend KHÔNG sử dụng Google Session.
  - Email OTP (Sử dụng dịch vụ Resend để gửi OTP).
- **Session Management:**
  - Sử dụng mô hình Access Token / Refresh Token tự quản lý.
  - **Access Token:** Lưu trong `HttpOnly`, `Secure` Cookie để chống XSS. Có thời hạn ngắn.
  - **Refresh Token:** Sinh ngẫu nhiên (hoặc JWT), lưu bản Hash vào CSDL MongoDB để đối chiếu. Hỗ trợ thu hồi (Revoke).
  - Khi Logout: Thu hồi Refresh Token trên DB và xóa Cookie Access Token. Các thao tác nhạy cảm luôn kiểm tra trạng thái Session trong DB để chặn kịp thời.

## 2. Mô hình Phân quyền (RBAC - Role Based Access Control)

### 2.1. Quản trị viên (Admin)
- Các vai trò (Roles) cụ thể dành cho thao tác quản trị trên Admin Portal:
  - `OWNER`: Quyền cao nhất, can thiệp được toàn bộ hệ thống.
  - `ADMIN`: Quản lý người dùng, nội dung chung, credit.
  - `SUPPORT`: Chỉ được xem và hỗ trợ (read-only một số phần).
- Yêu cầu: Ghi Audit Log cho các thao tác nhạy cảm của Admin.

### 2.2. Khách hàng (Client)
- Khách hàng không dùng cơ chế "Role" như Admin mà dùng cơ chế **Quyền sở hữu (Ownership)** và **Gói cước (Entitlements)**.
- **Ownership (Quyền sở hữu):** User A chỉ được sửa/xóa Project, Scene, Audio do User A tạo ra. Backend Middleware phải luôn kiểm tra UserID trùng khớp với bản ghi trong MongoDB.

## 3. Gói cước (Plans & Entitlements)
Free, Plus, Pro **không phải là Role** mà là Gói Dịch vụ. Việc Frontend ẩn/hiện nút tính năng theo gói chỉ là UI/UX. Backend bắt buộc kiểm tra.

- **Gói FREE:**
  - Được nhận giới hạn lượng Free Credit theo chính sách.
  - Chỉ được dùng bộ giọng mặc định do hệ thống cấp (System Voices).
- **Gói PLUS:**
  - Có lượng Credit trả phí cao hơn.
  - Mở khóa toàn bộ giọng Premium (Premium System Voices).
  - Mở tính năng Sao chép giọng cá nhân (Voice Cloning).
- **Gói PRO:**
  - Hoàn toàn giống Plus về Quyền Tính Năng (Features Entitlements).
  - Điểm khác biệt duy nhất là lượng Credit trả phí nhận được mỗi tháng/lần mua lớn hơn.


# Hệ thống Job và Credit (Jobs & Credits) - v0.1

## 1. Hệ thống Job Bất đồng bộ (Async Jobs)
Sinh nội dung bằng Gemini và sinh Voice TTS là các thao tác tốn thời gian, được xử lý ngầm (Background).

### Công nghệ
- **Redis + BullMQ**: Quản lý hàng đợi (Queue), xử lý Retry, kiểm soát đồng thời (Concurrency), và Timeout.
- Mỗi Worker (Node.js hoặc tương tác với Python) lấy Job từ Queue để xử lý.

### Tính toàn vẹn Dữ liệu (Idempotency & Versioning)
- Khi một Job TTS được enqueue cho một Cảnh (Scene), Job lưu `projectId`, `sceneId` và `version` của nội dung tại thời điểm nhấn nút.
- Nếu người dùng sửa nội dung Cảnh trong lúc Job TTS đang chạy, `version` của Cảnh sẽ tăng lên. Khi Job chạy xong, Backend kiểm tra `version`. Nếu `version` cũ hơn hiện tại, không gắn Audio vào Cảnh để tránh ghi đè nhầm (Audio vẫn được lưu để không phí tiền AI).

## 2. Quản lý Credit
MongoDB `credit_ledger` là nguồn chính xác tuyệt đối. Lượng tiền không thể tự sinh ra hay biến mất.

### Luồng trừ tiền an toàn (Reserve - Settle/Release)
1. **Estimate**: Tính toán chi phí dự kiến (số token Gemini, độ dài text TTS).
2. **Pre-check**: Kiểm tra Balance hiện tại có đủ không.
3. **Reserve (Tạm giữ)**: Ghi một dòng trừ tiền `RESERVE` vào MongoDB (Trạng thái Pending) trước khi đẩy vào BullMQ.
4. **Enqueue**: Đẩy Job vào Queue. (Có cơ chế đối soát nếu Reserve xong mà Enqueue rớt thì tự Release lại).
5. **Worker Xử lý**: Gọi API Gemini/TTS.
6. **Settle (Chốt/Hoàn)**:
   - Thành công: Cập nhật dòng Reserve thành `COMMIT` (hoặc tạo dòng chốt chính xác nếu số token ít hơn dự kiến và hoàn phần chênh lệch).
   - Thất bại (Lỗi provider): Trả lại toàn bộ tiền (Ghi dòng `REFUND` cho số tiền đã Reserve). Không trừ tiền cho các lỗi hệ thống.

## 3. Chính sách chống lạm dụng Free Credit
- **Nguyên tắc**: Tối đa 3 tài khoản nhận Free Credit trên một thiết bị mỗi tháng (Asia/Ho_Chi_Minh).
- **Thiết bị (Device)**: 
  - Backend sinh ra một Device Fingerprint / ID kết hợp nhiều yếu tố. Không cam kết xác định đúng 100% phần cứng vật lý, nhưng đủ chặn người dùng cơ bản.
  - Việc đổi mạng (IP), đổi trình duyệt sẽ được theo dõi, nếu có dấu hiệu rủi ro (Nhiều IP/1 Thiết bị hoặc 1 IP/Nhiều Thiết bị) thì đưa vào diện cảnh báo rate limit. Tuyệt đối KHÔNG khóa login chỉ vì trùng IP.
- **Thực thi**:
  - Tại thời điểm Cấp Credit (Grant), Backend sử dụng Redis Lock/Atomic check trong MongoDB để đếm số lượng tài khoản trong tháng của DeviceID đó. Nếu >= 3, từ chối cấp Free Credit cho tài khoản thứ 4 trở đi.
  - Chuyển tháng mới: Số đếm tự reset theo kỳ YYYY-MM.
