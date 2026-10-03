import { useEffect, useRef, useState } from 'react';
import { Tour } from 'antd';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export const OPEN_WORKSPACE_TOUR = 'veltrix:open-workspace-tour';
const steps = [
  { target: 'create-project', title: 'Bắt đầu với một dự án', description: 'Bấm “Tạo Dự án mới”, đặt tên cho ý tưởng của bạn. Mỗi dự án giúp lưu và quản lý kịch bản, phân cảnh và audio cùng một nơi.' },
  { target: '/workspace', title: 'Quản lý các dự án', description: 'Các dự án đã lưu xuất hiện ở Workspace. Mở thẻ dự án để tiếp tục làm việc; dùng menu ba chấm để đổi tên hoặc xóa dự án.' },
  { target: '/content', title: 'Viết kịch bản bằng AI', description: 'Nhập chủ đề, chọn đối tượng người xem, tone giọng và thời lượng. Sau khi có kịch bản, chuyển sang Chia cảnh & Tạo Audio để chỉnh lời đọc và xem prompt hình ảnh, video.' },
  { target: '/tts', title: 'Chuyển văn bản thành giọng nói', description: 'Nhập nội dung, chọn giọng và xem Credit dự kiến trước khi tạo. Audio hoàn tất được lưu vào lịch sử để nghe lại hoặc tải xuống.' },
  { target: '/voices', title: 'Khám phá thư viện giọng', description: 'Nghe thử các giọng hệ thống trước khi chọn. Giọng ngoài quyền sử dụng của gói vẫn nghe mẫu được. Bạn cũng có thể tạo giọng clone của riêng mình nếu gói hỗ trợ.' },
  { target: 'credits', title: 'Theo dõi Credit và quyền lợi', description: 'Kiểm tra số dư tại đây. Nút Nâng cấp giúp bạn xem các gói và quyền lợi hiện có. Bạn có thể mở lại hướng dẫn bằng nút “Hướng dẫn nhanh” trong thanh bên.' },
];

export function WorkspaceTour() {
  const { user } = useAuth();
  const location = useLocation();
  const userId = user?._id || user?.id;
  const storageKey = userId ? `veltrix:workspace-tour:v1:${userId}` : null;
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(0);
  const seenThisSession = useRef(new Set<string>());
  const dismiss = () => {
    setOpen(false);
    if (storageKey) {
      seenThisSession.current.add(storageKey);
      try { localStorage.setItem(storageKey, 'done'); } catch { /* Tour still closes when browser storage is unavailable. */ }
    }
  };
  useEffect(() => {
    setOpen(false); setCurrent(0);
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey || location.pathname !== '/workspace' || seenThisSession.current.has(storageKey)) return;
    try { if (localStorage.getItem(storageKey) === 'done') return; } catch { /* Show once in this session. */ }
    seenThisSession.current.add(storageKey);
    setCurrent(0); setOpen(true);
  }, [storageKey, location.pathname]);
  useEffect(() => {
    const replay = () => { setCurrent(0); setOpen(true); };
    window.addEventListener(OPEN_WORKSPACE_TOUR, replay);
    return () => window.removeEventListener(OPEN_WORKSPACE_TOUR, replay);
  }, []);

  return <Tour open={open} current={current} onChange={setCurrent} onClose={dismiss} onFinish={dismiss}
    zIndex={10000} type="primary" scrollIntoViewOptions={{ block: 'nearest', behavior: 'smooth' }}
    steps={steps.map((step, index) => ({
      title: step.title,
      description: <div className="space-y-3"><p>{step.description}</p><button type="button" onClick={dismiss} className="underline underline-offset-4 font-semibold" aria-label="Bỏ qua hướng dẫn">Bỏ qua &gt;&gt;</button></div>,
      target: document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`),
      prevButtonProps: { children: 'Quay lại' },
      nextButtonProps: { children: index === steps.length - 1 ? 'Bắt đầu sử dụng' : 'Tiếp theo' },
    }))} />;
}
