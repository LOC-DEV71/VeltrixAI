# Quản lý giọng hệ thống

Tại Admin → Thư viện giọng (`/voices`):

- **Tạo giọng hệ thống**: nhập tên, ngôn ngữ, giới tính, tags, ảnh đại diện,
  vị trí, gói sử dụng, trạng thái công bố, giọng mặc định, nội dung preview và lý do.
  Tải mẫu WAV và xác nhận quyền nhân bản/cung cấp giọng cho người dùng hệ thống.
- **Quản lý → Audio mẫu cho client**: nhập lời đọc và lý do, rồi tạo audio mẫu.
  Mẫu cũ giữ nguyên đến khi Worker công bố mẫu mới thành công.
- **Sắp xếp giọng**: kéo thả hoặc dùng nút lên/xuống; nhập lý do và lưu.
  `position` được lưu trong database; client nhận danh sách theo thứ tự này.

Giới hạn audio tham chiếu của engine VieNeu đang ghim: WAV 3–8 giây, PCM16,
1–2 kênh, 16–48 kHz, tối đa 4 MB. Admin UI chuẩn hóa WAV như flow clone client;
backend và TTS service kiểm tra lại. Ngôn ngữ đang hỗ trợ: `vi-VN`.
Preview tối đa 1.000 ký tự. Đây là giới hạn công cụ provisioning, không phải
giới hạn gói người dùng. Quyền sử dụng giọng theo từng gói vẫn được kiểm tra
ở API và Worker tạo TTS cho user.

## API

Tất cả route yêu cầu phiên admin và `voices.read`; mutation thêm `voices.revoke`
(OWNER có toàn quyền) và CSRF. Không chấp nhận cookie user thay cho admin.

| Method | Endpoint | Mục đích |
| --- | --- | --- |
| GET | `/api/admin/voices/capabilities` | Giới hạn mẫu và ngôn ngữ |
| POST | `/api/admin/voices` | Xếp hàng tạo giọng hệ thống từ mẫu |
| POST | `/api/admin/voices/:id/preview` | Xếp hàng tạo/thay preview |
| GET | `/api/admin/voices/jobs/:id` | Trạng thái provisioning an toàn |
| GET | `/api/admin/voices/:id/details` | Thông tin hiển thị của giọng |
| GET/POST | `/api/admin/voices/order` | Xem/lưu thứ tự toàn bộ giọng hệ thống |

Hai POST tạo giọng/preview bắt buộc header `Idempotency-Key` và lưu job trong
`admin_voice_jobs`. Tạo giọng nhận các trường trên cùng `audioBase64`, `text`,
`reason`, `consent: { hasVoiceRights: true, consentToClone: true,
allowSystemUse: true }`; có thể gửi `avatarUpload: { base64 }`.
Preview nhận `text`, `reason`, `expectedVersion`.
Lưu thứ tự nhận `items: [{ id, version }]` và `reason`. Thiếu giọng hoặc revision
cũ trả `VOICE_VERSION_CONFLICT`, không ghi đè một phần.

Provider/ID nội bộ, embeddings, reference codes, paths và tokens không được
trả cho UI. Không tự bịa preset ID: giọng mới dùng reference codes do engine tạo.
Admin provisioning không trừ credit người dùng và không mở quyền clone của gói Free.

## Worker và lưu trữ

Worker hiện hữu `pnpm --filter backend-api worker:tts` xử lý cả provisioning.
API chỉ lưu mẫu vào spool riêng và xếp hàng, không gọi inference.
Worker kiểm tra lại quyền admin, lease và trạng thái/version giọng trước công bố.
Giọng đang tạo có trạng thái `PENDING`; chỉ xuất hiện cho client khi `ACTIVE`.

Reference và preview upload Cloudinary authenticated dưới
`veltrixai/voice-references/system/...` và `veltrixai/voice-previews/...`.
Ảnh upload dưới `veltrixai/voice-avatars/...`. Reference recording được dọn sau
khi tạo giọng; codes/embedding vẫn lưu riêng trong database để inference.
Preview giữ checksum, thời lượng thực, nội dung và public ID trong database.
Client chỉ dùng API preview có kiểm tra plan; không nhận signed URL/reference.
Cache local có checksum giảm độ trễ; cache thiếu tải lại file bảo vệ từ Cloudinary,
không sinh TTS lại. Thay mẫu sẽ dọn asset preview cũ sau khi công bố thành công.
Cleanup thất bại được lưu và thử lại có giới hạn.

Inference chỉ gọi TTS nội bộ `/enroll` và `/synthesize`; không tải model trong request.
Upload/download Cloudinary cần Internet. Inference dùng bundle model local đã cài.

## Kiểm tra

```powershell
pnpm --filter backend-api build
pnpm --filter web-admin build
node apps/backend-api/dist/scripts/seedVoicePositions.js
node --test apps/backend-api/tests/admin-voice-provisioning.test.cjs
node apps/backend-api/scripts/test-admin-voice-local.cjs
node apps/web-admin/tests/plans-browser-local.cjs
```

Test local dùng audio tổng hợp từ preset đã kiểm thử và tài khoản/voice tạm;
dọn fixtures sau chạy. Proof WAV và báo cáo trong `services/tts/.runtime/`.
