# Đăng ký gói và lưu Visa qua VNPay

Code đã nối nút đăng ký trên trang giá với đơn hàng MongoDB, trang VNPay và IPN xác nhận. Không đổi gói khi chỉ bấm nút hoặc quay về từ trang thanh toán. Chưa kiểm thử giao dịch với merchant thật; không coi các test ký IPN nội bộ là giao dịch sandbox VNPay.

## Cấu hình merchant

Điền riêng vào môi trường backend, không gửi secret qua chat và không dùng biến `VITE_`:

| Biến | Ý nghĩa |
| --- | --- |
| VNPAY_MODE | `sandbox` hoặc `production`, phải chọn rõ |
| VNPAY_TMN_CODE | Mã merchant PAY được VNPay cấp |
| VNPAY_HASH_SECRET | Secret ký PAY, giữ bí mật |
| VNPAY_RETURN_URL | URL HTTPS backend `/api/billing/vnpay/return` |
| VNPAY_CLIENT_URL | Origin frontend; local có thể là `http://localhost:5173` |
| VNPAY_TOKEN_ENABLED | Chỉ bật `true` khi merchant được cấp Tokenization |
| VNPAY_TOKEN_TMN_CODE | Mã merchant Tokenization |
| VNPAY_TOKEN_HASH_SECRET | Secret Tokenization, giữ bí mật |
| VNPAY_TOKEN_ENCRYPTION_KEY | Khóa AES-256, 64 ký tự hex; tạo bằng CSPRNG, backup riêng, giữ bí mật |
| VNPAY_TOKEN_RETURN_URL | URL HTTPS backend `/api/billing/vnpay/token/return` |
| VNPAY_TOKEN_CREATE_URL | URL production tạo token do VNPay cấp, HTTPS trên domain VNPay |
| VNPAY_TOKEN_PAYMENT_URL | URL production thanh toán token do VNPay cấp |

Đăng ký IPN PAY `/api/billing/vnpay/ipn` và IPN Tokenization `/api/billing/vnpay/token/ipn` với VNPay. Backend cần HTTPS công khai; `localhost` không nhận được IPN từ VNPay. PAY v2.1.0 dùng HMAC-SHA512, số tiền VND nhân 100 và thời gian GMT+7. Không đặt API sau lớp yêu cầu đăng nhập đối với IPN; endpoint tự kiểm tra chữ ký.

Nếu thiếu cấu hình, đăng ký bị khóa và backend trả `PAYMENT_PROVIDER_UNAVAILABLE`. Nếu chưa được cấp Tokenization, PAY vẫn dùng được nhưng chức năng lưu Visa bị khóa. Không có thẻ mẫu hoặc thanh toán giả.

## Dữ liệu và kích hoạt

- `BillingOrder` lưu chủ sở hữu, chu kỳ, số tiền, phiên bản quyền lợi, môi trường, trạng thái và mã giao dịch. Idempotency-Key chống tạo trùng đơn khi thử lại cùng yêu cầu.
- IPN kiểm tra chữ ký, merchant, kênh thanh toán, số tiền và trạng thái. Cập nhật đơn, gói, kỳ hạn và credit trong cùng MongoDB transaction. Thông báo trùng không cộng lại credit. MongoDB phải hỗ trợ replica set/transactions.
- Gói năm cấp credit mỗi tháng theo snapshot đã mua. Các tháng đến hạn được cấp khi người dùng đọc tài khoản/quyền lợi hoặc tạo request; không có lịch thu tiền tự động. Hết kỳ, quyền dùng tính năng quay về Free.
- Multiple paid subscriptions are supported. Each order keeps its own start/end dates and immutable entitlement snapshot. Every paid order grants its monthly credits once. Switching an unexpired subscription changes active entitlements without charging or granting credits again; all periods continue running. If the selected subscription expires, the latest unexpired purchase becomes active; otherwise effective entitlements fall back to Free.
- Token Visa chỉ tạo sau khi đồng ý và IPN thành công. Database lưu token AES-256-GCM, mã băm, loại thẻ và 4 số cuối. Không lưu PAN/CVV. VNPay không trả ngày hết hạn trong contract hiện tại nên giao diện không tự bịa ngày hết hạn.
- Token không xuất hiện trong API danh sách thẻ. Khi chọn thẻ đã lưu để đăng ký, token chỉ gửi sang URL thanh toán HTTPS VNPay theo contract của họ. Không log URL/query callback; reverse proxy cũng phải bỏ query khỏi access log. Thiết lập `Referrer-Policy: no-referrer` tại proxy đối với callback token.
- Sandbox và production được tách theo trường `mode`; không dùng thẻ sandbox để thanh toán production. Chưa có giao diện xóa token, hoàn tiền hay đối soát tự động. Không xoay khóa mã hóa tùy tiện: cần migration để mã hóa lại token trước khi thay khóa.

## Kiểm tra trước khi mở thu tiền

1. Cấu hình merchant sandbox và URL HTTPS, đăng ký IPN với VNPay.
2. Đăng nhập, chọn gói/chu kỳ và thanh toán theo bộ thẻ thử VNPay cấp. Kiểm tra trạng thái PAID, kỳ hạn và một bản ghi GRANT duy nhất.
3. Thử hủy thanh toán, chữ ký bị sửa, số tiền sai, IPN gửi trùng và trình duyệt quay về trước IPN. Không đổi gói khi thanh toán chưa được xác nhận.
4. Khi được cấp Tokenization, thêm Visa trong `/account/billing`, chờ ACTIVE, nghe xác nhận của VNPay; kiểm tra API chỉ có 4 số cuối rồi dùng thẻ để đăng ký gói ở tài khoản chưa có kỳ trả phí.
5. Kiểm tra một tài khoản khác không đọc được đơn hoặc dùng được thẻ. Xác minh nhật ký proxy không có token/query nhạy cảm.
6. Chuyển production chỉ sau khi VNPay duyệt merchant và giao dịch sandbox thực tế đạt. Đối soát lỗi hoặc gián đoạn IPN qua dashboard VNPay trước khi cấp quyền thủ công.

Tài liệu chính thức: [VNPay PAY](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html), [VNPay Tokenization](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-token/token.html), [đăng ký sandbox](https://sandbox.vnpayment.vn/devreg/).

## Financial history and notifications

Client: `/api/billing/orders`, `/api/billing/subscriptions`, POST `/api/billing/subscriptions/:id/select` with CSRF and expectedCurrentId. Admin OWNER/ADMIN: `/api/admin/billing/orders`, `/summary`, `/credits`. All lists use safe projections and owner scoping; sandbox amounts are separate from real payments. Cash summary is confirmed gross payments, not bank settlement or net revenue.

Authenticated `/api/notifications/stream` sends SSE updates from persisted database notifications every 2 seconds, including after reconnect. Payment success notification is created inside the same MongoDB transaction, unique per order. Read endpoints require CSRF. The frontend bell shows unread count, read-all and a payment-history link. Proxy must preserve SSE and disable buffering.
