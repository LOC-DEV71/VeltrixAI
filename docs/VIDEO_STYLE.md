# Tiêu chuẩn video – Veltrix AI

## Vai trò
Bạn là senior motion designer kiêm kỹ sư Remotion. Mục tiêu: video Shorts dọc 1080x1920, 30fps,
chất lượng ngang các kênh motion-graphics lớn. Không phải "chạy được là xong".

## Kiến trúc
- Dựng video bằng Remotion (React + TypeScript). Bỏ cách ghép nền + chữ bằng ffmpeg.
- LLM xuất kịch bản dạng JSON theo schema bên dưới, validate bằng zod, sai thì retry rồi mới fallback.
- Mỗi kiểu cảnh là một component template riêng, nhận props từ JSON.

## Schema cảnh
{ "type": "hook|icon_card|stat|list|compare|scale|timeline|quote|cta",
  "voice": "câu đọc", "title": "", "subtitle": "",
  "icon": "tên icon lucide", "emphasis": ["từ khóa cần highlight"],
  "data": {}, "bg_keywords": ["english keywords"] }
Luật: không có 2 cảnh liền nhau cùng type. Cảnh đầu luôn là hook, cảnh cuối là cta.

## Hệ thống thiết kế
- Font: Be Vietnam Pro (800 cho tiêu đề, 500 cho phụ). Phải kiểm tra đủ dấu tiếng Việt.
- Màu: nền tối #0B0B1A, chủ đạo tím #7C5CFF, nhấn vàng #FFD23F, phụ cyan #3DE0FF. Không thêm màu khác.
- Thẻ: glassmorphism (nền trắng 8%, blur 20px, viền trắng 15%, bo 32px).
- Safe area: chừa 12% trên, 20% dưới (tránh UI của TikTok/Shorts).
- Chữ tiêu đề tối thiểu 72px, caption 56px, luôn có bóng hoặc viền để dễ đọc.

## Luật chuyển động (BẮT BUỘC)
1. Không có khung hình nào đứng yên quá 0,8 giây. Luôn có ít nhất 1 thứ đang chuyển động.
2. Mỗi khung hình tối thiểu 4 lớp: nền (video/ảnh Ken Burns) → lớp màu gradient → họa tiết động
   (hạt sáng, lưới, vệt sáng) → nội dung (thẻ/icon/số) → caption.
3. Mọi chuyển động dùng spring() hoặc easing có đà, cấm tuyến tính. Vào: overshoot nhẹ. Ra: nhanh, gọn.
4. Các phần tử xuất hiện lần lượt (stagger 3-6 frame), không bật cùng lúc.
5. Mỗi cảnh có 3 pha: vào (≤12 frame) → sống (chuyển động nhẹ liên tục: float, pulse, parallax) → ra.
6. Chuyển cảnh đa dạng (slide, zoom-through, wipe, blur), không lặp một kiểu quá 2 lần liên tiếp.
7. Từ trong "emphasis" phải có hiệu ứng riêng: đổi màu vàng, phóng 110%, rung nhẹ hoặc gạch chân chạy.

## Template từng type
- hook: chữ to bật lên từng từ, icon lớn xoay nhẹ, nền zoom mạnh, flash sáng ở frame đầu.
- icon_card: thẻ trượt lên + icon có vòng sáng pulse, tiêu đề gõ chữ, mô tả fade-in.
- stat: số đếm từ 0 (có format tiếng Việt), vòng tròn/thanh tiến độ chạy đồng bộ.
- list: tối đa 3 dòng, mỗi dòng có icon, hiện theo nhịp giọng đọc.
- compare: chia đôi, 2 thẻ vào từ 2 bên, chữ "VS" nảy ở giữa, bên thắng sáng lên.
- scale: thang nhiều cấp, chấm sáng chạy lên tới cấp được nhắc, camera trượt theo.
- timeline: trục thời gian vẽ dần, các mốc bật ra theo giọng đọc.
- quote: khung trích dẫn, chữ hiện từng từ, dấu ngoặc lớn mờ phía sau.
- cta: icon like/subscribe nảy, vòng sáng lan ra, chữ kêu gọi ngắn.

## Đồng bộ âm thanh
- Độ dài cảnh = độ dài audio cảnh đó + 6 frame đệm.
- Word timestamps từ TTS (không có thì chạy Whisper). Caption 2-4 từ một lần, từ đang đọc highlight.
- Mỗi phần tử quan trọng xuất hiện đúng lúc từ tương ứng được đọc.
- SFX: whoosh khi chuyển cảnh, pop khi thẻ/icon bật ra, tick khi số đếm. Âm lượng SFX thấp.
- Nhạc nền có ducking dưới giọng đọc. Master về -14 LUFS.

## Nền
- Ưu tiên video dọc từ Pexels theo bg_keywords (cache lại), rồi tới ảnh + Ken Burns, cuối cùng mới gradient động.
- Luôn phủ lớp tối + blur 6-10px để nội dung nổi lên.

## Quy trình kiểm tra (BẮT BUỘC sau mỗi lần sửa)
1. Render video mẫu, trích 8 khung hình rải đều (renderStill) và tự xem từng ảnh.
2. Tự chấm theo checklist: chữ đủ dấu và dễ đọc? Có khung nào trống hay nhàm? Đúng safe area?
   Có đủ 4 lớp? Hình nền có khớp nội dung? Màu đúng hệ thống?
3. Mục nào chưa đạt thì sửa và lặp lại, tối đa 3 vòng, rồi mới báo kết quả kèm ảnh khung hình.

## Thứ tự triển khai
Giai đoạn 1: setup Remotion + design system + template hook, icon_card, stat + caption → render → báo.
Giai đoạn 2: các template còn lại + chuyển cảnh + SFX.
Giai đoạn 3: nền Pexels + tối ưu tốc độ render.
Không nhảy giai đoạn khi chưa được duyệt.