# Kế hoạch Triển khai (Implementation Plan) - v0.1

Dựa trên yêu cầu của Creator AI, lộ trình được chia thành các Phase rõ ràng, có Dependency (Phụ thuộc) lẫn nhau.

## Phase 1: Foundation (Nền tảng)
- **Tác vụ**: 
  - Khởi tạo Monorepo cấu trúc (pnpm workspaces / npm workspaces).
  - Setup ESLint, Prettier, TypeScript.
  - Setup Node.js Express server cơ bản.
  - Cấu hình kết nối MongoDB, Redis.
- **Dependency**: Không.

## Phase 2: User & Authentication (Xác thực)
- **Tác vụ**:
  - Thiết kế Schema `users`, `sessions`.
  - Tích hợp Google Identity Services (Backend verify JWT).
  - Tích hợp Resend (Email OTP).
  - Xử lý Cookie Session (Login, Logout).
- **Dependency**: Hoàn thành Phase 1.

## Phase 3: Core API (Projects & Scenes) & Cloudinary
- **Tác vụ**:
  - Schema `projects`, `scenes`, `audios`.
  - CRUD API cho Project và Scene.
  - Tích hợp Cloudinary Provider (Cấu hình private media).
- **Dependency**: Hoàn thành Phase 2 (Cần middleware Auth).

## Phase 4: Job Queue & Credits System
- **Tác vụ**:
  - Cài đặt BullMQ, Redis.
  - Schema `credit_ledger`.
  - API lấy Balance.
  - Viết luồng Reserve -> Enqueue -> Settle/Refund.
  - Cài đặt cơ chế chống lạm dụng Free Credit (3 account / device).
- **Dependency**: Hoàn thành Phase 2 & 3.

## Phase 5: Tích hợp Gemini (AI Content)
- **Tác vụ**:
  - Viết Gemini Provider sử dụng model `gemini-3.1-flash-lite`.
  - Worker BullMQ để xử lý sinh content, split scene, tạo visual prompt.
  - Trừ credit dựa trên số lượng token (input/output).
- **Dependency**: Hoàn thành Phase 4.

## Phase 6: Tích hợp Internal TTS (Python)
- **Tác vụ**:
  - Backend Node.js tạo HTTP Client kết nối tới Python FastAPI (VieNeu/Gwen).
  - Worker BullMQ xử lý TTS Job (TTS độc lập và TTS theo Scene).
  - Xử lý versioning của Scene để chống ghi đè nhầm Audio.
- **Dependency**: Hoàn thành Phase 4.

## Phase 7: Web Clients & Admin Portal
- **Tác vụ**:
  - Triển khai UI Landing Page & Studio (React + Vite).
  - Triển khai UI Admin Portal.
  - Kết nối Frontend với API.
- **Dependency**: API đã sẵn sàng từ Phase 2 đến Phase 6.

## Phase 8: Security & Testing (Bảo mật & Kiểm thử)
- **Tác vụ**:
  - Áp dụng Helmet, CORS, Rate Limit vào Backend.
  - Cấu hình Cloudflare WAF.
  - Test luồng tính tiền đồng thời.
- **Dependency**: Toàn bộ hệ thống cơ bản hoàn tất.
