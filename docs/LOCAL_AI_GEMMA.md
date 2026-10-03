# Gemma local cho Veltrix — báo cáo và vận hành

Ngày kiểm tra: 04/10/2026. **Gemma thật đã chạy; API viết content đã bật local. Offline vẫn BLOCKED do phiên PowerShell chưa có quyền Administrator.**

Backend, kiểm soát job/credit và artifact đã triển khai. Lần thử trước Windows Application Control chặn binary chính thức; lần chạy lại thành công, không thay đổi policy bảo mật. API được khởi động với `--local-ai`, dùng Gemma cho các job mới. Không tự chuyển sang Gemini khi local lỗi. `.env` thật và UI được giữ nguyên.

Kiểm thử thật ban đầu trong MongoDB tạm đã PASS: tạo kịch bản tiếng Việt, tạo prompt giữ nguyên lời đọc, chia cảnh giữ nguyên nguồn, ảnh thuộc quyền sở hữu và hoàn credit khi token inference sai. Acceptance này chứng minh pipeline/schema/credit; chưa chứng minh mọi nội dung đều đạt chất lượng biên tập. Thời lượng là mục tiêu biên tập, không phải điều kiện thất bại theo số tiếng: ví dụ 60 giây/tiếng Việt hướng tới khoảng 240 tiếng. Backend không thêm/cắt lời đọc để ép độ dài; tính lại estimatedDuration từ narration và tốc độ tham chiếu, giao diện hiển thị ước tính cạnh mục tiêu của bản đã lưu. JSON, số cảnh, hạn mức ký tự và quota gói vẫn được kiểm tra trước khi publish. Audio thực tế tùy giọng và tốc độ.

Prompt phân biệt topic (chủ đề), audience (người xem), tone (cách diễn đạt), platform (định dạng/nhịp), language, duration, sceneCount=0 và structure=auto; chuẩn hóa văn bản tiếng Việt NFC. `ContentReferences.ts` cung cấp tham chiếu chọn lọc cho chủ đề thang nền văn minh/Kardashev, từ [bài gốc 1964](https://technosearch.seti.org/wp-content/uploads/2018-09/Kardashev_CTA102.pdf). Đây là ngữ cảnh local được biên tập theo nguồn; không tra Internet ở mỗi request và không phải hệ thống kiểm chứng mọi chủ đề.

Chạy lại ca thiết lập như người dùng, dùng Gemma thật và database tạm:

```powershell
node services/ai/acceptance.cjs --settings-repro --generate-only
```

Lệnh này chỉ nghiệm thu generation và hoàn credit khi auth inference sai; không tuyên bố prompt-only/split/vision đã được test trong chính lần chạy này. Kết quả lưu riêng ở `services/ai/.runtime/settings-acceptance.json`.

Ca thử thực tế sau sửa: TikTok, audience “Gen Z, thích hài hước”, tone funny, vi-VN, 60 giây, 0 cảnh/auto, chủ đề “Nền văn minh cấp 7 là gì?” → 5 cảnh, 283 tiếng (ước lượng tham chiếu 70,75 giây), giải thích theo năng lượng/Kardashev và nêu rõ phần mở rộng giả định; không định nghĩa Gen Z thành một cấp nền văn minh. Generation/settle và auth-failure/refund PASS trong database tạm. Lần chạy đầy đủ trước đó bị từ chối ở image-generation do sai độ dài; không gộp lần chạy này thành toàn bộ pipeline vision PASS. Build/typecheck và 99 kiểm thử liên quan đã qua; lint vẫn có các warning trước nhiệm vụ.

Đã sửa hai lỗi được phát hiện khi dùng model thật: JSON schema phải nằm trong `response_format.json_schema.schema` của runtime b11379; tác vụ split cần instruction phân cảnh riêng để không yêu cầu model sáng tác lại lời đọc. Build và 29 kiểm thử adapter/content đã qua sau sửa.

## Audit theo code hiện hành

- Content được điều phối bằng dispatcher Mongo trong `workers/queue.ts`, không phải Redis/BullMQ đang hoạt động như một số tài liệu kiến trúc mô tả. `connection=null`; API lưu job và trả `{success:true,data:{jobId}}`, dispatcher gọi worker sau đó.
- Quota/giá credit lấy từ `PlanService` và `EntitlementService`, có snapshot động theo revision. Credit dùng transaction, reservation, settle/release hiện có; không có đường trừ credit mới.
- Gemini trước đây nằm trực tiếp trong `ContentWorker`; đã tách thành provider chung. Giữ model Gemini cũ để tránh đổi hành vi ngoài phạm vi; bỏ fake API key. Không có fallback local → paid.
- Lời đọc từng cảnh có revision riêng. Worker nay kiểm tra cả content revision, tập scene/revision, quyền sở hữu và trạng thái tài khoản trước khi công bố.
- TTS có runtime và worker riêng, không thay model/artifact/backup của TTS. Tài liệu gói cũ chưa phản ánh đầy đủ VNPay; nhiệm vụ này không sửa thanh toán.
- `AI_ANALYSIS` tồn tại trong enum nhưng chưa có pipeline riêng. Phân tích ảnh ở đây là **nguồn đầu vào cho AI_CONTENT**; quan sát được đưa vào nội dung/visualDescription. Không tuyên bố đã có endpoint phân tích ảnh độc lập.

## Artifact đã tải và xác minh

Nguồn chính thức: [Google model card](https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf), [Gemma core](https://ai.google.dev/gemma/docs/core), [llama.cpp b11379](https://github.com/ggml-org/llama.cpp/releases/tag/b11379), [server API](https://github.com/ggml-org/llama.cpp/blob/b11379/tools/server/README.md), [multimodal](https://github.com/ggml-org/llama.cpp/blob/b11379/docs/multimodal.md).

- Model ID: `google/gemma-4-E4B-it-qat-q4_0-gguf`.
- Revision: `4b4a2c1d584be7264f87aac328a1bc739ce81b6c`.
- GGUF instruction-tuned, QAT Q4_0; license Apache-2.0.
- Runtime Windows x64 CUDA 12.4: llama.cpp `b11379`; không thêm Python cho AI.
- Weights: 5.154.941.280 byte; projector đúng model: 991.552.256 byte. Tổng model + vision: **6.146.493.536 byte**, khoảng 6,15 GB / 5,72 GiB.
- Hai ZIP runtime/CUDA: 655.238.192 byte. Runtime giải nén 1.192.494.877 byte, được ghi checksum từng file trong manifest. Tổng 4 artifact tải chính: 6.801.731.728 byte (chưa tính metadata/license nhỏ).
- Lock nguồn/revision/kích thước/SHA-256: `services/ai/artifacts.lock.json`. Model card và license lưu tại `artifacts/provenance`.
- Weights/runtime/cache/connection chứa token nằm trong thư mục bị gitignore; không đưa chúng vào source control.

Provision là bước duy nhất tải Internet. Start chỉ đọc, xác minh và chạy artifact local; thiếu/hỏng file báo lỗi rõ. Có `--offline`, xóa các biến `LLAMA_ARG_*` kế thừa để tránh override nguồn tải. Cờ offline **chưa phải bằng chứng cô lập mạng**.

## Giới hạn và cấu hình

`AI_PROVIDER=gemini|local` chọn tường minh. Khi local, helper có thể đọc connection riêng; hoặc cấu hình cặp `AI_SERVICE_URL`/`AI_SERVICE_TOKEN` ở môi trường tiến trình. Không gửi token, đường dẫn file hay địa chỉ runtime ra client. Runtime chỉ bind `127.0.0.1:8091`, xác thực Bearer, không public/tunnel cổng này.

Local mặc định context 8.192 token, output tối đa 4.096, một slot inference. Batch 128/ubatch 64; GPU layers auto với margin 768 MiB, KV q8, projector CPU. Các lượt thử text/ảnh chạy thành công trên máy này, GPU dùng khoảng 2,9 GB; chưa ghi nhận số layer GPU chính xác. Có thể giảm `AI_CONTEXT_TOKENS=4096` khi cần; adapter kiểm tra token prompt trước inference.

Giới hạn hạ tầng: input 12.000 ký tự, timeout 180 giây mỗi inference, tối đa 10 job local chờ/đang chạy, một ảnh/request, 3 MiB/ảnh, chiều tối đa 4.096 và tối đa 16.777.216 pixel. Ảnh được decode đầy đủ PNG/JPEG/WebP, từ chối SVG/ảnh động, chuẩn hóa PNG ≤768px. Tối đa 10 asset lưu cho một tài khoản; xóa bằng endpoint khi không còn job sử dụng. Giới hạn này là trần hạ tầng, không thay quota gói hiện có.

Schema cảnh validate phía server, JSON repair hữu hạn. Không tăng output vô hạn để đáp ứng gói dài: content vượt cửa sổ local có thể thất bại an toàn và hoàn reservation; chưa nghiệm thu kịch bản 5–10 phút. Queue được chặn transaction trước hold credit. API vẫn dùng auth/CSRF, quyền sở hữu và plan snapshot; header `Idempotency-Key` tùy chọn chống tạo/hold trùng, dùng lại với body khác trả 409.

## API ảnh và contract

Sau khi tạo content thuộc tài khoản đang đăng nhập:

1. `POST /api/contents/:id/images` với `{ "imageBase64": "<base64 PNG/JPEG/WebP>" }`, auth cookie và CSRF như API hiện có. Trả `201`, `data.id` cùng metadata kích thước/hash; không trả đường dẫn local.
2. `POST /api/contents/:id/generate` giữ body hiện có (topic/platform/audience/tone/durationSeconds...), thêm `imageAssetIds: ["<data.id>"]`. Trả jobId như trước; poll `GET /api/jobs/:id`.
3. `DELETE /api/contents/:id/images/:imageId` để xóa asset thuộc quyền sở hữu khi không bị job sử dụng.

Không nhận URL/file path; worker không tải URL tùy ý. File chỉ được đọc qua ID đã kiểm tra owner/content và checksum. Prompt-only vẫn giữ nguyên lời đọc/audio; chia cảnh giữ nguyên nguồn lời đọc theo contract.

## Lệnh Windows

Chạy từ **thư mục gốc** `C:\DevStack\CreatorAI`, không chạy từ `services`:

```powershell
Set-Location C:\DevStack\CreatorAI
node services/ai/provision.cjs  # explicit download, đã chạy thành công
node services/ai/verify.cjs
node services/ai/start.cjs     # giữ terminal này chạy; hiện đã READY
node services/ai/stop.cjs      # dừng đúng PID đã ghi, sau khi job đã idle
```

Trước đo Gemma trên máy ít RAM, pause đúng TTS tree khi không có job:

```powershell
node services/ai/pause-tts.cjs
```

Để thử model thật sau khi runtime được Windows cho phép:

```powershell
node services/ai/smoke.cjs
node services/ai/smoke.cjs --image "C:\duong-dan\anh-that.png"
node services/ai/acceptance.cjs --image "C:\duong-dan\anh-that.png"
```

`smoke` ghi text thật, cold start, TTFT, tổng thời gian, token/s và peak RAM/VRAM lấy mẫu mỗi 2 giây; số đo lấy mẫu có thể bỏ lỡ đỉnh ngắn. Text/ảnh cần đối chiếu chất lượng bằng người đọc, không coi chỉ HTTP200/nonempty là nghiệm thu ngữ nghĩa. `acceptance` dùng model thật và API/auth/CSRF/worker/credit thật trong database tạm; không dùng tài khoản, ví hay đơn hàng thực. Không đưa ảnh thật vào báo cáo nếu không muốn lưu nội dung trong file local private.

Đổi API sang local khi runtime đã READY; dừng đúng API ghi nhận nếu không có job đang xử lý:

```powershell
node scripts/stop-local-api.cjs
node scripts/start-local-api.cjs --local-ai
```

Nếu stop báo `API_WORK_PENDING`, giữ API chạy và đợi job hoàn tất, không chạy thêm API trên cổng 3001. Helper stop từ chối PID không thuộc supervisor của repo. Không dùng `taskkill /IM node.exe` hoặc kill toàn bộ Python.

Bật lại TTS và API provider ban đầu (không sửa `.env`):

```powershell
node services/ai/stop.cjs
node scripts/start-local-tts.cjs  # terminal riêng, đợi LOCAL_TTS_AND_WORKER_READY
node scripts/stop-local-api.cjs
node scripts/start-local-api.cjs # terminal riêng, dùng AI_PROVIDER trong .env hiện hành
node scripts/check-local-tts.cjs
```

API phải restart sau TTS để lấy connection/token mới. Script không in secret.

## Offline: chưa nghiệm thu

Sau khi không còn job chạy, dùng PowerShell Administrator:

```powershell
.\services\ai\test-offline.ps1 -ImagePath "C:\duong-dan\anh-that.png"
```

Script thêm rule outbound tạm chỉ cho executable runtime, chặn đích ngoài loopback; restart runtime rồi chạy text và một ảnh; finally xóa đúng rule của lần thử. Firewall profiles phải enabled. Bằng chứng chỉ áp dụng cho model process; MongoDB, auth, Cloudinary và phần web có thể vẫn cần Internet. Đã gọi script nhưng dừng ở kiểm tra Administrator, chưa tạo rule hay chạy inference cô lập mạng. Chưa tuyên bố offline PASS.

## Kết quả thực tế

| Hạng mục | Trạng thái | Bằng chứng/giới hạn |
| --- | --- | --- |
| Artifact đầy đủ + SHA-256 + nguồn/license | PASS | provision/verify; gồm projector và CUDA runtime |
| Backend build/typecheck | PASS | TypeScript build và noEmit |
| Regression content/timing/video | PASS | 38 test; không phải chứng minh Gemma |
| Adapter + HTTP/auth/CSRF/jobs/credit | PASS | 12 test, HTTP model fixture và MongoDB tạm; refund, idempotency, ownership, revision, queue cap |
| Plans/projects/admin control | PASS | 55 + 16 + 11 test; test plan mock có key fixture, không gọi paid API |
| TTS/voices/cache/pricing regression | PASS | 42 test; không thay artifact TTS |
| Lint | PASS với warning có sẵn | Không coi warning là proof model |
| Chạy runtime thật | PASS | `--version` build 11379, runtime READY; không đổi Windows policy |
| Text VN / prompt / split trên Gemma thật | PASS pipeline | Đúng schema, prompt giữ lời đọc, split giữ nguồn; thời lượng/chất lượng vẫn cần đối chiếu |
| Vision ảnh thật | PASS pipeline | Avatar Hải Đăng được nhận diện; có ca upload-owned-image → worker → kết quả |
| NVIDIA và số đo inference | PASS số đo, thiếu số layer | Có VRAM sử dụng; chi tiết bên dưới, chưa ghi peak toàn cold load |
| API → worker → model thật → settle/refund | PASS | 5 ca real acceptance trong database tạm; token sai hoàn reservation và giữ content cũ |
| Restart/inference khi chặn outbound | BLOCKED | Script cần PowerShell Administrator; phiên hiện tại không đủ quyền |
| Linux production | CHƯA KIỂM THỬ | lock hiện chỉ Windows x64 CUDA |

Trước provision: RAM tổng 15.927.668 KiB, khả dụng 864.612 KiB (~0,82 GiB); GPU RTX4050 Laptop 6.141 MiB, dùng 0 MiB, driver 581.86; C: trống 153.837.707.264 byte (~143 GiB). TTS Python RSS khoảng 1,27 GB trước pause. Đây là **baseline**, không phải peak khi Gemma chạy.

Lượt text ngắn: cold start 46,47 giây; TTFT 0,77 giây; tổng 3,03 giây; runtime báo 48,94 token/giây; peak VRAM lấy mẫu 2.945 MiB, RSS runtime 3.637,62 MiB. Một ảnh: TTFT 0,98 giây; tổng 3,01 giây; VRAM 2.955 MiB, RSS 3.838,14 MiB. Peak RAM toàn hệ thống khoảng 15.180,52 MiB trong lượt text (gồm các ứng dụng khác). Đây là mẫu ngắn, không phải stress test; lấy mẫu mỗi 2 giây có thể bỏ lỡ đỉnh. Chưa đo peak bộ nhớ của toàn giai đoạn load.

TTS vẫn READY, worker heartbeat mới; API, client/admin, proxy và socket trả 200 sau khi API bật local. Xem `services/ai/acceptance-report.json`.

## Nếu Application Control chặn lại

Thử từ PowerShell ngoài Codex:

```powershell
& "C:\DevStack\CreatorAI\services\ai\artifacts\runtime\llama-server.exe" --version
```

Nếu vẫn có `An Application Control policy has blocked this file`, quản trị máy cần cho phép đúng bộ runtime theo policy hiện tại, đối chiếu lock/manifest. Không tắt bảo vệ toàn hệ thống, không đổi tên DLL để né policy. Sau khi lệnh chạy được, tiếp tục các lệnh nghiệm thu phía trên. Không cần gửi token trong chat.

## File thay đổi

- `services/ai`: lock, provision/verify/start/stop, pause TTS, smoke, real acceptance, test-offline và acceptance-report.
- Backend provider `AiProvider`, admission `AiAdmission`, model/controller/service `AiImage*`, routes content; `ContentController`, `ContentWorker`, `userMessages`, `AdminControl` (health), `AdminInsights` (sửa kiểu lean để build).
- `scripts/start-local-api.cjs` thêm lựa chọn local; `scripts/stop-local-api.cjs` kiểm tra job/PID trước dừng.
- Tests `ai-provider`, `local-ai-jobs`, regression fixtures `content-generation`, `plans`.
- `.env.example`, backend package/lock/workspace build allowlist cho sharp, `.gitignore`, tài liệu này.

Không thay layout, sidebar hay code frontend; không render video hoặc fine-tune.
