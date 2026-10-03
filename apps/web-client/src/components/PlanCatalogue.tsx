import { useEffect, useState } from 'react';
import { api } from '../api';

type PublicPlan = { tier: string; revision: number; config: {
  overview: { name: string }; credits: { ttsPer100Chars: number; contentCost: number; monthlyGrant: number; rolloverAllowed: boolean; maxRollover: number | null };
  content: { enabled: boolean; maxDurationSeconds: number }; scenes: { maxScenes: number };
  clone: { enabled: boolean; maxVoices: number | null; minReferenceSeconds: number | null; maxReferenceSeconds: number | null; maxFileBytes: number | null };
} };
export const PlanCatalogue = () => {
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api.get('/plans', { signal: controller.signal }).then(res => setPlans(res.data.data)).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);
  return <section className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-3" aria-label="Quyền lợi hiện hành">
    <h3 className="font-semibold text-slate-900">Quyền lợi và phí hiện hành</h3>
    <p className="text-xs leading-relaxed text-slate-600">Đọc trực tiếp từ cấu hình gói. Mỗi yêu cầu mới chụp phiên bản này; tác vụ đã tạo giữ nguyên giá và giới hạn của nó.</p>
    {error ? <p role="alert" className="text-sm text-amber-800">Chưa tải được cấu hình. Xem phí và quyền lợi trong công cụ trước khi tạo tác vụ.</p> : !plans.length ? <p className="text-sm text-slate-500">Đang tải cấu hình gói…</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Gói', 'Kịch bản', 'TTS / 100 ký tự', 'Credit mỗi tháng', 'Clone'].map(label => <th key={label} className="p-2 whitespace-nowrap">{label}</th>)}</tr></thead><tbody>{plans.map(({ tier, revision, config: c }) => <tr key={tier} className="border-t border-indigo-100">
      <td className="p-2 font-semibold whitespace-nowrap">{c.overview.name}<span className="block font-normal text-slate-500">Phiên bản {revision}</span></td>
      <td className="p-2">{c.content.enabled ? `Tối đa ${c.content.maxDurationSeconds} giây / ${c.scenes.maxScenes} cảnh; ${c.credits.contentCost} Credit/lần` : 'Không hỗ trợ'}</td>
      <td className="p-2 whitespace-nowrap">{c.credits.ttsPer100Chars} Credit, làm tròn lên</td>
      <td className="p-2">{c.credits.monthlyGrant.toLocaleString('vi-VN')}; {c.credits.rolloverAllowed ? `cộng dồn ${c.credits.maxRollover === null ? 'không giới hạn' : `tối đa ${c.credits.maxRollover}`}` : 'không cộng dồn'}</td>
      <td className="p-2">{c.clone.enabled ? `${c.clone.maxVoices ?? 'Không giới hạn'} giọng; mẫu ${c.clone.minReferenceSeconds}–${c.clone.maxReferenceSeconds}s, tối đa ${((c.clone.maxFileBytes ?? 0) / 1048576).toFixed(1)} MiB` : 'Không hỗ trợ'}</td>
    </tr>)}</tbody></table></div>}
  </section>;
};
