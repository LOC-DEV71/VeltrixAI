import { useCallback, useEffect, useRef, useState } from 'react';
import {VoiceAvatar} from '../../components/ui/VoiceAvatar';
import {Pagination} from 'antd';
import { Plus } from 'lucide-react';
import { SystemVoiceCard } from './components/SystemVoiceCard';
import { CloneVoiceModal } from './components/CloneVoiceModal';
import { api } from '../../api';
import { audioUrl } from '../../hooks/useTtsData';
import { useAuth } from '../../contexts/AuthContext';
import { Link } from 'react-router-dom';

export const VoicesPage = () => {
  if (typeof document !== 'undefined') document.title = 'Veltrix AI - Quản lý Giọng đọc';
  const { user } = useAuth();
  const [page,setPage]=useState(1),[voicePage,setVoicePage]=useState(1),[voiceTotal,setVoiceTotal]=useState(0);
  const [modal, setModal] = useState(false); const [voices, setVoices] = useState<any[]>([]);
  const [config, setConfig] = useState<any>(null); const [error, setError] = useState('');
  const [busy, setBusy] = useState(''); const mounted = useRef(false);const requestVersion=useRef(0);
  const reload = useCallback(async () => {
    const version=++requestVersion.current;
    try {
      const [v, e] = await Promise.all([api.get(user ? '/voices' : '/voices/catalogue',{params:{page:voicePage,limit:10,type:'SYSTEM'}}), user ? api.get('/voice-enrollments',{params:{page,limit:10}}) : Promise.resolve(null)]);
      if (mounted.current&&version===requestVersion.current) { setVoices(v.data.data.systemVoices);setVoiceTotal(v.data.data.total); setConfig(e?.data.data || null); setError(''); }
    } catch { if (mounted.current&&version===requestVersion.current) setError('Không tải được thư viện giọng đọc.'); }
  }, [user,page,voicePage]);
  useEffect(() => { mounted.current = true; void reload(); return () => { mounted.current = false; }; }, [reload]);
  useEffect(() => {
    if (!config?.enrollments.some((e: any) => e.status === 'PENDING' || (e.cleanupPending && e.cleanupAttempts < 3))) return;
    const timer = setTimeout(() => void reload(), 2500); return () => clearTimeout(timer);
  }, [config, reload]);
  const changeStatus = async (enrollment: any, action: 'revoke' | 'delete') => {
    if (busy) return;
    if (!window.confirm(action === 'delete' ? 'Xóa giọng này và mẫu âm thanh? Giọng sẽ không dùng được nữa.' : 'Thu hồi giọng này và xóa mẫu âm thanh?')) return;
    setBusy(enrollment.id);
    try { if (action === 'delete') await api.delete('/voice-enrollments/' + enrollment.id); else await api.post('/voice-enrollments/' + enrollment.id + '/revoke'); await reload(); }
    catch { setError('Không cập nhật được giọng. Vui lòng thử lại.'); } finally { setBusy(''); }
  };
  return <div className="flex-1 min-w-0 bg-[#F7F8FC] h-full overflow-y-auto"><div className="max-w-[1120px] mx-auto p-8 space-y-8">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6"><div><h1 className="text-2xl font-semibold">Thư viện & Quản lý Giọng đọc</h1><p className="text-sm text-slate-500 mt-2">Giọng hệ thống và giọng nhân bản riêng cho nội dung của bạn.</p></div><button disabled={!config?.canClone} onClick={() => setModal(true)} className="flex items-center gap-2 bg-indigo-600 text-white rounded-lg px-4 py-3 disabled:opacity-50"><Plus size={18} />Tạo giọng Clone mới</button></div>
    {error && <div role="alert" className="text-red-700">{error} <button onClick={() => void reload()} className="underline">Thử lại</button></div>}
    <section className="space-y-4"><h2 className="text-lg font-semibold">Giọng hệ thống · {voiceTotal} giọng</h2><div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">{voices.map(v => <SystemVoiceCard key={v.id} name={v.name} gender={v.gender} locked={v.canUse === false} avatarUrl={v.avatarUrl || undefined} tags={[v.language?.startsWith('vi') ? 'Tiếng Việt' : v.language, v.gender === 'male' ? 'Nam' : v.gender === 'female' ? 'Nữ' : 'Khác', ...(v.tags||[])]} previewUrl={v.previewUrl ? audioUrl(v.previewUrl) : undefined} previewText={v.previewText} />)}</div><Pagination current={voicePage} total={voiceTotal} pageSize={10} showSizeChanger={false} onChange={setVoicePage} hideOnSinglePage/></section>
    <section id="clone" className="space-y-4"><h2 className="text-lg font-semibold">Giọng Clone của bạn</h2><p className="text-sm text-slate-500">Biến mẫu giọng của chính bạn thành giọng đọc riêng cho kịch bản và TTS. Dùng mẫu WAV rõ tiếng và xác nhận quyền sử dụng trước khi tạo.</p>
      {!user && <div className="rounded-xl p-5 bg-indigo-50 space-y-3"><p>Đăng nhập để xem quyền clone của gói và quản lý giọng riêng của bạn.</p><Link to="/login" state={{ returnTo: '/voices' }} className="inline-block bg-indigo-600 text-white rounded-lg px-4 py-2">Đăng nhập để clone giọng</Link></div>}
      {config && !config.canClone && <div className="rounded-xl p-5 bg-amber-50 text-amber-800">Gói hiện tại chưa hỗ trợ clone giọng. <Link to="/pricing" className="font-semibold underline">Xem gói hỗ trợ clone →</Link></div>}
      {user && !config && !error && <p>Đang tải...</p>}
      {config?.enrollments.filter((e: any) => e.status !== 'DELETED' || e.cleanupPending).map((e: any) => <div key={e.id} className="bg-white rounded-xl border border-slate-200 p-5 flex flex-wrap justify-between gap-4"><div><div className="flex gap-3 items-center"><VoiceAvatar name={e.name} gender={e.gender} avatarUrl={e.avatarUrl}/><h3 className="font-semibold">{e.name}</h3></div><div className="flex flex-wrap gap-2 mt-2">{(e.tags||[]).map((tag:string)=><span key={tag} className="text-xs px-2 py-1 rounded bg-indigo-50 text-indigo-600">{tag}</span>)}</div><p className="text-sm text-slate-500 mt-1">{e.status === 'PENDING' ? 'Đang tạo giọng...' : e.status === 'ACTIVE' ? 'Sẵn sàng sử dụng trong TTS & Chia cảnh' : e.status === 'DELETED' ? 'Đã xóa' : 'Đã thu hồi'} · Mẫu {e.duration.toFixed(1)} giây</p>{e.error && <p className="text-sm text-red-700">Không tạo được giọng từ mẫu này. Hãy thử mẫu rõ tiếng khác.</p>}{e.cleanupPending && <p className="text-sm text-slate-500">Đang chờ dọn mẫu âm thanh.</p>}</div><div className="flex gap-4 items-center">{['PENDING', 'ACTIVE'].includes(e.status) && <button disabled={!!busy} onClick={() => void changeStatus(e, 'revoke')} className="text-amber-700 disabled:opacity-50">Thu hồi</button>}{e.status !== 'DELETED' && <button disabled={!!busy} onClick={() => void changeStatus(e, 'delete')} className="text-red-700 disabled:opacity-50">Xóa</button>}</div></div>)}
      {config?.canClone && config.enrollments.every((e: any) => e.status === 'DELETED') && <p className="text-slate-500">Bạn chưa có giọng clone. Tải lên mẫu âm thanh để tạo giọng mới.</p>}
      <Pagination current={page} total={config?.total||0} pageSize={10} showSizeChanger={false} onChange={setPage} hideOnSinglePage/>
    </section>
    {modal && <CloneVoiceModal isOpen onClose={() => setModal(false)} onCreated={() => void reload()} consentVersion={config.consentVersion} limits={config} />}
  </div></div>;
};
