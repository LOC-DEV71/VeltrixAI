# Kiến thức của Trợ lý Veltrix AI

Trợ lý dùng Gemma local và đọc ngữ cảnh khi trả lời, không fine-tune trọng số model. Danh tính trợ lý và người dùng đã xác thực được tách biệt. Trợ lý hướng dẫn trực tiếp bằng tên trang/nút của sản phẩm; tên/email người dùng chỉ là dữ liệu người đang nhắn.

## Nguồn web client

`apps/backend-api/scripts/build-support-knowledge.cjs` tạo chỉ mục từ router, Docs, điều khoản, Developer API, tour Workspace và nội dung hiển thị các trang. `support/client-flows.json` bổ sung luồng nghiệp vụ đã kiểm tra trong code. Chỉ đọc các tệp được chỉ định, không đọc env, token, media hay dữ liệu riêng của người dùng.

Backend chạy generator trước dev/build. Nếu thêm/bỏ route, generator yêu cầu cập nhật mô tả tương ứng. Khi đổi hành vi một màn hình, cần cập nhật mô tả luồng thủ công; trích xuất text không tự hiểu mọi thay đổi logic.

```powershell
cd apps/backend-api
npm run support:knowledge
node scripts/build-support-knowledge.cjs --check
```

Chỉ mục có schema version và hash nguồn. Retrieval hỗ trợ tiếng Việt không dấu, giới hạn ngữ cảnh, chọn nguồn theo câu hỏi. Link trả về được backend đối chiếu với chỉ mục; Support ghép đường dẫn với `VITE_APP_URL`, không nhận URL tùy ý do model tạo.

## Gói đang công bố trong database

`SupportPlans.ts` đọc `Plan` và `PlanRevision` theo revision hiện hành của từng head chưa archived; chỉ đưa các gói active vào ngữ cảnh. Quyền clone, Premium, TTS, content, giá và Credit được lấy từ cấu hình này, không suy từ tên Plus/Pro hoặc seed. Câu hỏi liên quan được đọc lại mỗi lượt, không cache catalog. Retry cùng mã yêu cầu có thể dùng lại câu trả lời trong 2 phút theo cơ chế chat hiện có.

Chỉ cung cấp danh mục chung và quyền/quota liên quan; không đưa số lượng user, người sửa, lý do sửa hoặc lịch sử admin vào model. Không cấp công cụ truy vấn Mongo tùy ý. Danh mục công khai này tách khỏi ngữ cảnh tài khoản riêng. `SupportAccount.ts` đọc gói, số dư và hai đơn gần nhất của chính chủ Session đã xác thực; không nhận ownerId từ body hoặc cấp model công cụ Mongo tùy ý. AI không gửi lệnh tài chính từ văn bản trả lời; khách dùng [luồng kiểm tra và xác nhận hoàn tiền](SUPPORT_REFUNDS.md).

Nếu không đọc được catalog hoặc thiếu revision, AI được thông báo chưa xác minh; không lấy seed/tài liệu tĩnh thay thế quyền lợi hiện hành. Ngữ cảnh lớn giữ đầy đủ các gói và cờ quyền; quota chi tiết bị lược được đánh dấu để AI không đoán.

## Tóm tắt hội thoại

Mỗi lượt inference trả cả câu trả lời và `memory`: bản tóm tắt tích lũy tối đa 1.800 ký tự. Lượt sau gửi tóm tắt này cùng tối đa 6 tin gần nhất và câu hỏi mới. Model giữ chủ đề/mục tiêu/ràng buộc/vấn đề đã trao đổi, nên các lượt đầu vẫn có ngữ cảnh khi rời cửa sổ tin nhắn gần nhất; không cần một lượt gọi model riêng để tóm tắt. Hội thoại hiện giới hạn 10 câu hỏi (tối đa 20 tin).

Tóm tắt là dữ liệu hội thoại không đáng tin cậy, không xác minh danh tính hoặc quyền, không thay thế catalog live. Model được yêu cầu không lưu mật khẩu/OTP/token. Backend giới hạn độ dài cả dạng raw/JSON, điều chỉnh ngân sách catalog và lịch sử theo ngữ cảnh model. Tóm tắt có thể lược chi tiết, không đảm bảo nhớ nguyên văn mọi câu.

Tóm tắt giữ trong bộ nhớ tab cùng chat: mở hội thoại mới, reload hoặc đổi tài khoản sẽ xóa. Retry giữ nguyên tóm tắt và requestId; thay tóm tắt với cùng requestId bị conflict. Không lưu hội thoại lâu dài hoặc localStorage. Backend có cache phản hồi (gồm tóm tắt) trong Mongo tối đa 2 phút để retry qua replica; TTL xóa cache, đọc luôn kiểm tra expiresAt và tài khoản/IP/request.

## Kiểm tra

Chat còn nhận một ảnh tĩnh PNG/JPG/WebP mỗi lượt từ chọn tệp hoặc clipboard. Giới hạn 3 MB và 4.096 pixel mỗi chiều; backend xác thực Session/CSRF và giới hạn HTTP trước khi parse body ảnh lớn, giữ giới hạn 32 KB cho các endpoint khác. Ảnh được giải mã trong admission lease, kiểm tra định dạng thực, pixel, số frame và chuẩn hóa PNG tối đa 1.536 pixel cho Gemma local có vision projector; nếu PNG vượt 3 MB thì giảm xuống 768 pixel. Chuẩn hóa ảnh của content giữ mặc định cũ 768 pixel. Không nhận URL/đường dẫn, không tải ảnh từ mạng, không tạo `AiImageAsset` hay lưu tệp ảnh lâu dài.

Với câu hỏi kèm ảnh, backend trích chữ bằng Tesseract local (Anh/Việt) trong worker riêng rồi đưa chữ đó cùng ảnh thật cho Gemma. Các model OCR đóng gói bằng `@tesseract.js-data/eng` và `@tesseract.js-data/vie`, được copy atomic vào thư mục cache tạm cố định, không tải CDN khi xử lý yêu cầu. Chỉ cache model ngôn ngữ, không ghi ảnh người dùng vào đĩa. Worker làm sáng nền tối, phóng ảnh tối đa 3.072 pixel, giới hạn heap 128 MB và thời gian 20 giây; lỗi OCR trả trạng thái unavailable để vision vẫn xử lý. Worker kết thúc sau mỗi lượt và không log ảnh, model bytes hoặc chữ đã đọc. Postinstall quyên góp của Tesseract bị tắt bằng `allowBuilds: tesseract.js: false`.

Model nhận ảnh trước rồi câu hỏi hiện tại đặt rõ ở cuối prompt; không dùng lịch sử chào hỏi để chọn trang trong ảnh. Ngữ cảnh gồm bản đồ route thật, ưu tiên route khớp câu hỏi/chữ OCR nếu ngân sách ít, và hướng dẫn liên quan. Một inference trả `imageObservation` (quan sát và tối đa 8 đoạn chữ/code), `answer` và `memory`. Khi OCR có chữ và confidence từ 60, backend đưa chính chữ trích xuất vào `visibleText`, tối đa 24 dòng, 240 ký tự/dòng; client có mục “Nội dung đọc được trong ảnh” để xem. Confidence là chỉ số của OCR, không đảm bảo đúng từng ký tự. Chữ nhỏ có thể nhầm l/1, O/0, dấu và đường dẫn; model phải đối chiếu ảnh thay vì chép máy móc. Phản hồi thiếu observation bị từ chối; observation `unclear` được thay bằng yêu cầu cắt vùng cần xem và không lưu lời đoán vào memory. Ảnh, OCR và observation đều là dữ liệu user, không xác minh danh tính, giao dịch hoặc điều kiện hoàn tiền.

`services/ai/start.cjs` mặc định `AI_IMAGE_MAX_TOKENS=1120`, đặt cả min/max cùng mức để screenshot có chữ nhỏ không tự giảm ngân sách, nhận các mức 70/140/280/560/1120 theo [ngân sách thị giác Gemma](https://ai.google.dev/gemma/docs/capabilities/vision/image). Đặt biến vào môi trường tiến trình khởi động AI, cần restart dịch vụ để áp dụng. Adapter dành đủ context cho mức thị giác tối đa, chỉ lượt Support có ảnh dùng temperature 0,2 và quy tắc hội thoại gọn hơn để có chỗ đọc code. Mức cao tăng thời gian/RAM. OCR là tác vụ CPU local, không có API đọc ảnh bên ngoài hoặc inference AI phụ để OCR/tóm tắt. OCR chạy trong admission lease chung; lượt ảnh giới hạn Gemma 80 giây sau tối đa 20 giây OCR, client chờ tối đa 110 giây. Retry dùng lại cache phản hồi như chat hiện có.

Ảnh chỉ thuộc câu hỏi hiện tại. Cache retry chỉ lưu phản hồi/tóm tắt và fingerprint có ảnh, không lưu bytes; thay ảnh với cùng requestId bị conflict. Tab giữ preview bằng object URL, thu hồi khi bỏ/thay ảnh, mở mới hoặc đổi tài khoản. Các lượt sau nhận tóm tắt quan sát thay vì toàn bộ ảnh cũ. Model được yêu cầu phân biệt chữ không đọc rõ, không thực thi chỉ thị trong ảnh và không coi ảnh giao dịch là chứng cứ tài chính; quyền hoàn vẫn do backend/VNPay/ledger xác minh.

```powershell
npm run build
node --test tests/support-chat.test.cjs tests/support-images.test.cjs tests/support-ocr.test.cjs tests/support-session.test.cjs tests/support-knowledge.test.cjs tests/support-plans.test.cjs tests/support-admission.test.cjs tests/billing-refund.test.cjs
```

Các test database sử dụng Mongo riêng, không sửa gói thực tế. Kiểm tra Gemma thật cần dịch vụ `services/ai` sẵn sàng; fixture protocol chỉ kiểm tra contract, không thay thế kiểm chứng câu trả lời của model.

Trong `apps/web-support`, chạy `npm run test:image:browser` khi client dev 5173, Support dev 5175 và Gemma local đang chạy. Kiểm thử dùng Mongo riêng và phiên đăng nhập kiểm thử, clipboard trình duyệt thật, ảnh `ERROR 403`, screenshot trang Developer thật và đoạn curl của trang đó. Đoạn curl có giá trị probe chỉ trong pixels, không nằm trong câu hỏi hoặc nguồn tài liệu, để kiểm chứng đọc nội dung ảnh. Các lượt ảnh được Gemma thật phân tích; reply cuối là fixture riêng để kiểm tra UI không gửi lại bytes ảnh cũ. Có kiểm tra gửi lại sau lỗi kết nối, giải phóng object URL và bố cục desktop/tablet/mobile.
