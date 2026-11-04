export type CategoryId = 'start' | 'content' | 'voice' | 'billing' | 'account' | 'developer';
export type Article = {
  id: string;
  category: CategoryId;
  title: string;
  summary: string;
  readMinutes: number;
  sections: {title: string; text: string; steps?: string[]}[];
  relatedLink?: 'docs' | 'developer' | 'client';
};

export const articles: Article[] = [
  {
    id: 'first-project', category: 'start', title: 'Bắt đầu dự án đầu tiên với Veltrix',
    summary: 'Từ ý tưởng đến kịch bản, phân cảnh và giọng đọc trong Workspace.', readMinutes: 3, relatedLink: 'client',
    sections: [
      {title: 'Không gian sáng tạo của bạn', text: 'Workspace lưu các dự án và nội dung của tài khoản. Bạn có thể bắt đầu từ ý tưởng mới hoặc sử dụng công cụ TTS độc lập để tạo giọng đọc từ văn bản có sẵn.'},
      {title: 'Tạo nội dung theo từng bước', text: 'Chuẩn bị chủ đề và mục tiêu rõ ràng trước khi tạo nội dung.', steps: ['Đăng nhập, mở Workspace và chọn Tạo dự án mới.', 'Nhập chủ đề, nền tảng, đối tượng và phong cách mong muốn.', 'Đọc và chỉnh sửa kịch bản trước khi chia cảnh.', 'Chọn giọng đọc, tạo audio cho các cảnh cần dùng và tải file kết quả.']},
      {title: 'Kiểm tra Credit trước khi tạo', text: 'Chi phí hiển thị tại thao tác tạo. Chỉ gửi lại yêu cầu sau khi đã kiểm tra trạng thái tác vụ trước đó để tránh tạo thêm tác vụ không cần thiết.'},
    ],
  },
  {
    id: 'content-settings', category: 'content', title: 'Chọn cấu hình để AI hiểu đúng kịch bản',
    summary: 'Phân biệt chủ đề, đối tượng người xem, tone giọng và thời lượng.', readMinutes: 3, relatedLink: 'docs',
    sections: [
      {title: 'Chủ đề là điều bạn muốn kể', text: 'Nhập nội dung chính vào chủ đề. Đối tượng người xem và tone giọng hướng dẫn cách trình bày; chúng không phải chủ đề của video. Ví dụ, “Gen Z, thích hài hước” là đối tượng và sở thích, không yêu cầu AI viết một video về Gen Z.'},
      {title: 'Thời lượng và số cảnh', text: 'Thời lượng mục tiêu giúp định hướng độ dài kịch bản; thời lượng audio thực tế còn phụ thuộc giọng đọc và tốc độ đọc. Số cảnh bằng 0 cho phép chọn tự động. Kiểm tra lời thoại và thời lượng sau khi tạo.'},
      {title: 'Định hướng sáng tạo', text: 'Nêu góc kể, thông điệp cần nhấn mạnh và điều cần tránh. Nếu có CTA, ghi hành động cụ thể bạn muốn người xem thực hiện. Không nhập dữ liệu riêng tư hoặc bí mật vào nội dung tạo.'},
    ],
  },
  {
    id: 'voice-download', category: 'voice', title: 'Tạo giọng đọc và tải audio',
    summary: 'Chọn giọng, theo dõi tác vụ và tải kết quả khi đã hoàn tất.', readMinutes: 2, relatedLink: 'docs',
    sections: [
      {title: 'TTS từ văn bản hoặc cảnh', text: 'Dùng công cụ Text to Speech cho văn bản độc lập hoặc tạo voice tại trang cảnh. Kiểm tra nội dung, ngôn ngữ và quyền dùng giọng của gói trước khi gửi.'},
      {title: 'Theo dõi tác vụ', text: 'Tác vụ có thể chờ trong hàng đợi trước khi xử lý. Khi thành công, dùng nút tải audio. Nếu thất bại, đọc thông báo lỗi trước khi thử lại; gửi liên tục có thể gặp giới hạn tốc độ hoặc tác vụ đồng thời.'},
      {title: 'Audio không phát được', text: 'Thử tải file, kiểm tra âm lượng thiết bị và phát bằng trình phát khác. Nếu file thiếu hoặc lỗi, ghi lại mã tác vụ và thông báo đang hiển thị. Không chia sẻ API token hoặc cookie đăng nhập.'},
    ],
  },
  {
    id: 'clone-voice', category: 'voice', title: 'Chuẩn bị mẫu âm thanh để nhân bản giọng',
    summary: 'Mẫu WAV rõ tiếng và quyền sử dụng giọng giúp hạn chế lỗi tạo clone.', readMinutes: 3, relatedLink: 'docs',
    sections: [
      {title: 'Chuẩn bị mẫu đúng', text: 'Dùng mẫu WAV có lời nói rõ, ít tạp âm và không có nhạc nền. Tuân thủ giới hạn định dạng, độ dài và kích thước hiển thị trong form; các giới hạn có thể thay đổi theo gói và cấu hình.'},
      {title: 'Quyền sử dụng giọng', text: 'Chỉ dùng giọng của bạn hoặc giọng mà bạn có quyền sử dụng. Xác nhận quyền sử dụng trước khi tạo. Không dùng bản clone để mạo danh người khác.'},
      {title: 'Khi giọng đang tạo hoặc báo lỗi', text: 'Kiểm tra trạng thái ở quản lý giọng đọc. Một giọng đang tạo chưa có nghĩa là đã sẵn sàng sử dụng. Nếu xuất hiện lỗi, lưu lại thông báo và mã tác vụ; không nhập lại cùng mẫu nhiều lần khi tác vụ trước vẫn đang xử lý.'},
    ],
  },
  {
    id: 'credit-holds', category: 'billing', title: 'Credit khả dụng, tạm giữ và đã sử dụng',
    summary: 'Hiểu số dư và cách Credit được xử lý trong một tác vụ AI.', readMinutes: 2, relatedLink: 'docs',
    sections: [
      {title: 'Credit khả dụng', text: 'Đây là số Credit có thể dùng cho yêu cầu mới. Các nguồn Credit miễn phí và trả phí được theo dõi riêng; kiểm tra thông tin trong tài khoản và lịch sử giao dịch.'},
      {title: 'Credit tạm giữ', text: 'Khi hệ thống nhận tác vụ, Credit có thể được tạm giữ để bảo đảm chi phí xử lý. Khoản tạm giữ chưa phải giao dịch đã hoàn tất.'},
      {title: 'Hoàn tất hoặc thất bại', text: 'Tác vụ thành công chốt chi phí. Với lỗi có thông báo “Credit giữ cho tác vụ đã được giải phóng”, khoản giữ đã được trả về khả dụng. Nếu số dư chưa cập nhật, tải lại trang và đối chiếu lịch sử với mã tác vụ.'},
    ],
  },
  {
    id: 'payment-check', category: 'billing', title: 'Đã thanh toán nhưng gói chưa cập nhật?',
    summary: 'Kiểm tra trạng thái đơn hàng và đối chiếu thông tin thanh toán.', readMinutes: 2, relatedLink: 'client',
    sections: [
      {title: 'Kiểm tra từ tài khoản', text: 'Mở Thanh toán và lịch sử giao dịch để kiểm tra đơn hàng. Không chỉ dựa vào trang chuyển hướng của cổng thanh toán; quyền lợi được cập nhật sau khi hệ thống xác nhận giao dịch.'},
      {title: 'Trước khi thanh toán lại', text: 'Đối chiếu mã đơn, thời điểm và số tiền đã giao dịch. Nếu tiền đã trừ nhưng đơn chưa cập nhật, tránh tạo thêm thanh toán cho cùng nhu cầu ngay lập tức.'},
      {title: 'Thông tin cần giữ lại', text: 'Lưu mã đơn và biên nhận để đối chiếu. Không cung cấp số thẻ đầy đủ, CVV, OTP ngân hàng, API token hoặc mật khẩu. Có thể kiểm tra các gói còn hiệu lực và gói đang được chọn tại Thanh toán.'},
    ],
  },
  {
    id: 'free-ip-policy', category: 'account', title: 'Vì sao không đăng nhập được tài khoản Free trên mạng này?',
    summary: 'Giới hạn 3 tài khoản Free duy nhất trên một IP trong tháng.', readMinutes: 3, relatedLink: 'client',
    sections: [
      {title: 'Giới hạn theo IP và tháng', text: 'Trong một tháng, một IP được liên kết với tối đa 3 tài khoản Free duy nhất. Đăng nhập lại tài khoản đã nằm trong danh sách không làm tăng số lượng. Credit vẫn là số dư riêng của từng tài khoản.'},
      {title: 'Tài khoản chưa thuộc danh sách', text: 'Khi IP đã đủ 3 tài khoản, một tài khoản Free khác sẽ bị từ chối đăng nhập từ mạng đó. Lượt bị từ chối không được cấp session mới. Tài khoản không bị ban, khóa hoặc vô hiệu hóa vì lý do này. Quy tắc không áp dụng cho tài khoản trả phí.'},
      {title: 'Mạng dùng chung', text: 'Các thiết bị trong cùng gia đình, văn phòng hoặc mạng công cộng có thể dùng chung IP. Cảnh báo không tiết lộ thông tin tài khoản khác. Tài khoản đã thuộc danh sách vẫn được đăng nhập dù IP đang được đánh dấu để theo dõi.'},
    ],
  },
  {
    id: 'developer-token', category: 'developer', title: 'Tạo API token và gửi yêu cầu TTS đầu tiên',
    summary: 'Xác thực Bearer token, chọn voiceId và nhận tác vụ tạo audio.', readMinutes: 3, relatedLink: 'developer',
    sections: [
      {title: 'Tạo token trong Cài đặt', text: 'Đăng nhập ứng dụng, mở Cài đặt và tạo API token với quyền cần thiết cùng thời hạn phù hợp. Lưu token ở biến môi trường trên máy chủ của bạn. Không đưa token vào code trình duyệt hoặc kho mã công khai.'},
      {title: 'Tạo audio theo tác vụ', text: 'Lấy voiceId từ danh sách giọng, gửi text và voiceId đến API tạo tác vụ. Dùng Idempotency-Key cho một yêu cầu nghiệp vụ để retry cùng nội dung không tạo thêm tác vụ.'},
      {title: 'Theo dõi và tải WAV', text: 'Tác vụ mới trả HTTP 202 và data.jobId. Thăm dò trạng thái mỗi 3–5 giây; chỉ tải WAV khi trạng thái COMPLETED và sử dụng cùng token. Xem tài liệu Developer để lấy endpoint đúng môi trường.'},
    ],
  },
  {
    id: 'job-errors', category: 'start', title: 'Xử lý tác vụ thất bại hoặc chờ lâu',
    summary: 'Kiểm tra lỗi, trạng thái Credit và thử lại đúng thời điểm.', readMinutes: 2, relatedLink: 'docs',
    sections: [
      {title: 'Kiểm tra trạng thái trước', text: 'Tác vụ đang chờ và tác vụ thất bại là hai trạng thái khác nhau. Ghi lại mã tác vụ, thời điểm tạo và lỗi hiển thị. Không bấm tạo liên tục khi tác vụ vẫn còn chạy.'},
      {title: 'Dịch vụ tạm thời không sẵn sàng', text: 'Lỗi CONTENT_PROVIDER_UNAVAILABLE cho biết dịch vụ tạo nội dung không sẵn sàng. Thử lại sau khi dịch vụ phục hồi. Nếu lỗi liên quan văn bản hoặc mẫu âm thanh, điều chỉnh đầu vào theo thông báo trước khi gửi lại.'},
      {title: 'Kiểm tra Credit và giới hạn', text: 'Đối chiếu số dư và các khoản tạm giữ trong tài khoản. Nếu bị giới hạn tốc độ, chờ khoảng thời gian thông báo. Giới hạn tác vụ đồng thời phụ thuộc quyền lợi gói hiện hành.'},
    ],
  },
];

export function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}
