import React, { useEffect, useState } from 'react';
import { Download, ImageOff, Sparkles } from 'lucide-react';
import { api } from '../api';

export interface ImagePreset {
  id: string; label: string; kind: 'local' | 'fal'; isDefault: boolean;
  estimateSeconds: number; measured: boolean; installed: boolean; downloadGB: number;
}
interface PresetList { default: string; installed: boolean; missing?: string[]; presets: ImagePreset[] }

const STORAGE_KEY = 'creatorai.imagePreset';
const HINTS: Record<string, string> = {
  fast: 'Nhẹ, phù hợp khi cần nhanh',
  balanced: 'Đẹp và nhanh, khuyên dùng',
  quality: 'Chi tiết hơn, chậm hơn',
  cloud: 'Chạy trên FAL, tính phí vào tài khoản FAL của bạn',
};

export const formatDuration = (seconds: number) => {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `~${s} giây`;
  const m = Math.floor(s / 60), rest = s % 60;
  return `~${m} phút${rest ? ` ${rest} giây` : ''}`;
};

/** Loads presets once; also used by the "Tạo lại" menu in the workflow card. */
export function useImagePresets() {
  const [data, setData] = useState<PresetList | null>(null);
  useEffect(() => {
    let alive = true;
    api.get('/images/presets').then((r) => { if (alive) setData(r.data.data); }).catch(() => { if (alive) setData({ default: 'balanced', installed: false, presets: [] }); });
    return () => { alive = false; };
  }, []);
  return data;
}

/** Remembered choice (falls back to the server default). */
export function rememberedPreset(list: PresetList | null) {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  if (saved === 'off') return 'off';
  if (list && saved && list.presets.some((p) => p.id === saved)) return saved;
  return list?.default ?? 'balanced';
}

interface Props { value: string; onChange: (id: string) => void; sceneCount: number; disabled?: boolean; presets: PresetList | null }

export const ImageQualityPicker: React.FC<Props> = ({ value, onChange, sceneCount, disabled, presets }) => {
  const choose = (id: string) => { onChange(id); try { localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode */ } };
  if (!presets) return <p className="text-sm text-slate-400">Đang tải lựa chọn chất lượng ảnh…</p>;
  return (
    <fieldset className="rounded-xl border border-slate-200 p-4 space-y-2" disabled={disabled}>
      <legend className="px-1 text-sm font-semibold text-slate-700">Chất lượng ảnh</legend>
      {!presets.installed && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Máy chủ chưa cài xong bộ tạo ảnh (packages/image-gen){presets.missing?.length ? `, còn thiếu: ${presets.missing.join(', ')}` : ''}. Ảnh local tạm khóa; video sẽ dùng nền Pexels hoặc gradient.</p>
      )}
      <div role="radiogroup" aria-label="Chất lượng ảnh" className="space-y-2">
        {presets.presets.map((p) => {
          const selected = value === p.id;
          return (
            <label key={p.id} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${selected ? 'border-indigo-500 bg-indigo-50/60' : 'border-slate-200 hover:border-indigo-300'} ${!presets.installed && p.kind === 'local' ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <input type="radio" name="image-preset" className="mt-1 accent-indigo-600" checked={selected} disabled={!presets.installed && p.kind === 'local'} onChange={() => choose(p.id)} />
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800 text-sm">{p.label}</span>
                  {p.isDefault && <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-100 rounded-full px-2 py-0.5">Mặc định</span>}
                  {p.kind === 'fal' && <span className="text-[11px] font-semibold text-violet-700 bg-violet-100 rounded-full px-2 py-0.5">Tốn phí</span>}
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">{HINTS[p.id] ?? ''}</span>
                <span className="block text-xs text-slate-600 mt-1 tabular-nums">
                  {formatDuration(p.estimateSeconds)}/ảnh · tổng {formatDuration(p.estimateSeconds * sceneCount)} cho ~{sceneCount} cảnh
                  {!p.measured && <span className="text-slate-400"> (ước tính)</span>}
                </span>
                {!p.installed && p.downloadGB > 0 && (
                  <span className="flex items-center gap-1 text-xs text-amber-700 mt-1"><Download size={12} /> Cần tải ~{p.downloadGB} GB (tự tải lần đầu, có thanh tiến độ)</span>
                )}
              </span>
            </label>
          );
        })}
        <label className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer ${value === 'off' ? 'border-indigo-500 bg-indigo-50/60' : 'border-slate-200 hover:border-indigo-300'}`}>
          <input type="radio" name="image-preset" className="accent-indigo-600" checked={value === 'off'} onChange={() => choose('off')} />
          <span className="flex items-center gap-2 text-sm text-slate-700"><ImageOff size={15} /> Không tạo ảnh AI (dùng Pexels / gradient)</span>
        </label>
      </div>
      <p className="flex items-start gap-1.5 text-xs text-slate-500 pt-1"><Sparkles size={12} className="mt-0.5 shrink-0" /> Ảnh dùng prompt có sẵn của từng cảnh. Cảnh lỗi hoặc không có prompt sẽ tự dùng nền dự phòng.</p>
    </fieldset>
  );
};
