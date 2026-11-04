# Kế hoạch: Pipeline tự động từ một câu nói đến YouTube

Trạng thái: **kế hoạch, chưa code**. Phụ thuộc vào [Spike render video](../packages/video-renderer/) (chưa tạo) và các quyết định ở mục 9.

## 1. Mục tiêu

Người dùng nhập một câu chủ đề, ví dụ "Điều gì sẽ xảy ra nếu Trái Đất ngừng quay?". Hệ thống tự:

1. Gemma sinh kịch bản và chia cảnh.
2. Sinh TTS cho từng cảnh.
3. Lấy ảnh/footage minh họa cho từng cảnh.
4. Render video bằng Remotion.
5. Upload lên YouTube, nếu dự án bật tùy chọn.

Mỗi dự án có checkbox **"Tự động đăng YouTube"**. Khi tắt, video dừng ở bước render và người dùng tự tải về.

## 2. Phạm vi

**Trong phạm vi (giai đoạn 1):**
- Một câu chủ đề → video dọc 9:16 (Shorts) hoặc ngang 16:9, độ dài mục tiêu 30–90 giây.
- Chỉ tiếng Việt cho lời đọc. `imageQuery` là tiếng Anh.
- Upload YouTube ở chế độ riêng tư (private) trước. Công khai sau khi kiểm duyệt nội bộ đạt.

**Ngoài phạm vi (giai đoạn 1):**
- Upload nhiều kênh YouTube cho một dự án.
- Lên lịch đăng tự động theo giờ (có thể thêm sau).
- Tự sinh thumbnail bằng AI.
- Tự kiểm duyệt nội dung nhạy cảm bằng AI. Chỉ có bộ lọc đơn giản và duyệt thủ công.

## 3. Luồng tổng thể

```
Câu chủ đề
  │
  ▼
[1] AI_CONTENT (Gemma)      → kịch bản + prompt, đã có sẵn
  │
  ▼
[2] AI_SPLIT (Gemma)        → cảnh + highlightWord + imageQuery (tiếng Anh)
  │
  ▼
[3] TTS per scene           → audio WAV/MP3 mỗi cảnh, đo duration thật
  │
  ▼
[4] MEDIA per scene         → Pexels (ảnh/clip) theo imageQuery, có cache, có fallback
  │
  ▼
[5] RENDER (Remotion)       → mp4 cuối, đưa lên storage
  │
  ▼
[6] PUBLISH YOUTUBE         → chỉ chạy khi project.publish.youtube.enabled = true
  │
  ▼
Thông báo + lưu link video/trạng thái
```

Mỗi bước là một job BullMQ riêng, có trạng thái, retry có giới hạn, và kết thúc bằng `COMPLETED` hoặc `FAILED` có mã lỗi an toàn. Không có bước nào tự chạy tiếp khi bước trước `FAILED`.

## 4. Thay đổi dữ liệu

### 4.1 Project (`apps/backend-api/src/models/Project.ts`)
Thêm:
```
autoPipeline: {
  enabled: boolean            // bật pipeline tự động từ chủ đề
  aspectRatio: '9:16' | '16:9'
  targetSeconds: number       // trong giới hạn gói
  youtube: {
    enabled: boolean          // checkbox "Tự động đăng YouTube"
    connectionId: ObjectId    // trỏ tới kết nối OAuth của user
    privacy: 'private' | 'unlisted' | 'public'   // mặc định private
    category: string
    madeForKids: false        // cố định false, không cho chọn
    containsSyntheticMedia: true  // cố định true, xem mục 7
  }
}
```
Mặc định: `youtube.enabled = false`, `privacy = 'private'`.

### 4.2 Kết nối YouTube (model mới `YouTubeConnection`)
- `userId`, `channelId`, `channelTitle`
- `refreshTokenEncrypted` (mã hóa, không bao giờ trả về API hoặc log)
- `scopes`, `status` (ACTIVE / REVOKED / NEEDS_REAUTH), `connectedAt`

### 4.3 Job
Thêm loại mới vào enum `Job.type`: `AUTO_PIPELINE` (điều phối) và `YOUTUBE_PUBLISH`. Các bước 2–5 dùng `AI_SPLIT`, `TTS`, `RENDER_VIDEO` (mới), `MEDIA_FETCH` (mới).

### 4.4 Video
Model mới `Video`: `projectId`, `contentId`, `status`, `storageUrl`, `durationSeconds`, `youtubeVideoId`, `youtubeStatus`, `errorCode`. Tách khỏi `Content` để một kịch bản có thể render nhiều lần.

## 5. Thay đổi backend

| Thành phần | Việc cần làm |
|---|---|
| `ContentGeneration.ts` | Đã có sinh kịch bản. Thêm đầu ra `imageQuery` và `highlightWord` vào schema và validate. |
| `EntitlementService.ts` | Thêm kiểm tra quota cho `RENDER_VIDEO` và `YOUTUBE_PUBLISH`. Pro không có quota tháng (theo thay đổi trước), chỉ bị chặn khi hết credit. |
| `CreditService` / `BillingService` | Thêm `contentCost` cho render và phí publish (nếu có). Hoàn credit khi bước render lỗi do hệ thống. |
| Services mới | `VideoRenderService` (gọi Remotion), `MediaFetchService` (Pexels + cache), `YouTubePublishService` (OAuth + resumable upload), `AutoPipelineOrchestrator` (điều phối các bước) |
| Routes/controllers mới | `POST /api/projects/:id/auto-pipeline` (nhận câu chủ đề), `GET /api/videos/:id`, `POST /api/youtube/connect/start`, `GET /api/youtube/callback`, `DELETE /api/youtube/connection` |
| Admin | Thêm `youtube.publish` vào quyền admin. Thêm trang theo dõi job render/publish và nút thử lại. |

## 6. Thay đổi frontend

- **Trang dự án (web-client):** checkbox "Tự động đăng YouTube", dropdown quyền riêng tư (mặc định private), nút kết nối YouTube nếu chưa có kết nối. Khi bật, hiển thị cảnh báo về quota và nội dung AI.
- **Ô nhập chủ đề:** một ô, một nút "Tạo video". Hiển thị tiến trình theo từng bước.
- **Trang video:** trạng thái từng bước, link video, link YouTube, nút thử lại từ bước lỗi.
- **Admin:** theo dõi job, lọc theo `errorCode`, nút thử lại.

## 7. Ràng buộc từ YouTube và Google (cần xác minh trước khi code)

Các điểm dưới đây dựa trên hiểu biết chung, cần đọc tài liệu chính thức hiện hành trước khi triển khai:

1. **OAuth scope:** `youtube.upload` và `youtube` để đọc tên kênh. Người dùng phải tự đồng ý trên màn hình của Google.
2. **Dự án chưa được Google xác minh:** video có thể chỉ được đăng ở chế độ riêng tư, và có giới hạn số lượt upload. Cần nộp xác minh/audit trước khi mở công khai.
3. **Quota API:** mỗi lần upload tốn nhiều đơn vị quota. Hạn mức mặc định có thể chỉ đủ vài lần upload mỗi ngày cho cả hệ thống. Cần tính toán và có hàng đợi chờ khi hết quota.
4. **Khai báo nội dung AI:** YouTube yêu cầu khai báo khi nội dung là tổng hợp (synthetic). Hệ thống phải tự gắn cờ này, không cho người dùng tắt.
5. **Chính sách nội dung lặp lại / hàng loạt:** tự động hóa 100% có thể bị coi là nội dung lặp lại hoặc spam nếu các video giống nhau. Cần đa dạng hóa template, hình ảnh và giọng đọc, và giữ bước duyệt thủ công tùy chọn.
6. **Bản quyền:** Pexels có điều khoản sử dụng riêng, cần ghi nguồn khi cần. Lời đọc TTS và nội dung Gemma phải tránh sao chép nguyên văn từ nguồn có bản quyền.
7. **Made for kids:** luôn đặt `false`. Nếu nội dung hướng trẻ em, cần xử lý riêng.

## 8. Rủi ro và cách giảm

| Rủi ro | Giảm thiểu |
|---|---|
| "100% tự động" không đạt được: Gemma, Pexels, TTS hoặc YouTube có thể lỗi | Retry có giới hạn, phân loại lỗi tạm thời và vĩnh viễn, cho phép thử lại từ bước lỗi, không tự chạy bước sau khi lỗi. Thông báo rõ khi cần người dùng can thiệp. |
| Gemma 4B cho nội dung kém | Validate schema, kiểm tra độ dài, số cảnh, `imageQuery` có tiếng Anh. Có chế độ duyệt kịch bản trước khi render (tùy chọn). |
| Render chậm, tranh tài nguyên với Gemma | Worker render riêng, chạy tuần tự trên máy có GPU/CPU đủ mạnh. Đo thời gian ở pha spike. |
| Lộ refresh token YouTube | Mã hóa at-rest, không trả về client, không log. Quyền thu hồi tại trang tài khoản. |
| Credit bị trừ nhưng video lỗi | Hoàn credit cho lỗi hệ thống (đã có cơ chế cho Gemma). Ghi sổ theo từng bước. |
| Đăng lặp lại làm kênh bị phạt | Mặc định private, giới hạn số video đăng mỗi ngày mỗi kênh, đa dạng template. |

## 9. Quyết định cần chốt trước khi code

1. **Remotion có được dùng thương mại không?** (xem giấy phép trong spike)
2. **Ai là người đăng?** Mỗi user kết nối kênh của chính họ (đề xuất) hay hệ thống có một kênh chung?
3. **Chế độ mặc định:** private hay public? Đề xuất: private cho đến khi xác minh xong.
4. **Có bước duyệt kịch bản thủ công không?** Đề xuất: có, tùy chọn trong dự án, mặc định bật cho gói Free/Plus và tắt cho Pro.
5. **Giới hạn video đăng mỗi ngày:** đề xuất mặc định 3 video/ngày mỗi kênh.

## 10. Các pha triển khai

| Pha | Nội dung | Tiêu chí hoàn thành |
|---|---|---|
| 0 | Spike Remotion (đang chờ) | Render được 1 cảnh có chữ + ảnh + audio, đo thời gian |
| 1 | Pipeline 1–5 không upload: chủ đề → mp4 lưu storage | 10 chủ đề thử, mỗi chủ đề ra mp4 đạt yêu cầu, lỗi có mã rõ |
| 2 | Kết nối YouTube OAuth + upload private | Upload được video private trên kênh test, refresh token hoạt động |
| 3 | Checkbox dự án, điều phối tự động, trang theo dõi | Bật checkbox → video tự lên YouTube private, lỗi có thể thử lại |
| 4 | Xác minh Google, quota, giới hạn ngày, nội dung AI | Có kế hoạch xác minh, đo quota, bật công khai có kiểm soát |

## 11. Form cấu hình và hiển thị tiến trình

Phần này bổ sung cho mục 6. Áp dụng cho trang "Viết content" (`apps/web-client/src/pages/ContentEditorPage.tsx`).

### 11.1 Ngôn ngữ

**Đối tượng:** nền tảng dành cho creator Việt Nam. Toàn bộ nội dung, lời đọc, giao diện và gợi ý là **tiếng Việt (`vi-VN`)**. Không có kế hoạch hỗ trợ ngôn ngữ khác trong phạm vi này.

**Hiện trạng:** dropdown "Ngôn ngữ" trên form là thừa, vì gói chỉ có `vi-VN` và TTS (VieNeu) chỉ hỗ trợ tiếng Việt. Người dùng không cần chọn.

**Việc cần làm:**
- Ẩn dropdown "Ngôn ngữ" trên form và cố định `vi-VN` ở frontend và backend.
- Giữ `content.languages = ['vi-VN']` trong cấu hình gói để backend vẫn validate đúng.
- Prompt Gemma và các bước kiểm tra đầu ra (mục 5) luôn yêu cầu tiếng Việt có dấu, chuẩn NFC.
- Lọc giọng đọc theo `vi-VN`.

**Không làm** (bỏ khỏi roadmap): pha 1d hỗ trợ ngôn ngữ khác.

### 11.2 Gemma gợi ý ý tưởng

**Mục tiêu:** từ một câu chủ đề thô hoặc ô trống, Gemma gợi ý chủ đề, đối tượng, tone, thời lượng và số cảnh, điền sẵn vào form. Người dùng vẫn sửa được.

**Việc cần làm:**
- Endpoint `POST /api/contents/suggest` (hoặc theo project). Chạy như job `AI_ANALYSIS` (đã có trong enum `Job.type`), trả về JSON:
  `{ suggestions: [{ topic, audience, tone, durationSeconds, sceneCount, reason }] }`
- Validate đầu ra theo schema; tone và thời lượng phải thuộc danh sách hợp lệ của gói.
- Giới hạn tần suất (rate limit) và số lần gợi ý mỗi ngày để tránh lạm dụng.
- Trên UI: nút "Gợi ý ý tưởng" mở danh sách 3 gợi ý, bấm để áp vào form.
- Phí: **chưa chốt** (xem mục 12). Nếu trừ credit, hiển thị phí trên nút như nút "Viết nội dung bằng AI".

### 11.3 Hiển thị tiến trình cho người dùng

**Hiện trạng:** `waitForContentJob` đã polling `/jobs/:id`, nhưng `Job` không có trường tiến trình. Người dùng chỉ thấy trạng thái "đang tải".

**Việc cần làm:**
- Thêm vào model `Job`: `progress: { stage: string, step: number, totalSteps: number, message: string, updatedAt: Date }`. Chỉ lưu mã bước và thông điệp an toàn, không lưu prompt, nội dung thô hay đường dẫn provider.
- Worker cập nhật `progress` tại mỗi bước. Với pipeline tự động (mục 3), các bước là: viết kịch bản → chia cảnh → TTS → lấy ảnh → render → đăng YouTube.
- Với job `AI_CONTENT` hiện tại, chỉ có bước chung vì kịch bản được sinh trong một lần gọi Gemma. Muốn tách nhỏ hơn cần đổi cách gọi.
- Frontend: thanh bước (stepper) với trạng thái đã xong, đang chạy, lỗi. Bước đang chạy hiển thị `message` và thời gian đã chạy. Giữ nguyên polling hiện có.
- Khi lỗi, hiển thị bước nào lỗi và nút "Thử lại từ bước này" (áp dụng từ pha 1 trở đi).
- Tiến trình hiển thị cho cả người dùng và admin, nhưng admin thấy thêm `errorCode`.

**Đề xuất:** 4–5 bước lớn, không hiển thị chi tiết từng cảnh ở pha đầu.

### 11.4 Lỗi giao diện cần kiểm tra

Dòng "AI Pro ? v5" trong ảnh chụp không có trong mã nguồn `apps/web-client/src`. Cần kiểm tra bản build hoặc deployment đang chạy trước khi sửa.

## 12. Quyết định bổ sung và việc tiếp theo

Thêm vào mục 9:

6. **Ngôn ngữ:** đã chốt: chỉ `vi-VN`, dành cho creator Việt Nam (xem 11.1).
7. **Gợi ý ý tưởng:** miễn phí, hay trừ credit? (Đề xuất: miễn phí có giới hạn số lần mỗi ngày.)
8. **Tiến trình:** 4–5 bước lớn? (Đề xuất: có.)

**Pha bổ sung** (chèn vào mục 10, sau pha 1):

| Pha | Nội dung | Tiêu chí hoàn thành |
|---|---|---|
| 1b | Trường `progress` trên Job, stepper trên UI, hiển thị bước lỗi | Người dùng thấy được bước đang chạy và bước lỗi |
| 1c | Endpoint gợi ý ý tưởng, nút trên form | Gợi ý điền được vào form, schema và giới hạn hoạt động |
| 1d | Ẩn dropdown ngôn ngữ, cố định `vi-VN` ở frontend và backend | Form không còn dropdown ngôn ngữ, request luôn gửi `vi-VN` |

**Việc tiếp theo:** trả lời mục 9 (câu 7–8), hoàn thành pha 0 (spike Remotion), rồi bắt đầu pha 1 và 1b. Tạo nhánh `feature/auto-video-pipeline` khi bắt đầu code.

## 13. Trạng thái triển khai (03/11/2026)

| Pha | Trạng thái | Ghi chú |
|---|---|---|
| 0 | Xong | `packages/video-renderer` (Remotion 4.0.540), render qua manifest, đã kiểm tra frame bằng mắt |
| 1b | Xong | `Job.progress`, `JobProgress.ts`, stepper `JobProgressSteps` trên trang viết content |
| 1c | Xong | `POST /api/contents/suggest`, miễn phí, giới hạn `IDEA_SUGGESTIONS_DAILY_LIMIT`/ngày, lượt lỗi được hoàn |
| 1d | Xong | Ẩn dropdown ngôn ngữ, request luôn gửi `vi-VN` |
| 1 | Xong | Job `VIDEO_RENDER`: Gemma chọn từ nổi bật + từ khóa ảnh (fallback từ `imagePrompt`), Pexels (fallback nền gradient), phụ đề chia đoạn, Remotion, lưu mp4 |
| 1e | Xong | Chuẩn [VIDEO_STYLE.md](VIDEO_STYLE.md): storyboard 9 kiểu cảnh (zod + retry + sửa lỗi), căn thời gian từng từ, caption 2-4 từ, chuyển cảnh, SFX, nhạc nền ducking, -14 LUFS, nền Pexels video → ảnh → gradient có cache. Chi tiết: [packages/video-renderer/README.md](../packages/video-renderer/README.md) |
| 2 | Xong (chưa thử với Google thật) | OAuth + PKCE, refresh token mã hóa AES-256-GCM, upload resumable, tự khai báo `containsSyntheticMedia` |
| 3 | Xong | Trang `/auto-video`: một câu → kịch bản → giọng đọc → video → (tùy chọn) YouTube; checkbox "Tự động đăng YouTube" cho từng lần tạo |
| 4 | Chưa | Xác minh ứng dụng với Google, đo quota thật, bật công khai có kiểm soát |

**Khác với kế hoạch ban đầu:**
- Checkbox YouTube nằm ở mỗi lần tạo video tự động (mỗi lần tạo một dự án mới), không phải một cài đặt lưu trên `Project`.
- Không có model `YouTubeConnection.connectionId` trên dự án; mỗi người dùng có một kênh.
- Video lưu trên đĩa (`VIDEO_STORAGE_DIR`), chưa đưa lên Cloudinary.
- Orchestrator gọi lại đúng các controller/service hiện có (tạo dự án, content, TTS, video) nên credit, quota và quyền giống hệt luồng thủ công.

### Chạy local

```bash
# API (đã có ticker cho video tự động)
pnpm --filter @creatorai/backend-api build && pnpm --filter @creatorai/backend-api start
# Worker TTS (đã có)
pnpm --filter @creatorai/backend-api worker:tts
# Worker video: dựng video + đăng YouTube, mỗi lần một job
pnpm --filter @creatorai/backend-api worker:video
```

Biến môi trường mới: xem phần "Video tự động" và "Đăng YouTube" cuối `apps/backend-api/.env.example`.

### Test

`pnpm --filter @creatorai/backend-api test:video` chạy: tiến trình job, gợi ý ý tưởng, phụ đề, lập kế hoạch ảnh, pipeline video (gồm một lần render Remotion thật), YouTube (Google được giả lập), và orchestrator (AI/TTS được giả lập).

### Chưa kiểm chứng

- Chạy với Gemma, TTS VieNeu, Pexels và YouTube thật: chưa chạy trong lần triển khai này.
- Font: phụ đề dùng `Be Vietnam Pro` nếu máy render có cài, nếu không thì `Noto Sans`/Arial. Trên server Linux cần cài font hỗ trợ tiếng Việt.
- Hiệu năng: 2 cảnh 1080×1920 dựng khoảng 13–19 giây trên máy dev; video 60–90 giây sẽ lâu hơn nhiều.
