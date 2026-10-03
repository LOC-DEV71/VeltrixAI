# API TTS cho Developer

Trang công khai: `/developer`. Tài liệu trong ứng dụng: `/docs?section=developer`.
Tạo, xem và thu hồi token ở `/account/settings`. Danh sách token phân trang 10 bản ghi.

## Xác thực

API nằm dưới `/api/developer/v1`. Gửi `Authorization: Bearer <token>` trên mọi yêu cầu.
Token được tạo với một hoặc nhiều quyền `voices:read`, `tts:write`, `tts:read` và hạn dùng 1–365 ngày.
Chỉ trả token đầy đủ một lần khi tạo. Database chỉ lưu SHA-256; nhật ký tạo/thu hồi không chứa token.
API không chấp nhận cookie thay cho Bearer token. Token hết hạn, bị thu hồi hoặc chủ tài khoản bị cấm mất quyền truy cập.
Lưu token trong biến môi trường ở máy chủ tích hợp, không đưa vào frontend, URL hoặc log.

## Endpoint

| Phương thức và đường dẫn | Quyền | Kết quả |
| --- | --- | --- |
| GET `/voices?page=1` | voices:read | `{systemVoices, cloneVoices, page, limit, total}`; 10 giọng/trang |
| GET `/limits` | tts:read | Đơn giá `creditsPer100Chars`, `maxTextLength` (null là không giới hạn), `available`, revision |
| POST `/tts/jobs` | tts:write | Gửi `{text, voiceId}` và header `Idempotency-Key`; trả `{jobId, status, reservedCredits, reused}` |
| GET `/tts/jobs/:id` | tts:read | Trạng thái, ngày tạo/cập nhật, failedReason và kết quả an toàn |
| GET `/tts/jobs/:id/audio` | tts:read | WAV; hỗ trợ Range, chỉ khi COMPLETED và thuộc tài khoản |

JSON thành công: `{success: true, data: ...}`. JSON lỗi: `{success: false, error: {code, message?}}`.
Tác vụ mới trả HTTP 202. Gửi lại cùng Idempotency-Key, cùng giọng và cùng văn bản trả HTTP 200 với tác vụ cũ, không giữ Credit lần nữa. Khóa thuộc tài khoản, không thuộc từng token.
Theo dõi tác vụ mỗi 3–5 giây, tăng thời gian chờ khi HTTP 429. Dừng khi COMPLETED, FAILED hoặc CANCELLED.
Kết quả chứa đường dẫn audio được bảo vệ; tải bằng Bearer token, không nhúng trực tiếp vào audio HTML công khai.

```sh
API_BASE=https://YOUR_API_HOST/api/developer/v1
# TOKEN do người dùng tạo trong Cài đặt, VOICE_ID lấy từ GET /voices.
curl "$API_BASE/voices?page=1" -H "Authorization: Bearer $TOKEN"
curl -X POST "$API_BASE/tts/jobs" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-123-narration-1" \
  -d '{"text":"Xin chào!","voiceId":"VOICE_ID"}'
curl "$API_BASE/tts/jobs/JOB_ID" -H "Authorization: Bearer $TOKEN"
curl "$API_BASE/tts/jobs/JOB_ID/audio" -H "Authorization: Bearer $TOKEN" -o speech.wav
```

## Credit, quyền gói và giới hạn

Dùng cùng dịch vụ TTS, Worker, ví Credit và kiểm tra giọng của Workspace. Cấu hình gói lấy từ database, không có gói Developer hoặc cổng thu tiền riêng. Tác vụ lưu snapshot quyền và đơn giá khi tạo; Worker tiếp tục dùng snapshot đó. Token không vượt quyền tài khoản.
Credit tạm giữ khi nhận tác vụ, chốt khi thành công, giải phóng khi thất bại. Đơn giá lấy từ GET `/limits` và làm tròn theo nhóm tối đa 100 ký tự.
Giới hạn API requests/minute lấy từ gói và chia sẻ giữa mọi token của cùng tài khoản. Header `X-RateLimit-Limit`, `X-RateLimit-Remaining` và `Retry-After` khi vượt giới hạn. Kiểm tra quota/thời lượng/concurrency hiện có vẫn áp dụng lúc tạo và thực thi TTS.

| HTTP | Mã lỗi điển hình | Xử lý |
| --- | --- | --- |
| 400 | INVALID_INPUT | Kiểm tra dữ liệu yêu cầu |
| 401 | API_TOKEN_INVALID | Kiểm tra token, hạn dùng, trạng thái thu hồi |
| 403 | API_SCOPE_REQUIRED, PLAN_FEATURE_DISABLED, TTS_TEXT_LIMIT_EXCEEDED, PLAN_LIMIT_EXCEEDED | Kiểm tra quyền token và gói |
| 402 | INSUFFICIENT_CREDIT | Kiểm tra Credit khả dụng |
| 404 | NOT_FOUND | Tác vụ không tồn tại hoặc thuộc tài khoản khác |
| 409 | AUDIO_NOT_READY, IDEMPOTENCY_CONFLICT | Chờ tác vụ hoàn tất hoặc kiểm tra dữ liệu của khóa đã dùng |
| 429 | API_RATE_LIMIT_EXCEEDED | Chờ Retry-After |
| 503 | API_UNAVAILABLE, TTS_NOT_CONFIGURED | Thử lại sau, kiểm tra vận hành |

## Vận hành và kiểm thử

Không cần thêm secret chung cho API Developer vào `.env`. Token phát hành theo tài khoản. Cần database MongoDB có transaction và TTS/Cloudinary đang cấu hình như Workspace hiện tại. Deploy API qua HTTPS. Trả JSON lỗi khi reverse proxy từ chối yêu cầu, không ghi Authorization vào access log.
Kiểm thử: build backend rồi chạy `node --test tests/developer-api.test.cjs` tại `apps/backend-api`; test dùng database tạm và thông tin provider giả trong tiến trình test, không gửi yêu cầu tổng hợp thật.
