# Hoàn tiền gia hạn trong Support

Khách đăng nhập bằng cùng Session Creator, yêu cầu hoàn tiền trong chat rồi bấm **Kiểm tra đơn gia hạn**. AI chỉ mở bảng kiểm tra: không được chỉ định số tiền, người nhận, endpoint VNPay hoặc bỏ qua xác minh. Khách chọn đơn, backend kiểm tra, rồi khách bấm **Xác nhận hoàn toàn bộ tiền**.

## Điều kiện và bằng chứng

- Chỉ đơn `RENEWAL`, với đơn trả phí trước đó của cùng khách và cùng gói. Checkout phân loại phía server; đơn cũ chưa có bằng chứng không tự đoán là gia hạn.
- Trong 24 giờ theo cả bản ghi IPN và thời gian thanh toán VNPay; không quá 1.000 Credit thực sự tiêu thụ từ lô cấp cho lần gia hạn.
- Đối chiếu order, biên nhận IPN bất biến, sổ thu, lô Credit, GRANT, reservation và RESERVE/SETTLE ledger. Không dùng số dư toàn tài khoản hoặc lượng Credit giữ làm lượng đã dùng.
- Tác vụ còn giữ Credit của lô này phải kết thúc trước; dữ liệu thiếu hoặc không khớp sẽ từ chối, không suy đoán để gửi tiền.
- Querydr VNPay phải có chữ ký hợp lệ, đúng merchant, đơn, số tiền, trạng thái thành công, mã giao dịch gốc và thời gian thanh toán khớp biên nhận. Kiểm tra lại khi xác nhận; quote hết hạn sau 2 phút.

## Chống hoàn trùng và trạng thái

MongoDB cần replica set và transaction. Unique index trên order, request key và mã yêu cầu VNPay được kiểm tra trước khi phục vụ. Transaction đóng băng riêng Credit chưa dùng của lần gia hạn và ngừng quyền lợi đơn đó; các gói khác, Credit khác và content/voice vẫn giữ.

Chỉ CAS `PREPARED → SENDING` mới cho phép gửi một lệnh refund toàn bộ. Hai thiết bị, hai replica, đổi request key hoặc bấm nhanh không tạo lệnh thứ hai. Mã yêu cầu provider được lưu bền vững trước khi gửi; không dựa vào khóa trên nút hoặc RAM.

| Trạng thái | Ý nghĩa |
| --- | --- |
| PREPARED | Khách đã xác nhận, dữ liệu và Credit đã khóa trong transaction |
| SENDING | Một tiến trình đã nhận quyền gửi yêu cầu |
| PROCESSING | VNPay báo đang xử lý, chưa ghi tiền hoàn vào sổ |
| UNKNOWN | Timeout, mất phản hồi, chữ ký sai hoặc kết quả chưa rõ; chỉ querydr, không gửi lại refund |
| COMPLETED | Kết quả hoàn toàn bộ đã xác minh; tạo một refund receipt bất biến |
| REJECTED | Phản hồi từ chối đã ký và khớp đơn; khôi phục Credit chưa hết hạn và quyền lợi đơn |

Không khẳng định tiền đã về tài khoản ngân hàng chỉ từ thao tác gửi. Cần đối soát thủ công qua merchant VNPay nếu UNKNOWN kéo dài; hiện không có API admin tự ép thành công hoặc gửi lại lệnh chưa rõ kết quả. REJECTED không tự tạo yêu cầu mới cho cùng đơn.

Lưu xác nhận khách, phiên bản chính sách, dấu thời gian, hash IP, tham chiếu payment/cash/grant, Credit đã tiêu thụ và lịch sử chuyển trạng thái bất biến. Admin xem hồ sơ đơn, 10 sự kiện gần nhất, thông báo realtime; sổ thu chi chỉ trừ refund receipt đã xác minh, tách sandbox khỏi tiền thật.

## Giới hạn tải

Ingress chặn trước parse/auth/DB: 60 yêu cầu/phút/IP và 600/phút/tiến trình, tối đa 5.000 bucket. Các giới hạn Mongo dùng chung giữa replica: chat 20 HTTP/phút/tài khoản, 40/IP, 6 inference/phút/tài khoản và IP, một inference Support toàn cụm. Cache retry theo đúng tài khoản/IP/request, TTL 2 phút; không cấp quyền từ cache chat.

Refund check: một lần/10 giây/tài khoản, 30/phút/IP, 60/phút/toàn cụm. Confirm/status/view: 6/phút/tài khoản cho từng loại, 30/IP, 120/toàn cụm. Retry cũng chịu giới hạn. Worker đối soát dùng lease toàn cụm, batch 10; mỗi đơn có khoảng cách query tối thiểu 30 giây. Provider timeout 15 giây, không tự retry POST refund. Rate limit ứng dụng không thay thế bảo vệ DDoS băng thông tại reverse proxy/CDN.

## Cấu hình và kiểm chứng

`VNPAY_REFUND_ENABLED=true` chỉ sau khi merchant được cấp API querydr/refund. Đặt `VNPAY_SERVER_IP` là IP máy chủ được merchant cho phép. Production cần `VNPAY_TRANSACTION_API_URL` HTTPS do VNPay cấp; sandbox dùng endpoint chính thức cố định. Dùng thông tin merchant đúng kênh PAY/Tokenization và môi trường giao dịch. Xem mô tả tiếng Việt trong `apps/backend-api/.env.example`.

```powershell
cd apps/backend-api
npm run build
node --test tests/billing-refund.test.cjs tests/support-admission.test.cjs tests/support-chat.test.cjs tests/support-session.test.cjs tests/support-knowledge.test.cjs tests/support-plans.test.cjs
```

Kiểm thử tự động dùng Mongo riêng và cổng giao thức VNPay có chữ ký giả lập: xác minh chống trùng giữa hai tiến trình, mất phản hồi, ownership, CSRF, Credit hỗn hợp, 1.000/1.001 Credit, quote cũ và hoàn bị từ chối. Đây không phải giao dịch VNPay sandbox thật. Trước production phải kiểm chứng một giao dịch sandbox được merchant cấp quyền, querydr/refund thực tế, timeout và đối soát; không dùng tiền khách để kiểm thử.

Contract: [VNPay querydr/refund](https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr&refund.html).

Giao diện thật được kiểm tra tại Support đang chạy cổng 5175 bằng `npm run test:refund:browser` trong `apps/web-support`. Test mở bảng thanh toán, kiểm tra điều kiện, bấm xác nhận ba lần và kiểm tra desktop/tablet/mobile; API dùng Mongo tạm và VNPay có chữ ký giả lập. `SUPPORT_BROWSER_LIVE_AI=true` kiểm chứng thêm câu trả lời của Gemma local và nút kiểm tra trong chat. Backend cần build trước; không dùng dữ liệu khách thật.
