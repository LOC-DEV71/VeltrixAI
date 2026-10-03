import { Layers } from 'lucide-react';
export function EmptyState({ title, description }: { title: string; description: string }) {
  return <section className="module-empty surface"><span className="empty-icon"><Layers size={28} /></span><span className="eyebrow">ĐANG PHÁT TRIỂN</span><h1>{title}</h1><p>{description}</p><span className="empty-state-note">Bạn vẫn có thể quản lý người dùng và cấu hình gói từ menu bên trái.</span></section>;
}
