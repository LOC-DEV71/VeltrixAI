# AG-016 — Google login 403 không ổn định (2026-10-01)

## Phát hiện từ mã

Chưa có request/response thực tế từ trình duyệt để khẳng định mọi lỗi 403 đều do CSRF. Backend có hai nhánh 403 ở đường Google login: middleware trả `CSRF token mismatch` và controller trả `User banned`.

Hai lỗi vòng đời CSRF được xác định từ mã:

1. `GET /api/v1/auth/csrf` luôn cấp token mới, kể cả cookie đang có token hợp lệ. Request bootstrap có thể làm token trong request ghi khác hoặc tab khác hết khớp.
2. Logout xóa cookie CSRF nhưng interceptor frontend vẫn giữ token trong bộ nhớ; đăng nhập lại ngay không tải token mới, dẫn tới cookie thiếu/header cũ.

## Bản sửa backend

- `src/middlewares/csrfMiddleware.ts`: dùng lại cookie token hợp lệ (64 ký tự hex), chỉ cấp cookie mới khi thiếu/không hợp lệ; thêm `Cache-Control: no-store`. Request ghi vẫn phải có cookie và header trùng nhau.
- `src/controllers/AuthController.ts`: logout vẫn xóa access/refresh cookie và revoke session, nhưng cấp CSRF mới cùng cookie, response header và body. Interceptor hiện có đọc header để cập nhật token trong bộ nhớ.
- `tests/csrf.test.ts`: thêm kiểm tra bootstrap lặp lại, cấp token khi thiếu/không hợp lệ, từ chối POST không có cookie; sửa response mock cho test POST hợp lệ.

Không sửa frontend hoặc packages dùng chung.

## Kiểm tra

- Backend typecheck: PASS.
- Test CSRF chưa chạy được: Vitest lỗi `spawn EPERM` khi tải config trong sandbox; yêu cầu chạy riêng test ngoài sandbox bị người dùng từ chối.
- Chưa xác minh end-to-end với credential Google thật. Cần chạy lại backend có mã mới, tải lại trang và kiểm tra login/logout/login nhiều lần.

## Phần Frontend cần Antigravity xử lý

Bootstrap lần đầu khi chưa có cookie vẫn có thể gửi nhiều GET CSRF đồng thời: mỗi request không có cookie đều cần cấp token riêng. Backend dùng lại cookie không giải quyết được race này. `AuthContext.tsx` và interceptor `api.ts` cần dùng chung một promise tải CSRF; mọi request ghi phải chờ promise này hoàn tất. Nếu tải token lỗi, phải dừng request ghi. Khi nhận 403 có message `CSRF token mismatch`, tải lại CSRF và retry tối đa một lần; middleware từ chối trước khi controller thực hiện thao tác. Không retry 403 `User banned` hoặc các lỗi phân quyền khác.

## Các bước kiểm chứng / tái hiện (chưa chạy trên browser)

- Có cookie token A, gọi GET CSRF lặp lại hoặc đồng thời: sau sửa header/body vẫn trả A, không thay cookie.
- Logout với cookie/header hợp lệ: access/refresh bị xóa; CSRF cookie và header mới phải cùng B; POST Google tiếp theo dùng B phải qua middleware.
- Xóa cookie, mở trang và đăng nhập nhanh trong lúc bootstrap chưa xong: kiểm tra số GET CSRF và thứ tự response. Antigravity cần xử lý nếu có hơn một GET đồng thời.
- Thu thập endpoint của response 403 để phân biệt `/api/v1/auth/google` với endpoint Google Identity bên ngoài. Che Google credential, cookie, CSRF header, OTP, Authorization và dữ liệu cá nhân.

Ví dụ kiểm chứng middleware, dùng placeholder thay giá trị thật:

```http
POST /api/v1/auth/google
Cookie: csrfToken=[REDACTED_A]
x-csrf-token: [REDACTED_B]
Content-Type: application/json

{"credential":"[REDACTED]"}
```

Response mong đợi khi A khác B (không phải response đã quan sát từ browser):

```json
{"success":false,"error":{"code":"FORBIDDEN","message":"CSRF token mismatch"}}
```

HTTP status 403. Không bỏ CSRF protection để khắc phục login.
