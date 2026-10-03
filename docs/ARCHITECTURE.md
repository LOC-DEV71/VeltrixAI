# Cấu trúc dự án và Mô hình Kiến trúc v0.1

## 1. Tổng quan Kiến trúc Hệ thống
- **Client (Frontend)**: React + Vite + Ant Design + SCSS. Bao gồm Landing Page và Studio.
- **Admin (Frontend)**: Ứng dụng React riêng biệt trong cùng repository (Monorepo). Quản trị người dùng, gói, credit, giọng nói.
- **Backend**: Node.js + Express. Cấu trúc theo mô hình MVC, tách lớp Service để xử lý logic nghiệp vụ. 
- **Internal TTS Service**: Python + FastAPI. Dùng adapter VieNeu/Gwen. Chạy nội bộ, không public ra ngoài. Quyết định: tự chạy mã nguồn/package + model weights tải đầy đủ, cố định phiên bản, lưu license, có bản sao lưu và kiểm tra inference không phụ thuộc nguồn tải khi triển khai. Chưa chọn phần cứng hoặc cam kết công suất. Được gọi thông qua Backend Node.js Worker qua HTTP API nội bộ (Python không trực tiếp tiêu thụ BullMQ).
- **Cơ sở dữ liệu (Database)**: MongoDB Atlas + Mongoose. Nguồn chính thức cho dữ liệu và sổ credit.
- **Hàng đợi (Queue) & Rate Limit**: Redis + BullMQ.
- **Lưu trữ File**: Cloudinary (lưu trữ avatar, audio công khai và riêng tư).
- **Security & Proxy**: Cloudflare ở phía trước (DDoS protection, WAF). Khóa truy cập origin.

## 2. Các Module Backend
Ứng dụng Backend được chia thành các nhóm module nghiệp vụ:

### 2.1. Nhóm Tài khoản (Account Group)
- **Auth**: Xử lý đăng nhập Google (Google Identity Services) và OTP (Resend). Quản lý Access Token (Cookie HttpOnly) và Refresh Token (lưu hash).
- **Users**: Quản lý thông tin người dùng, cài đặt cá nhân, device ID.
- **Sessions**: Theo dõi và thu hồi các phiên đăng nhập.
- **Roles & Permissions**: Quản lý phân quyền nội bộ admin.

### 2.2. Nhóm Sáng tạo (Creative Group)
- **Workspaces / Projects**: Quản lý dự án của người dùng.
- **Contents / Scenes**: Chia nhỏ nội dung thành các cảnh. Mỗi cảnh có phiên bản, prompt và kết nối với audio.
- **Prompts**: Quản lý sinh prompt cho việc tạo ảnh/video (không tự tạo ảnh/video).

### 2.3. Nhóm Giọng nói (Voice Group)
- **Voices**: Quản lý danh sách giọng đọc (công khai, cá nhân, premium).
- **VoiceEnrollments**: Quản lý việc clone giọng (dành cho Plus/Pro).
- **TTS**: Module giao tiếp với Internal Python TTS Service để yêu cầu sinh audio thông qua hàng đợi (BullMQ).

### 2.4. Nhóm Vận hành (Operations Group)
- **Jobs**: Giao tiếp với BullMQ để quản lý các tác vụ bất đồng bộ (sinh nội dung Gemini, sinh TTS).
- **Media**: Quản lý upload/download file với Cloudinary.
- **Credits**: Sổ cái (Ledger) quản lý giao dịch credit.
- **Plans & Subscriptions**: Xử lý logic các gói Free/Plus/Pro.
- **Payments**: Tích hợp cổng thanh toán.

### 2.5. Nhóm Quản trị (Admin Group)
- **AbuseControl**: Cơ chế chống lạm dụng cấp credit (3 tài khoản/thiết bị). Device ID ở đây là tín hiệu nhận diện heuristic kết hợp nhiều yếu tố, không phải định danh chắc chắn của máy vật lý.
- **AuditLogs**: Lưu log thao tác nhạy cảm.
- **Settings**: Cấu hình hệ thống động.

## 3. Kiến trúc Luồng Dữ liệu (MVC)
`Client Request -> Route -> Middleware (Auth/Role/RateLimit) -> Controller -> Service (Business Logic) -> Model/Provider -> Database/3rd Party`
- **Controller**: Chỉ nhận request, gọi validate (ví dụ: Zod), gọi Service, và format response trả về. Không chứa logic nghiệp vụ cốt lõi.
- **Service**: Xử lý logic nghiệp vụ, orchestration, quản lý transaction.
- **Provider**: Các module bọc dịch vụ bên ngoài (Gemini Provider, TTS Provider, Cloudinary Provider).

## 4. Bảo mật & Chống DDoS
- **Cloudflare**: Lọc request, WAF, rate limit ở tầng mạng.
- **Node.js Middleware**: Helmet, CORS allowlist, CSRF, kiểm tra Body/Upload size. 
- **Rate Limit (Redis)**: Giới hạn OTP/Login, sinh AI, clone giọng theo từng cấp (IP, User, Thiết bị).
- **Bảo mật Secret**: Mọi secret key (Gemini, Resend, Cloudinary) chỉ nằm ở backend.
- **Kiểm soát truy cập File**: Audio clone và âm thanh riêng tư được lưu trên Cloudinary với private/authenticated delivery. Bắt buộc kiểm tra quyền sở hữu (ownership) của user trước khi cấp quyền truy cập.
