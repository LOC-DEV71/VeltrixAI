# Tài chính admin

Ba trang có API và mục đích riêng:

| Trang | API | Nội dung | Ngày lọc |
|---|---|---|---|
| Đơn đăng ký | GET /api/admin/billing/orders | Yêu cầu mua gói, trạng thái đơn, thời hạn/quyền đang chọn | Ngày tạo đơn |
| Thanh toán | GET /api/admin/billing/payments | Kết quả VNPay, ngân hàng/loại thẻ, mã giao dịch, response/status | Ngày hệ thống xác nhận |
| Dòng tiền | GET /api/admin/billing/cashflow | Tổng tiền thu, giá trị trung bình, biểu đồ theo ngày/tháng, phân bổ theo gói, sổ thu | Ngày hệ thống xác nhận tiền thu |

GET `/api/admin/billing/orders/:id` trả giá/quyền lợi chốt từ snapshot, thời hạn, metadata thanh toán an toàn và 10 lần cấp Credit gần nhất. Không trả snapshot đầy đủ, token thẻ, chữ ký hoặc secret.

Các API đều yêu cầu phiên admin và quyền `billing.read`; các danh sách phân trang 10 dòng. Bộ lọc tài khoản nhận ID hoặc email chính xác (Credit tiếp tục nhận ID). Thanh toán lọc theo `outcome` SUCCESS/FAILED và `transactionId`; dòng tiền mặc định production, 30 ngày gần nhất, khoảng tùy chọn tối đa 366 ngày. Khoảng dài hơn 62 ngày dùng biểu đồ theo tháng.

## Ghi sổ

`payment_receipts`: bản ghi bất biến cho IPN đã xác minh và được chấp nhận; cả kết quả thành công và thất bại. Chỉ lưu metadata cho phép, không lưu payload callback nguyên bản/chữ ký/số thẻ/token. Ngày VNPay được lưu khi định dạng hợp lệ; `confirmedAt` là thời điểm hệ thống tiếp nhận kết quả cuối cùng.

`cash_movements`: khoản PAYMENT_RECEIVED chỉ được tạo khi thanh toán thành công. IPN ghi receipt, khoản thu, cấp quyền/Credit và trạng thái đơn trong cùng transaction. Unique orderId ngăn ghi thu hai lần khi gửi lại callback. Callback bị từ chối chữ ký/số tiền không tạo receipt hoặc khoản thu. Socket thông báo sau khi transaction commit.

Các model cấm sửa/xóa/bulkWrite bản ghi. Quyền truy cập MongoDB sản xuất vẫn phải hạn chế thao tác trực tiếp ngoài ứng dụng.

## Dữ liệu trước khi có sổ

Đơn PAID/FAILED cũ chưa có receipt xuất hiện ở Thanh toán với nguồn `LEGACY_ORDER`; không giả định ngân hàng, response code hay ngày ngân hàng khi chúng chưa được lưu. Với FAILED cũ, mốc hệ thống là updatedAt của đơn, không phải bằng chứng về thời điểm giao dịch ngân hàng. Đơn PAID có paidAt chưa có cash movement được đưa vào báo cáo thu theo paidAt. `$lookup` loại đơn đã có bản ghi mới để không cộng trùng. Đây là phép đọc tương thích, không thay đổi các đơn/snapshot cũ hoặc tạo giao dịch ngân hàng mới.

Đơn PENDING không xuất hiện ở bảng kết quả thanh toán và không được cộng tiền thu. Đơn PAID thiếu paidAt không được tự gán ngày để cộng báo cáo; kiểm tra tại Đối soát bất thường.

## Giới hạn dữ liệu tài chính

Đây là sổ tiền thu đã xác nhận tại ứng dụng. Chưa có nguồn phí gateway, hoàn tiền, chi phí hạ tầng hoặc tiền quyết toán về ngân hàng; các trường đó là null. Không gọi tổng thu là lợi nhuận hay số dư ngân hàng. Sandbox tách riêng và không phải doanh thu thực tế.

`node scripts/check-admin-finance.cjs` kiểm tra số lượng và tổng thu trên dữ liệu local, không xuất email/ID khách hoặc secrets. Các kiểm thử dùng MongoDB tách biệt: `node --test tests/admin-finance.test.cjs tests/billing.test.cjs`. Kiểm tra giao diện: `node tests/billing-browser-local.cjs` trong web-admin khi Vite đang chạy 5174.
