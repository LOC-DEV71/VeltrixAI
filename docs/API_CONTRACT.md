# Giao thức API (API Contract) - v0.2

Hệ thống cung cấp API RESTful cho Client và Admin. Response Format tiêu chuẩn vẫn giữ nguyên như v0.1 (`success`, `data`, `error`).

## 1. Giao thức Xác thực (Auth Contract)

### 1.1. Login với Google
- **Endpoint:** `POST /api/v1/auth/google`
- **Request Body:**
  ```json
  { "credential": "GOOGLE_JWT_TOKEN" }
  ```
- **Xử lý:** Backend tự gọi verify token của Google để lấy `sub` (googleId) và `email`. Nếu hệ thống đã có email nhưng chưa map `googleId`, ném lỗi `ACCOUNT_EXISTS_REQUIRE_LINK`.
- **Response:**
  - Headers: Set-Cookie `accessToken` (HttpOnly, Secure, SameSite=Strict).
  - Body: Trả về thông tin User hiện tại.

### 1.2. Yêu cầu OTP Email
- **Endpoint:** `POST /api/v1/auth/otp/request`
- **Request Body:**
  ```json
  { "email": "user@example.com", "purpose": "LOGIN" | "LINK_ACCOUNT" }
  ```
- **Rate Limit:** Tối đa X request mỗi IP/Email theo cấu hình động.
- **Xử lý:** Băm mã OTP, tạo `otp_challenges` document.

### 1.3. Xác minh OTP
- **Endpoint:** `POST /api/v1/auth/otp/verify`
- **Request Body:**
  ```json
  { "email": "user@example.com", "code": "123456", "purpose": "LOGIN" }
  ```
- **Xử lý:** Kiểm tra nguyên tử số `attempts`, hash code, thời hạn.
- **Response:** Set-Cookie `accessToken` như luồng Google. Trả về thông tin User.

### 1.4. Refresh Token
- **Endpoint:** `POST /api/v1/auth/refresh`
- **Request (Cookie/Body):** Tùy thuộc cấu hình (nên để HttpOnly Cookie cho RefreshToken hoặc truyền body).
- **Xử lý:** So khớp Hash, kiểm tra Revoke, xử lý Token Family Rotation (Grace Period).
- **Response:** Cấp lại AccessToken & RefreshToken mới. Nếu phát hiện rủi ro, trả `401 UNAUTHORIZED`.

### 1.5. Logout
- **Endpoint:** `POST /api/v1/auth/logout`
- **Xử lý:** Đánh dấu `revokedAt` cho session hiện tại trong DB. Clear toàn bộ cookies.

### 1.6. Get Current User
- **Endpoint:** `GET /api/v1/auth/me`
- **Yêu cầu:** Gửi kèm AccessToken qua Cookie (Bearer nếu thiết kế tách biệt).
- **Phản hồi:** Trả về data User bao gồm cấu trúc Plan (Subscriptions cache).

## Quản lý Project cho Studio

### Tạo dự án

- `POST /api/projects`, yêu cầu accessToken cookie và header `x-csrf-token` khớp cookie CSRF.
- Body: `{ "name": "Ý tưởng video mới", "workspaceId": "507f1f77bcf86cd799439011" }`. `workspaceId` tùy chọn; khi bỏ qua, backend dùng workspace cũ nhất do user sở hữu (createdAt rồi _id tăng dần). User chưa có workspace được tạo `My Workspace`.
- `name` phải là string có 1–200 ký tự sau trim. Không giới hạn số dự án của user, không yêu cầu tên dự án duy nhất.
- `201`: `{ "success": true, "data": { "_id": "...", "workspaceId": "...", "name": "Ý tưởng video mới", "createdAt": "...", "updatedAt": "..." } }`. Data là document Project, có thể chứa các trường model bổ sung như revision/version.
- `400 INVALID_INPUT`: tên/workspaceId không hợp lệ; `401`: chưa đăng nhập; `403 FORBIDDEN`: sai CSRF hoặc workspace thuộc user khác; `404 NOT_FOUND`: workspace được chỉ định không tồn tại.
- Không ngầm tạo Content/Scenes/Audio. FE có thể lấy 10 từ đầu chủ đề làm `name` rồi gọi API này trước `POST /api/contents`.

### Chi tiết dự án

- `GET /api/projects/:id`, yêu cầu accessToken cookie; chỉ chủ sở hữu workspace được đọc.
- `200`: `{ "success": true, "data": { "_id": "...", "workspaceId": "...", "name": "...", "createdAt": "...", "updatedAt": "..." } }`.
- `400 INVALID_INPUT`: ID sai định dạng; `401`: chưa đăng nhập; `403 FORBIDDEN`: sai quyền sở hữu; `404 NOT_FOUND`: Project không tồn tại.

### Đổi tên và xóa dự án

- `PATCH /api/projects/:id`, body `{ "name": "Tên mới" }`. Trim tên, giới hạn 1–200 ký tự; trả `200 { success: true, data: project }`.
- `DELETE /api/projects/:id`, body `{ "confirmName": "Tên hiện tại chính xác" }`. So sánh nguyên chuỗi, phân biệt hoa/thường và khoảng trắng, không trim tên xác nhận. Sai tên trả `400 CONFIRMATION_MISMATCH`; tên thay đổi trong lúc xác nhận trả `409 PROJECT_CHANGED`.
- Cả hai yêu cầu đăng nhập, quyền sở hữu workspace và CSRF header/cookie hợp lệ. Sai quyền trả 403, project không tồn tại/đã xóa trả 404.
- Có job QUEUED/PROCESSING trong project: xóa trả `409 PROJECT_BUSY`. Không tự hủy job hoặc hoàn credit khi xóa.
- Xóa dùng `deletedAt` (xóa mềm): project biến mất khỏi danh sách và kiểm tra quyền sở hữu coi project như không tồn tại, nên content/scenes liên quan không còn truy cập qua project. Dữ liệu DB và lịch sử credit được giữ, không xóa workspace hoặc các project khác. Không có UI khôi phục trong thay đổi này.
- Thành công: `200 { "success": true, "data": { "id": "..." } }`.

### Content theo dự án

- `GET /api/contents?projectId=:projectId`, yêu cầu accessToken cookie và quyền sở hữu workspace của Project.
- `200`: `{ "success": true, "data": [ ...contentDocuments ] }`; dự án chưa có content trả `data: []`.
- `400 INVALID_INPUT`: projectId sai định dạng, rỗng, mảng hoặc object; `403 FORBIDDEN`: Project không thuộc user hoặc không tồn tại. Giữ hành vi 403 hiện có của API này.
- Bỏ projectId vẫn trả `data: []` như trước; API này không phải API liệt kê tất cả content của user.
- Mỗi Project hiện có tối đa một Content (unique index trên Content.projectId); một Workspace có nhiều Projects (workspaceId trong Project không unique). Không cần migration để hỗ trợ nhiều Project.

### Khôi phục cấu hình kịch bản

`GET /api/contents/:id` trả thêm `data.generationSettings`:

```json
{
  "topic": "Khi Trái Đất ngừng quay",
  "platform": "tiktok",
  "audience": "Gen Z, thích hài hước",
  "tone": "funny"
}
```

Worker lưu cấu hình cùng transaction ghi content/scenes, nên cấu hình phản ánh lần tạo đã lưu thay vì lần thử tạo bị lỗi parse. Với content cũ chưa lưu cấu hình, API chỉ đọc bốn trường từ job AI_CONTENT COMPLETED gần nhất thuộc user và content đó; không ghi dữ liệu trong GET. Nếu không có lịch sử, trả `null`. FE khôi phục các trường có dữ liệu; trường thiếu dùng mặc định. Không có migration bắt buộc hay thay đổi packages/contracts.

## CDX-001. Cảnh từ kịch bản AI

- **Endpoint:** `GET /api/contents/:id/scenes`.
- **Xác thực:** Cookie accessToken; chỉ chủ sở hữu workspace chứa content được đọc.
- **Response 200:**

```json
{
  "success": true,
  "data": {
    "scenes": [
      {
        "id": "507f1f77bcf86cd799439011",
        "order": 1,
        "title": "Hook mở đầu",
        "narration": "Bạn nghĩ Gru đã hoàn lương? Nhầm to rồi...",
        "estimatedDuration": 5,
        "imagePrompt": "Close-up cinematic shot of Gru looking shocked, dramatic lighting --ar 9:16",
        "videoPrompt": "Camera fast zoom in to Gru's shocked face, comedic fast-paced motion, vertical video"
      }
    ]
  }
}
```

- `id` là chuỗi ObjectId của document Scene, ổn định cho cảnh đó; không phải số thứ tự hay ID do Gemini cung cấp. Tạo lại kịch bản thay cảnh cũ bằng cảnh mới và ID mới.
- `order` là số nguyên tăng từ 1; API sắp xếp tăng dần.
- `title`, `narration` là tiếng Việt theo system instruction. `imagePrompt`, `videoPrompt` là tiếng Anh theo system instruction; việc xác thực cấu trúc không thay thế kiểm tra chất lượng ngôn ngữ.
- `estimatedDuration` là số giây dương, tối đa 300 mỗi cảnh; không mặc định thành 10 khi model trả dữ liệu sai.
- Mỗi cảnh ở endpoint này có đúng bảy keys trong ví dụ. `visualDescription` vẫn lưu nội bộ, không thuộc response này.
- Chưa có cảnh: `200` với `{ "success": true, "data": { "scenes": [] } }`.
- ID không hợp lệ: `400 INVALID_INPUT`; content không tồn tại: `404 NOT_FOUND`; chưa xác thực: `401`; sai chủ sở hữu: `403 FORBIDDEN`.
- Luồng tạo giữ nguyên `POST /api/contents/:id/generate` trả `data.jobId`. Poll `GET /api/jobs/:jobId`; khi `data.status = "COMPLETED"`, `data.result` chứa `{ "scenesCount": N, "scenes": [...] }` cùng bảy keys như trên. FE cũng có thể gọi endpoint scenes để tải lại sau khi refresh trang.
- Đầu ra Gemini không parse/validate được: job `FAILED`, `data.failedReason = "INVALID_GEMINI_SCENES"`; cảnh cũ không bị thay đổi. Worker cố hoàn credit đã giữ; nếu hoàn thất bại, reason thêm `; CREDIT_RELEASE_FAILED` để backend đối soát.
- Cảnh cũ trước CDX-001 thiếu title được trả title dự phòng (`Hook mở đầu` hoặc `Cảnh N`); prompt chưa có được trả chuỗi rỗng. Cần tạo lại kịch bản để có đầy đủ nội dung theo system instruction mới.

## 2. Bảo Mật API
- **CSRF:** Sử dụng SameSite=Strict/Lax cho AccessToken Cookie và yêu cầu custom Header `X-Requested-With` hoặc Anti-CSRF Token tùy biến cho các POST/PUT/DELETE request.
- **Error Codes:**
  - `400`: `INVALID_INPUT` (Zod Details), `ACCOUNT_EXISTS_REQUIRE_LINK`, `OTP_INVALID`, `OTP_EXPIRED`.
  - `401`: `UNAUTHORIZED` (Token hết hạn/bị thu hồi).
  - `403`: `FORBIDDEN` (Sai quyền sở hữu, Hết Credit).
  - `429`: `TOO_MANY_REQUESTS`.
  - `500`: `INTERNAL_SERVER_ERROR`.

## AG-018: Scene TTS jobs and protected playback

`POST /api/scenes/:id/tts` requires access-token cookie, CSRF cookie/header and `Idempotency-Key` (8..128 letters/digits/underscore/period/hyphen). As of AG-019, body is `{ "voiceId": "<database id from GET /api/voices>" }`; voiceId is required and named `voice`/`providerVoiceId` inputs are rejected. Narration comes from the owned scene.

New job: `202 { "success": true, "data": { "jobId": "...", "status": "QUEUED", "reservedCredits": 1, "reused": false } }`. Same owner/key/scene/voice returns the original job (200); changed scene or voice returns 409. Cost is computed from snapshotted text and the configured TTS credit rate, not accepted from the client. Insufficient credit returns 402; missing TTS/Cloudinary configuration returns 503 before reserve.

Poll `GET /api/jobs/:id`. Completed TTS result:

```json
{
  "audioId": "...",
  "sceneId": "...",
  "audioUrl": "/api/media/.../audio",
  "contentType": "audio/wav",
  "duration": 4.56,
  "bytes": 437804,
  "chargedCredits": 1
}
```

`GET /api/media/:id/audio` requires the owner's authenticated cookie and a live project, returns `audio/wav` with `private, no-store`. A foreign owner gets 404; an unauthenticated caller gets 401. The browser calls this backend path, never Python `/synthesize` or a Cloudinary signed URL. Use the API origin for the relative audioUrl.

Stable failure reasons include `TTS_SERVICE_UNAVAILABLE`, `TTS_AUTH_FAILED`, `TTS_INPUT_REJECTED`, `INVALID_TTS_CONTENT_TYPE`, `INVALID_TTS_WAV`, `TTS_AUDIO_TOO_LARGE`, `TTS_AUDIO_DURATION_INVALID`, `TTS_STALE_SCENE`, `TTS_PROJECT_UNAVAILABLE`, `TTS_RETRY_EXHAUSTED`, and Cloudinary upload/delivery errors. Terminal failure releases held credit once; completed replay does not charge again.

Deployment, pricing and acceptance details: [AG-018](reports/AG-018.md).

## AG-019: System voices

`GET /api/voices` requires authentication. Response: `{ "success": true, "data": { "systemVoices": [ ... ], "cloneVoices": [] } }`. Only ACTIVE system voices available to the authenticated user's server-owned plan are returned. Each voice includes `id`, `name`, `provider`, `language`, `locale`, `gender`, `planEntitlements`, `status`, `isDefault`, `isFree`, `tags`. IDs are Mongo ObjectIds; provider preset names are not client IDs. `isFree` means FREE-plan eligibility; TTS credit pricing still applies.

Select the returned `isDefault=true` voice and pass its `id` as `voiceId`. Backend resolves the provider ID from its database. ACTIVE voice outside the plan: `403 TTS_VOICE_PLAN_DENIED`, without reserve. A valid ObjectId referring to a missing/REVOKED voice results in a job `FAILED` with `TTS_VOICE_NOT_FOUND`/`TTS_VOICE_REVOKED`, releasing credit once. Worker rechecks availability/entitlement before publishing. Idempotent job replay and protected audio delivery retain the AG-018 contracts.

Verified presets, seed/migration and acceptance: [AG-019](reports/AG-019.md).
