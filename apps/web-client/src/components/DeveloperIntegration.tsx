import {developerApiUrl} from '../utils/developerApiUrl';
export function DeveloperIntegration() {
  const base = developerApiUrl;
  const example = `# Chạy ở máy chủ. TOKEN là biến môi trường chứa API token.
curl "${base}/voices?page=1" \\
  -H "Authorization: Bearer $TOKEN"

# Lấy voiceId từ systemVoices hoặc cloneVoices có canUse=true.
curl -X POST "${base}/tts/jobs" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: don-hang-123-loi-doc-1" \\
  -d '{"text":"Xin chào, đây là lời đọc của tôi.","voiceId":"VOICE_ID"}'

# Dùng data.jobId trả về, thăm dò mỗi 3–5 giây.
curl "${base}/tts/jobs/JOB_ID" \\
  -H "Authorization: Bearer $TOKEN"

# Khi status=COMPLETED, tải WAV bằng cùng token.
curl "${base}/tts/jobs/JOB_ID/audio" \\
  -H "Authorization: Bearer $TOKEN" -o loi-doc.wav`;
  return <section className="space-y-5 min-w-0"><h3 className="font-semibold text-lg">API v1 · Xác thực Bearer token</h3><p className="text-sm text-slate-600 break-all">Địa chỉ API của môi trường hiện tại: <code>{base}</code></p>
    <div className="overflow-x-auto border rounded-xl"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">Endpoint</th><th className="p-3">Quyền</th><th className="p-3">Chức năng</th></tr></thead><tbody>{[
      ['GET /voices?page=1','voices:read','Giọng hệ thống và giọng riêng, 10 kết quả/trang.'],
      ['GET /limits','tts:read','Đơn giá Credit và giới hạn TTS hiện hành.'],
      ['POST /tts/jobs','tts:write','Tạo audio; gửi text, voiceId và Idempotency-Key.'],
      ['GET /tts/jobs/:id','tts:read','Theo dõi trạng thái tác vụ thuộc tài khoản.'],
      ['GET /tts/jobs/:id/audio','tts:read','Tải WAV của tác vụ đã hoàn tất.']
    ].map(row=><tr key={row[0]} className="border-t">{row.map(cell=><td key={cell} className="p-3">{cell}</td>)}</tr>)}</tbody></table></div>
    <pre className="overflow-x-auto rounded-xl bg-slate-950 text-slate-100 p-5 text-xs leading-6"><code>{example}</code></pre>
    <p className="text-sm text-slate-600 leading-7">Phản hồi JSON có dạng <code>{'{success, data}'}</code> hoặc <code>{'{success: false, error: {code, message}}'}</code>. Tạo tác vụ trả HTTP 202; gửi lại cùng khóa với cùng văn bản và giọng trả tác vụ cũ, không trừ Credit lần nữa. Dùng khóa mới khi muốn tạo một bản audio mới.</p>
    <p className="text-sm text-slate-600 leading-7">Trạng thái: QUEUED → PROCESSING → COMPLETED hoặc FAILED/CANCELLED. Chỉ tải audio khi COMPLETED. Credit được tạm giữ khi nhận tác vụ, chốt khi thành công và giải phóng khi thất bại. Quyền gói và đơn giá được lưu theo từng tác vụ.</p>
    <div className="rounded-xl bg-indigo-50 p-4 text-sm leading-7">HTTP 401: token sai, hết hạn hoặc đã thu hồi. HTTP 403: thiếu quyền hoặc gói không cho phép. HTTP 402: không đủ Credit. HTTP 429: quá nhiều yêu cầu, chờ theo Retry-After. Các mã như API_SCOPE_REQUIRED, TTS_TEXT_LIMIT_EXCEEDED và PLAN_LIMIT_EXCEEDED giúp ứng dụng xử lý lỗi. Giới hạn và đơn giá lấy từ tài khoản đang dùng; không cố định trong mã tích hợp.</div>
    <p className="text-sm text-slate-500">Luôn gọi API từ máy chủ của bạn. Không đặt token trong trình duyệt, URL, log hoặc kho mã công khai. Nếu lộ token, thu hồi trong Cài đặt và tạo token mới.</p>
  </section>;
}
