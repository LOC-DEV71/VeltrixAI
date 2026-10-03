import { PaymentMethodsPanel } from '../components/PaymentMethodsPanel';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Modal } from 'antd';
import {DeveloperTokensPanel} from '../components/DeveloperTokensPanel';
import { CreditCard, HelpCircle, LogOut, Save, Settings, SlidersHorizontal, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api';
import { errorMessage } from '../utils/userMessages';
import { OPEN_WORKSPACE_TOUR } from '../components/layout/WorkspaceTour';
import { SubscriptionProgress } from '../components/SubscriptionProgress';
import {BillingResult} from '../components/BillingResult';
import {TransactionHistory} from '../components/TransactionHistory';
import {OwnedSubscriptions} from '../components/OwnedSubscriptions';

const tabs = [
  { path: '/account/profile', label: 'Hồ sơ', icon: UserRound },
  { path: '/account/preferences', label: 'Tùy chỉnh cá nhân', icon: SlidersHorizontal },
  { path: '/account/settings', label: 'Cài đặt', icon: Settings },
  { path: '/account/billing', label: 'Thanh toán', icon: CreditCard },
];
const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500';
const draftFrom = (user: any) => ({ displayName: user?.displayName || '', bio: user?.profile?.bio || '', occupation: user?.profile?.occupation || '', platform: user?.preferences?.platform || 'tiktok', audience: user?.preferences?.audience ?? 'Gen Z, thích hài hước', tone: user?.preferences?.tone || 'funny' });

export function AccountPage() {
  if (typeof document !== 'undefined') document.title = 'Veltrix AI - Tài khoản';

  const { user, refreshUser, logout } = useAuth();
  const refresh = useRef(refreshUser); refresh.current = refreshUser;
  const location = useLocation(); const navigate = useNavigate();
  const [modal, contextHolder] = Modal.useModal();
  const [draft, setDraft] = useState(() => draftFrom(user));
  const [saved, setSaved] = useState(() => draftFrom(user));
  const [revision, setRevision] = useState(user?.accountRevision || 0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [planName, setPlanName] = useState('');


  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const section = tabs.find(t => t.path === location.pathname) || tabs[0];
  const profile = section.path === '/account/profile';
  const preferences = section.path === '/account/preferences';
  useEffect(() => {
    if (profile || preferences) return;
    const reload = () => { if (document.visibilityState === 'visible') void refresh.current(); };
    reload(); const timer = setInterval(reload, 60000);
    window.addEventListener('focus', reload);
    return () => { clearInterval(timer); window.removeEventListener('focus', reload); };
  }, [profile, preferences]);
  useEffect(() => { const controller = new AbortController(); api.get('/plans/me', { signal:controller.signal }).then(r => setPlanName(r.data.data.config.overview.name)).catch(() => { if (!controller.signal.aborted) setPlanName('Chưa tải được thông tin gói'); }); return () => controller.abort(); }, []);
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', listener); return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
  const update = (key: keyof typeof draft, value: string) => setDraft(old => ({...old,[key]:value}));
  const changeTab = async (path: string) => {
    if (busy || path === location.pathname) return;
    if (dirty && !await modal.confirm({title:'Bạn có muốn hủy thay đổi chưa lưu?',content:'Các thay đổi trong biểu mẫu sẽ được bỏ khi chuyển mục.',okText:'Hủy thay đổi',cancelText:'Tiếp tục chỉnh sửa'})) return;
    setDraft(saved); setError(''); navigate(path);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || !dirty) return; setBusy(true); setError('');
    try {
      const payload = profile ? {displayName:draft.displayName,profile:{bio:draft.bio,occupation:draft.occupation}} : {preferences:{platform:draft.platform,audience:draft.audience,tone:draft.tone}};
      const response = await api.patch('/users/me', { expectedRevision:revision, ...payload });
      const next = draftFrom(response.data.data); setDraft(next); setSaved(next); setRevision(response.data.data.accountRevision);
      await refreshUser(); toast.success('Đã lưu thay đổi của bạn.');
    } catch (e: any) {
      setError(e.response?.data?.error?.code === 'ACCOUNT_REVISION_CONFLICT' ? 'Tài khoản đã được cập nhật ở nơi khác. Hãy tải lại dữ liệu trước khi lưu.' : errorMessage(e));
    } finally { setBusy(false); }
  };
  const reload = async () => {
    if (dirty && !await modal.confirm({title:'Tải lại dữ liệu tài khoản?',content:'Thay đổi chưa lưu sẽ được thay bằng dữ liệu đã lưu.',okText:'Tải lại',cancelText:'Giữ thay đổi'})) return;
    setBusy(true); try { const r = await api.get('/users/me'); const next=draftFrom(r.data.data);setDraft(next);setSaved(next);setRevision(r.data.data.accountRevision);await refreshUser();setError(''); } catch(e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const signOut = async () => {
    if (!await modal.confirm({title:'Đăng xuất khỏi thiết bị này?',content:dirty ? 'Thay đổi chưa lưu sẽ bị hủy. Dữ liệu đã lưu của bạn vẫn được giữ.' : 'Bạn cần đăng nhập lại để tiếp tục sử dụng Workspace.',okText:'Đăng xuất',cancelText:'Ở lại'})) return;
    setBusy(true);try { await logout();navigate('/login'); } catch(e) { toast.error(errorMessage(e));setBusy(false); }
  };
  return <div className="p-6 md:p-10 max-w-5xl w-full mx-auto space-y-6">{contextHolder}
    <header><p className="text-xs uppercase tracking-widest text-indigo-600 font-semibold">Tài khoản của bạn</p><h1 className="mt-2 text-3xl font-bold text-slate-900">{section.label}</h1><p className="mt-2 text-sm text-slate-500">Quản lý thông tin và thiết lập cho không gian sáng tạo của bạn.</p></header>
    <nav aria-label="Quản lý tài khoản" className="flex flex-wrap gap-2">{tabs.map(t => <button key={t.path} type="button" aria-current={t.path === section.path ? 'page' : undefined} disabled={busy} onClick={() => void changeTab(t.path)} className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${t.path === section.path ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-indigo-50'}`}><t.icon size={17}/>{t.label}</button>)}</nav>
    <section className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8 shadow-sm">
      {error && <div role="alert" className="mb-6 rounded-xl bg-red-50 p-4 text-red-700 text-sm">{error}<button type="button" disabled={busy} onClick={() => void reload()} className="ml-3 font-semibold underline">Tải lại dữ liệu</button></div>}
      {profile || preferences ? <form onSubmit={save} className="space-y-6">
        {profile ? <>
          <div className="flex items-center gap-4 pb-6 border-b border-slate-100"><span className="w-16 h-16 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-2xl font-bold">{draft.displayName.charAt(0).toUpperCase() || 'U'}</span><div><h2 className="font-semibold text-lg">Thông tin cá nhân</h2><p className="text-sm text-slate-500 mt-1">Tên hiển thị được dùng trong Workspace.</p></div></div>
          <label className="block text-sm font-medium space-y-2"><span>Tên hiển thị *</span><input required maxLength={100} value={draft.displayName} disabled={busy} onChange={e=>update('displayName',e.target.value)} className={inputClass}/></label>
          <label className="block text-sm font-medium space-y-2"><span>Email đăng nhập</span><input readOnly value={user?.email || ''} className={`${inputClass} bg-slate-50 text-slate-500`}/><span className="block text-xs text-slate-500">Email gắn với phương thức đăng nhập hiện tại.</span></label>
          <label className="block text-sm font-medium space-y-2"><span>Nghề nghiệp / Vai trò</span><input maxLength={100} value={draft.occupation} disabled={busy} placeholder="Ví dụ: Nhà sáng tạo nội dung" onChange={e=>update('occupation',e.target.value)} className={inputClass}/></label>
          <label className="block text-sm font-medium space-y-2"><span>Giới thiệu bản thân</span><textarea rows={4} maxLength={500} value={draft.bio} disabled={busy} onChange={e=>update('bio',e.target.value)} className={inputClass}/><span className="block text-xs text-slate-400">{draft.bio.length}/500 ký tự · Thông tin này được lưu trong tài khoản của bạn.</span></label>
        </> : <>
          <div><h2 className="font-semibold text-lg">Thiết lập viết kịch bản mặc định</h2><p className="mt-2 text-sm leading-6 text-slate-500">Áp dụng khi mở kịch bản mới. Nội dung đã lưu giữ nguyên cấu hình; bạn vẫn có thể điều chỉnh từng lần tạo.</p></div>
          <label className="block text-sm font-medium space-y-2"><span>Nền tảng ưu tiên</span><select className={inputClass} value={draft.platform} disabled={busy} onChange={e=>update('platform',e.target.value)}><option value="tiktok">TikTok</option><option value="shorts">YouTube Shorts</option><option value="reels">Instagram Reels</option></select></label>
          <label className="block text-sm font-medium space-y-2"><span>Đối tượng người xem</span><input maxLength={300} value={draft.audience} disabled={busy} onChange={e=>update('audience',e.target.value)} className={inputClass}/></label>
          <label className="block text-sm font-medium space-y-2"><span>Tone giọng mặc định</span><select className={inputClass} value={draft.tone} disabled={busy} onChange={e=>update('tone',e.target.value)}><option value="funny">Hài hước, hóm hỉnh</option><option value="pro">Chuyên nghiệp</option><option value="drama">Cảm xúc, kịch tính</option></select></label>
        </>}
        <footer className="flex flex-wrap justify-between items-center gap-4 pt-5 border-t border-slate-100"><span className="text-xs text-slate-500">{dirty ? 'Có thay đổi chưa lưu' : 'Thông tin đã đồng bộ'}</span><div className="flex gap-3"><button type="button" disabled={!dirty || busy} onClick={()=>{setDraft(saved);setError('');}} className="rounded-xl border px-4 py-3 text-sm disabled:opacity-40">Hủy thay đổi</button><button disabled={!dirty || busy || profile && !draft.displayName.trim()} className="flex items-center gap-2 rounded-xl bg-indigo-600 text-white px-5 py-3 text-sm font-semibold disabled:opacity-40"><Save size={16}/>{busy ? 'Đang lưu...' : 'Lưu thay đổi'}</button></div></footer>
      </form> : <div className="space-y-6">
        <div className="pb-6 border-b border-slate-100"><h2 className="text-lg font-semibold">Tài khoản & quyền sử dụng</h2><dl className="mt-4 grid sm:grid-cols-2 gap-4 text-sm"><div><dt className="text-slate-500">Email đăng nhập</dt><dd className="mt-1 break-all font-medium">{user?.email}</dd></div><div><dt className="text-slate-500">Gói hiện tại</dt><dd className="mt-1 font-medium">{planName || 'Đang tải thông tin gói...'}</dd></div><div><dt className="text-slate-500">Credit khả dụng</dt><dd className="mt-1 font-medium">{(user?.credits?.total || 0).toLocaleString('vi-VN')} Credit</dd></div><div><dt className="text-slate-500">Ngày tham gia</dt><dd className="mt-1 font-medium">{user?.createdAt ? new Date(user.createdAt).toLocaleDateString('vi-VN', {timeZone:'Asia/Saigon'}) : 'Chưa có thông tin'}</dd></div></dl><Link to="/pricing" className="inline-block mt-4 text-sm font-semibold text-indigo-600">Xem gói & nâng cấp →</Link></div>
        
        {section.path === '/account/settings' && <DeveloperTokensPanel />}
        <BillingResult />
        <PaymentMethodsPanel />
        <TransactionHistory />
        <OwnedSubscriptions />

        <SubscriptionProgress period={user?.subscriptionPeriod} free={user?.plan === 'FREE'} />
        <div className="flex flex-wrap justify-between items-center gap-4"><div><h3 className="font-semibold">Hướng dẫn sử dụng</h3><p className="mt-1 text-sm text-slate-500">Xem lại các tính năng chính trong Workspace.</p></div><button onClick={()=>window.dispatchEvent(new Event(OPEN_WORKSPACE_TOUR))} className="flex items-center gap-2 border rounded-xl px-4 py-3 text-sm"><HelpCircle size={16}/>Mở hướng dẫn</button></div>
        <div className="flex flex-wrap gap-5 text-sm text-indigo-600"><Link to="/docs">Tài liệu sử dụng</Link><Link to="/chinh-sach-dieu-khoan">Chính sách & Điều khoản</Link></div>
        <div className="pt-6 border-t border-slate-100 flex flex-wrap justify-between gap-4 items-center"><div><h3 className="font-semibold">Phiên đăng nhập hiện tại</h3><p className="mt-1 text-sm text-slate-500">Đăng xuất khỏi trình duyệt đang sử dụng.</p></div><button disabled={busy} onClick={()=>void signOut()} className="flex gap-2 items-center rounded-xl bg-red-50 text-red-600 px-4 py-3 text-sm font-semibold"><LogOut size={16}/>Đăng xuất</button></div>
      </div>}
      

    </section>
  </div>;
}
