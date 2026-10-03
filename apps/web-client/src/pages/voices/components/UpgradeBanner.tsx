import React from 'react';
import { Lock, Zap } from 'lucide-react';
import { Button } from '../../../components/ui/Button';

export const UpgradeBanner: React.FC = () => {
  return (
    <div className="bg-white border border-[var(--color-border)] rounded-[16px] p-8 text-center relative overflow-hidden shadow-sm">
      {/* Background accent subtle */}
      <div className="absolute -right-12 -top-12 w-48 h-48 bg-indigo-50 rounded-full blur-2xl opacity-60 pointer-events-none"></div>
      
      <div className="max-w-xl mx-auto flex flex-col items-center">
        {/* Icon Lock / Audio */}
        <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-[var(--color-primary)] flex items-center justify-center mb-4 border border-[var(--color-border)] shadow-sm">
          <Lock size={28} />
        </div>

        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 px-3 py-1 rounded-full mb-3 border border-amber-200">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          Mở khóa với gói Plus hoặc Pro
        </div>

        <h3 className="text-[20px] font-semibold text-[var(--color-text-main)] mb-2 tracking-tight">
          Tự động nhân bản (Clone) giọng nói của chính bạn
        </h3>
        <p className="text-sm text-[var(--color-text-sub)] leading-relaxed mb-6">
          Bạn hiện đang sử dụng <strong>Gói Free</strong>. Chỉ cần tải lên một đoạn ghi âm ngắn (10-30 giây), công nghệ AI sẽ tạo ra bản sao giọng nói độc quyền với ngữ điệu tự nhiên 99%, sẵn sàng dùng cho mọi kịch bản video.
        </p>

        {/* Action Button */}
        <div className="flex items-center gap-3">
          <Button className="gap-2 px-6 bg-[var(--color-primary)] hover:bg-indigo-700">
            <Zap size={16} className="text-amber-200 fill-amber-200" /> Nâng cấp gói Plus / Pro để mở khóa
          </Button>
          <Button variant="outline" className="border-gray-200 bg-white text-gray-700">
            Tìm hiểu thêm
          </Button>
        </div>
      </div>
    </div>
  );
};
