# Veltrix Support

Ứng dụng trợ giúp độc lập, giao diện tiếng Việt, mặc định chạy tại **http://localhost:5175**.

```powershell
cd C:\DevStack\CreatorAI\apps\web-support
Copy-Item .env.example .env # Chỉ cần khi chưa có .env
npm ci --include=dev
npm run dev
```

`npm run typecheck` kiểm tra TypeScript; `npm run build` tạo bản production trong `dist`.

- Tìm kiếm nội dung và chủ đề, hỗ trợ từ khóa không dấu, Ctrl/Cmd + K.
- Hướng dẫn có liên kết riêng `?article=free-ip-policy`, mục lục, sao chép link và bài liên quan.
- FAQ đóng/mở, menu mobile, trạng thái không tìm thấy hướng dẫn.
- URL ứng dụng, Developer và kênh hỗ trợ lấy từ env; xem mô tả tiếng Việt trong `.env.example`.
- `VITE_SUPPORT_CONTACT_URL` trống thì không hiển thị nút liên hệ. Chưa có hệ thống ticket hoặc chat với nhân viên.
- Tài liệu, FAQ và tìm kiếm Support mở công khai, kể cả khi backend lỗi. Chỉ chat AI yêu cầu đăng nhập và dùng cùng Session/accessToken/refreshToken HttpOnly với Creator qua backend chung. Không sao chép token vào localStorage hoặc URL. Local dùng localhost cho cả Creator, Support và API.
- Khách chưa đăng nhập vẫn đọc Support bình thường. Nút đăng nhập trong chat mở Creator `/login?supportReturnTo=...` rồi quay lại đúng bài Support và mở chat. Đăng xuất giữ nguyên bài đang đọc, xóa hội thoại của phiên trước. Client chỉ chấp nhận URL trả về thuộc `VITE_SUPPORT_URL`, tránh redirect ra domain tùy ý.
- Chat AI ở góc dưới phải gửi đến `${VITE_API_URL}/support/chat` với cookie và CSRF; backend dùng Gemma trong `services/ai`, giữ token nội bộ và không chuyển sang Gemini. Backend đưa tên/email của chính người dùng đã xác thực vào ngữ cảnh riêng với danh tính trợ lý, không nhận danh tính do client tự gửi. AI đọc chỉ mục web client và danh mục gói đang công bố trong database để trả lời quyền clone, giá và quota; đọc gói, số dư và các đơn gần nhất của chính người đang nhắn; không nhận danh tính, số tiền hay điều kiện hoàn từ model. Khách kiểm tra và xác nhận hoàn tiền gia hạn trong chat qua backend có CSRF. Xem [luồng hoàn tiền và cấu hình](../../docs/SUPPORT_REFUNDS.md). Xem [nguồn kiến thức và cách cập nhật](../../docs/SUPPORT_AI_KNOWLEDGE.md).
- Hội thoại giữ trong bộ nhớ tab, mất khi reload. AI cập nhật tóm tắt tích lũy cùng mỗi câu trả lời; lượt tiếp theo nhận tóm tắt và các tin gần nhất để giữ ngữ cảnh cả 10 câu hỏi trong cuộc trò chuyện. Tóm tắt mất khi mở mới hoặc đổi tài khoản. Có trạng thái chờ, thử lại cùng mã yêu cầu và nguồn hướng dẫn mở được.
- Chat nhận một ảnh PNG/JPG/WebP tĩnh mỗi lượt, tối đa 3 MB và 4.096 pixel mỗi chiều. Bấm biểu tượng ảnh hoặc dán Ctrl/Cmd + V khi clipboard có ảnh đã copy/cut; xem trước, bỏ hoặc thay ảnh rồi gửi, kể cả không nhập chữ. Dán đường dẫn tệp không tự đọc tệp. Chỉ khi gửi mới chuyển bytes đến backend, kiểm tra/chuẩn hóa ảnh trong bộ nhớ rồi đưa vào Gemma local có vision projector. Không lưu tệp ảnh vào database/Cloudinary, không gửi dịch vụ AI bên ngoài. Object URL chỉ dùng trong tab và được thu hồi khi bỏ ảnh, mở hội thoại mới hoặc đổi tài khoản. Retry dùng lại đúng bytes và mã yêu cầu; lượt tiếp theo chỉ có tóm tắt quan sát, không gửi lại ảnh cũ. Ảnh chụp giao dịch không thay thế đối soát VNPay/ledger để hoàn tiền. Chữ nhỏ nên cắt vùng cần đọc.
- Câu trả lời kèm ảnh có mục “Nội dung đọc được trong ảnh”. Backend dùng OCR local Anh/Việt trong worker tối đa 20 giây để trích chữ, kết hợp với ảnh thật cho Gemma phân tích. Model ngôn ngữ OCR được đóng gói cùng dependency, không tải CDN hoặc gửi API bên ngoài. Backend giữ ảnh tới 1.536 pixel, đặt câu hỏi hiện tại rõ ràng và ưu tiên nguồn đúng trang. Chữ trích xuất có thể sai ở ảnh nhỏ/mờ; không xem ảnh/OCR là chứng cứ tài chính. Gemma mặc định ngân sách ảnh 1120 token khi khởi động lại bằng `services/ai/start.cjs`; client chờ tối đa 110 giây cho lượt ảnh. `npm run test:image:browser` kiểm tra bằng trang Developer/code thật cùng một giá trị chỉ có trong pixels.
- Nội dung hướng dẫn được biên tập trong `src/articles.ts`, không phải dữ liệu hoạt động hoặc trạng thái health giả.

Deploy Vercel: Root Directory `apps/web-support`; cài các biến env theo môi trường thật rồi build. Ở client, đổi `VITE_SUPPORT_URL` sang domain của ứng dụng này và rebuild client. Backend cần `SUPPORT_ORIGINS` chứa origin Support thật và kết nối AI local hợp lệ. Client/Support trỏ cùng URL backend; với cookie SameSite=Lax hiện tại, nên dùng các subdomain HTTPS chung domain gốc (ví dụ creator/support/api cùng `veltrixvoice.autos`). Chỉ cùng máy chủ vật lý không làm cookie dùng chung giữa các domain khác nhau. Cấu hình URL loopback/token dịch vụ chỉ đặt ở backend.

Chat giới hạn dùng chung Mongo: 20 HTTP/phút/tài khoản, 40/IP; 6 inference/phút/tài khoản và IP, một inference Support toàn cụm. Retry vẫn chịu giới hạn HTTP và có cache câu trả lời theo tài khoản/IP/request trong 2 phút. Ingress có giới hạn trước parse/auth/DB; xem chi tiết trong tài liệu hoàn tiền. Chat dùng chung khóa inference hiện có với content; dịch vụ đang bận trả 429 và Retry-After. Không tạo Job hoặc thay đổi Credit.
