# Thiết kế Mô hình Dữ liệu (Data Model) - v0.2

Sử dụng MongoDB (Mongoose) làm Database chính.

## 1. Cấu trúc Collection & Schema cơ bản

### 1.1. Hệ thống Tài khoản & Xác thực

#### `users`
- `_id`: ObjectId
- `email`: String (Đã chuẩn hóa lowercase, trim) (Required, Unique Index)
- `googleId`: String (Optional, Partial Unique Index cho giá trị tồn tại)
- `displayName`: String (Required)
- `avatarAssetId`: ObjectId (Ref: `media_assets`, Optional)
- `roles`: Array[Enum(`OWNER`, `ADMIN`, `SUPPORT`)] (Optional, tách biệt với gói cước, chỉ dùng cho phân quyền Admin).
- `status`: Enum (`ACTIVE`, `BANNED`) (Required)
- `createdAt`, `updatedAt`
- *Ownership*: Hệ thống làm chủ. Banned user sẽ bị từ chối mọi Access Token mới.

#### `sessions`
- `_id`: ObjectId
- `userId`: ObjectId (Ref: `users`) (Required, Index)
- `tokenFamily`: String (UUID, Required) - Nhận diện chuỗi refresh token.
- `refreshTokenHash`: String (Required)
- `deviceInfo`: String (Optional)
- `expiresAt`: Date (Required, TTL Index dọn rác)
- `revokedAt`: Date (Optional) - Nếu bị thu hồi hoặc đã xoay vòng.
- *Invariant*: Refresh request đồng thời được cấp grace period ngắn cho token cũ để tránh race condition, nhưng nếu detect token cũ bị dùng ngoài grace period, toàn bộ `tokenFamily` sẽ bị revoked.

#### `otp_challenges`
- `_id`: ObjectId
- `email`: String (Required, Index)
- `purpose`: Enum (`LOGIN`, `LINK_ACCOUNT`) (Required)
- `codeHash`: String (Required) - Mã OTP băm bằng secret server/HMAC, không lưu plain text.
- `attempts`: Number (Mặc định 0) - Tăng khi nhập sai.
- `expiresAt`: Date (Required, TTL Index)
- `consumedAt`: Date (Optional)
- *Invariant*: Tiêu thụ nguyên tử (atomic update `consumedAt` và kiểm tra `attempts`).

### 1.2. Hệ thống Gói cước, Credit & Tác vụ

#### `subscriptions` (Nguồn chân lý về Gói cước)
- `_id`: ObjectId
- `userId`: ObjectId (Ref: `users`) (Required, Unique Index)
- `plan`: Enum (`FREE`, `PLUS`, `PRO`) (Required)
- `validUntil`: Date (Optional cho FREE, Required cho PLUS/PRO)
- `status`: Enum (`ACTIVE`, `EXPIRED`, `CANCELLED`)
- `createdAt`, `updatedAt`

#### `wallets` (Ví Credit)
- `_id`: ObjectId
- `userId`: ObjectId (Ref: `users`) (Required, Index)
- `bucket`: Enum (`FREE`, `PAID`) (Required)
- `available`: Number (Integer, Required, Mặc định 0)
- `reserved`: Number (Integer, Required, Mặc định 0)
- *Index*: Unique(`userId`, `bucket`)
- *Lưu ý*: Không gộp mọi kỳ hết hạn vào `expiresAt` chung. Dùng `credit_lots` để quản lý các đợt credit có hạn sử dụng khác nhau trong cùng bucket.

#### `credit_lots` (Lô Credit chi tiết)
- `_id`: ObjectId
- `walletId`: ObjectId (Ref: `wallets`) (Required, Index)
- `amount`: Number (Sức chứa ban đầu)
- `available`: Number (Còn lại)
- `expiresAt`: Date (Required, TTL or cron sweep)
- `createdAt`

#### `credit_reservations` (Phiếu tạm giữ)
- `_id`: ObjectId
- `jobId`: ObjectId (Ref: `jobs`) (Required, Unique Index)
- `allocations`: Array[{ lotId: ObjectId, walletId: ObjectId, amount: Number }]
- `status`: Enum (`HELD`, `SETTLED`, `RELEASED`)
- `createdAt`
- *Invariant*: Cập nhật `SETTLE` và `RELEASE` cạnh tranh trạng thái `HELD`. Chỉ 1 bên thành công. Hết hạn credit không tái kích hoạt khi RELEASE (phần trả về phải `EXPIRE` ngay trong transaction nếu lot đã hết hạn).

#### `credit_ledgers` (Sổ cái bất biến)
- `_id`: ObjectId
- `walletId`: ObjectId (Ref: `wallets`) (Required, Index)
- `transactionType`: Enum (`GRANT`, `RESERVE`, `SETTLE`, `RELEASE`, `EXPIRE`)
- `deltaAvailable`: Number (Biến động của available)
- `deltaReserved`: Number (Biến động của reserved)
- `referenceId`: String (ID của Job/Order/Reservation) (Required)
- `createdAt`
- *Index*: Compound Unique(`referenceId`, `transactionType`, `walletId`) để đảm bảo Idempotency cho từng allocation.

#### `jobs` (Tác vụ bất đồng bộ)
- `_id`: ObjectId
- `ownerId`: ObjectId (Ref: `users`) (Required, Index)
- `type`: Enum (`TTS`, `AI_CONTENT`, `AI_SPLIT`, `AI_PROMPT_GEN`, `AI_ANALYSIS`)
- `status`: Enum (`QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELLED`) (Index)
- `payload`: Object (Chứa `sourceRevision` để đối chiếu).
- `reservationId`: ObjectId (Ref: `credit_reservations`)
- `idempotencyKey`: String (Unique Index)
- `executionClaim`: String (Worker ID/Token, chống ghi đè khi worker cũ response chậm)
- `attempts`: Number
- `result`: Object
- `error`: Object (Đã lọc secret)
- `createdAt`, `updatedAt`

#### `outbox` (Transactional Outbox)
- `_id`: ObjectId
- `topic`: String (Tên Queue BullMQ)
- `payload`: Object
- `status`: Enum (`PENDING`, `DISPATCHED`) (Index)
- `createdAt`
- *Invariant*: Tạo cùng lúc với MongoDB Transaction của Job. Dispatcher sẽ đọc và push sang BullMQ.

### 1.3. Hệ thống Sáng tạo (Workspaces, Projects, Contents, Scenes)

#### `workspaces`
- `_id`: ObjectId
- `ownerId`: ObjectId (Ref: `users`) (Required, Index)
- `name`: String
- `createdAt`, `updatedAt`

#### `projects`
- `_id`: ObjectId
- `workspaceId`: ObjectId (Ref: `workspaces`) (Required, Index)
- `name`: String
- `visualBible`: String (Hướng dẫn phong cách hình ảnh chung)
- `thumbnailPrompt`: String
- `createdAt`, `updatedAt`

#### `contents` (Văn bản gốc)
- `_id`: ObjectId
- `projectId`: ObjectId (Ref: `projects`) (Required, Unique Index)
- `rawText`: String
- `metadata`: Object
- `revision`: Number (Tự tăng mỗi khi sửa đổi)
- `createdAt`, `updatedAt`

#### `scenes` (Cảnh đã chia)
- `_id`: ObjectId
- `projectId`: ObjectId (Ref: `projects`) (Required, Index)
- `order`: Number (Thứ tự kịch bản, không phải timeline dựng phim)
- `narration`: String (Lời đọc)
- `visualDescription`: String (Mô tả cảnh)
- `imagePrompt`: String
- `videoPrompt`: String
- `estimatedDuration`: Number
- `sourceContentRevision`: Number (Revision của `contents` lúc tạo ra cảnh này).
- `revision`: Number (Tăng khi sửa cảnh)
- `voiceId`: ObjectId (Ref: `voices`, Optional)
- `ttsAudioId`: ObjectId (Ref: `media_assets`, Optional)
- `createdAt`, `updatedAt`
- *Invariant*: Nếu `sourceContentRevision` cũ hơn `contents.revision`, kết quả AI được đánh dấu stale (cũ). Khi ghi kết quả AI, phải check revision không đổi.

### 1.4. Voice & Media

#### `media_assets` (Thống nhất File)
- `_id`: ObjectId
- `ownerId`: ObjectId (Ref: `users`) (Required, Index)
- `provider`: Enum (`CLOUDINARY`)
- `providerAssetId`: String (Required, Unique Index)
- `resourceType`: Enum (`IMAGE`, `VIDEO`, `AUDIO`)
- `deliveryType`: Enum (`PUBLIC`, `AUTHENTICATED`)
- `mimeType`, `size`, `duration`: Mixed
- `createdAt`
- *Ownership*: Tài sản AUTHENTICATED phải được kiểm tra quyền sở hữu bằng Middleware trước khi backend tạo Signed URL tạm thời cho Client. Không lưu Signed URL trong Database.

#### `voices`
- `_id`: ObjectId
- `name`: String
- `provider`: String
- `modelVersion`: String
- `type`: Enum (`SYSTEM`, `CLONED`)
- `status`: Enum (`ACTIVE`, `REVOKED`)
- `ownerId`: ObjectId (Ref: `users`, Nullable cho SYSTEM) (Index)
- `createdAt`, `updatedAt`

#### `voice_enrollments` (Dành cho Voice Cloning)
- `_id`: ObjectId
- `voiceId`: ObjectId (Ref: `voices`) (Required, Unique Index)
- `referenceAssetIds`: Array[ObjectId] (Ref: `media_assets`)
- `consentAssetId`: ObjectId (Ref: `media_assets`) (Có dữ liệu xác minh, thời điểm)
- `revision`: Number
- `status`: Enum (`PENDING`, `READY`, `DELETED`)
- *Quy tắc Revoke*: Khi Voice bị thu hồi, hệ thống đánh dấu status là DELETED, xóa reference assets. Worker phải check trạng thái trước inference và trước publish. Nếu phát hiện revoke: không công bố audio, dọn output, release credit 1 lần.

### 1.5. Chống Lạm Dụng (Abuse Control)

#### `device_identities` (Định danh thiết bị ngẫu nhiên)
- `_id`: ObjectId (Mã device ID tự sinh từ server, lưu HTTP-only cookie dài hạn ở client).
- `createdAt`

#### `device_account_associations`
- `deviceId`: ObjectId (Ref: `device_identities`)
- `userId`: ObjectId (Ref: `users`)
- `lastSeenAt`: Date
- `ipSignals`: Array[String] (Chỉ dùng làm tín hiệu rủi ro, không khóa cứng).

#### `free_credit_grants`
- `userId`: ObjectId (Ref: `users`)
- `deviceId`: ObjectId (Ref: `device_identities`)
- `grantMonth`: String (YYYY-MM theo Asia/Ho_Chi_Minh)
- *Index 1*: Unique(`userId`, `grantMonth`)
- *Index 2*: Compound(`deviceId`, `grantMonth`)
- *Invariant*: Sử dụng Atomic counter cho deviceId để đảm bảo count < 3. Tăng count và ghi ledger, ví cùng 1 transaction. Lịch sử không bị xóa khi sang tháng.
