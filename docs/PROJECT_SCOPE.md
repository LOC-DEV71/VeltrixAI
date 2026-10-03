# Phạm vi Sản phẩm (Project Scope) - Creator AI v0.1

## 1. Mục tiêu Cốt lõi
Ứng dụng Creator AI giúp người dùng sáng tạo nội dung văn bản (bằng Gemini) và sinh ra các kịch bản có lời đọc, hỗ trợ tạo prompt cho hình ảnh/video. Nền tảng hướng tới việc cung cấp công cụ tạo kịch bản tự động, chuyên nghiệp với giọng đọc AI độc quyền.

## 2. Phạm vi Sản phẩm (In Scope)
- **Quản lý Nội dung (Content)**: Sử dụng Gemini (dự kiến gemini-3.1-flash-lite) để viết, chỉnh sửa, viết lại nội dung dựa trên yêu cầu người dùng.
- **Tạo Prompt Media**: Sinh prompt (mô tả) cho ảnh hoặc video dựa trên nội dung kịch bản để người dùng có thể tự mang đi tạo ở các hệ thống khác.
- **Phân rã Cảnh (Scene Splitting)**: Hỗ trợ tự động chia tách nội dung dài thành các cảnh (scene) riêng biệt khi người dùng yêu cầu.
- **Quản lý Cảnh (Scene Management)**: Mỗi cảnh bao gồm:
  - Nội dung/Lời đọc.
  - Mô tả cảnh.
  - Prompt tạo ảnh/video.
  - Nút "Tạo giọng đọc" riêng lẻ cho cảnh.
- **Công cụ TTS độc lập**: Công cụ Text-to-Speech dùng ngay không cần phải khởi tạo Project.
- **Quản lý Giọng nói (Voices)**:
  - Gói Free: Có quyền truy cập vào bộ giọng miễn phí do hệ thống cung cấp.
  - Gói Plus/Pro: Có tính năng clone (sao chép) giọng cá nhân và quyền truy cập vào toàn bộ giọng premium.
  - Gói Pro: Tương tự Plus nhưng cung cấp số lượng credit lớn hơn.
- **Website (Ứng dụng Client & Admin)**:
  - Landing Page.
  - Studio (Khu vực làm việc/sáng tạo).
  - Admin (Khu vực quản trị hệ thống).

## 3. Không thuộc Phạm vi (Out of Scope)
- Không sinh ảnh hoặc video trực tiếp trên hệ thống (chỉ sinh prompt).
- Không có tính năng timeline dựng phim hoặc xuất file MP4 tổng hợp.
- Không có tính năng tự động đăng nội dung/video lên các mạng xã hội.
- Không có tính năng cộng tác nhóm (team collaboration) ở phiên bản này.
- Không cung cấp API công khai (Public API) cho khách hàng bên ngoài tích hợp.

## 4. Chính sách Tín dụng Miễn phí (Free Credits)
- Mỗi thiết bị (dựa trên server-side identification, không cam kết xác nhận phần cứng vật lý tuyệt đối) chỉ được cấp Free Credit cho **tối đa 3 tài khoản** trong một kỳ xét (1 tháng, tính theo múi giờ Asia/Ho_Chi_Minh).
- Tài khoản thứ 4 đăng nhập trên cùng thiết bị sẽ bị từ chối cấp Free Credit, nhưng **không bị khóa đăng nhập**.
