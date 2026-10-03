# Các vấn đề Mở & Phụ thuộc chưa xác minh (Open Questions) - v0.2

Dưới đây là danh sách các phụ thuộc hệ thống cần làm rõ hoặc test hiệu năng trước khi đi vào giai đoạn Code Production:

## 1. Gemini API (Google AI)
- **Model ID**: `gemini-3.1-flash-lite` hiện là tên dự kiến. Cần gọi API xác minh mã Model ID chính thức hợp lệ.
- **Quota & Rate Limit**: Tài liệu hiện liệt kê là Free Tier, nhưng không bảo đảm SLA cho môi trường Production (như User đã đề cập). Cần làm rõ:
  - Giới hạn Request Per Minute (RPM) và Tokens Per Minute (TPM) thực tế của tài khoản hiện tại.
  - Xử lý khi chạm ngưỡng (Delay queue ở BullMQ bao lâu?).
  - Dự kiến khi nào chuyển sang gói Pay-as-you-go để đảm bảo ổn định.

## 2. Internal TTS Service (Python FastAPI + VieNeu/Gwen)
- **Tài nguyên Phần cứng**: Cần chốt thông số triển khai.
  - Adapter VieNeu/Gwen cần bao nhiêu VRAM (GPU) hoặc CPU để sinh audio trong thời gian chấp nhận được?
  - Hệ thống hiện tại có GPU không? Nếu chỉ dùng CPU, tốc độ sinh (RTF - Real Time Factor) là bao nhiêu?
- **Độ trễ (Latency)**: API gọi từ Node.js (Worker) sang Python mất bao lâu cho 1 câu trung bình. Quyết định Timeout cho BullMQ Job TTS.
- **Concurrency**: FastAPI cấu hình Worker như thế nào để nhận nhiều request đồng thời mà không nghẽn phần cứng?

## 3. Hệ thống Lưu trữ & CDN (Cloudinary)
- **Giới hạn File**: Cloudinary free tier có giới hạn dung lượng lưu trữ (Storage) và băng thông (Bandwidth). Đối với app sinh Audio liên tục, cần đo đếm lượng Audio trung bình sinh ra/tháng để ước lượng chi phí.
- **Độ trễ Signed URL**: Xác minh độ trễ khi lấy Signed URL ở backend và tốc độ phát trên Frontend đối với URL loại Authenticated Delivery.

## 4. Giá Gói & Credit
- Số lượng Credit cụ thể cho gói Free/Plus/Pro.
- Bảng quy đổi: 1 Credit = Bao nhiêu Token Gemini? 1 Credit = Bao nhiêu giây TTS? (Cần dựa vào chi phí từ mục 1, 2, 3 để chốt sau).
