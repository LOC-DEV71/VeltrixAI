import viVN from 'antd/locale/vi_VN';
import { errorMessage } from './userMessages';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { adminRouteId, adminRoutes, adminPagePermissions, discardChangesDialog } from './adminRoutes';
import { App as AntApp, Alert, Button, Input, Spin, ConfigProvider } from 'antd';
import './App.css';
import { Plans } from './Plans';
import { AdminShell, adminPageName } from './AdminShell';
import { ArrowUpRight, History, LockKeyhole, ShieldCheck } from 'lucide-react';
import { UserManagement } from './UserManagement';
import { VoiceManagement } from './VoiceManagement';
import {BillingManagement} from './BillingManagement';

function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const { message } = AntApp.useApp();

  async function getCsrf() {
    const res = await fetch('/api/admin/auth/csrf');
    const data = await res.json();
    return decodeURIComponent(data.data?.csrfToken || '');
  }

  async function login() {
    setBusy(true);
    try {
      const csrf = await getCsrf();
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Thông tin đăng nhập không hợp lệ');

      message.success('Đăng nhập thành công');
      onLogin();
    } catch (e: any) {
      message.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return <div className="login-page"><aside className="login-story"><a className="brand" href="/login"><span className="brand-mark">V<span /></span><span className="brand-word">veltrix<span>ADMIN WORKSPACE</span></span></a><div className="login-story-body"><span className="banner-label">CREATOR PLATFORM</span><h2>Một nơi quản lý.<br />Mọi khả năng sáng tạo.</h2><p>Quản lý tài khoản, thiết kế quyền lợi và điều phối nền tảng Veltrix.</p><div className="login-feature"><ShieldCheck size={20} /><span>Quyền truy cập riêng cho quản trị viên</span></div><div className="login-feature"><History size={20} /><span>Thay đổi được ghi nhận theo phiên bản</span></div></div><span className="login-story-footer">Veltrix AI · Admin Workspace</span></aside><main className="login-form-area"><div className="login-form"><span className="login-lock"><LockKeyhole size={23} /></span><span className="eyebrow">CHÀO MỪNG TRỞ LẠI</span><h1>Đăng nhập quản trị</h1><p>Sử dụng tài khoản quản trị của bạn để tiếp tục.</p><form onSubmit={e => { e.preventDefault(); if (email && password && !busy) void login(); }}><label htmlFor="admin-email">Địa chỉ email</label><Input id="admin-email" type="email" autoComplete="username" placeholder="Email quản trị của bạn" value={email} onChange={e => setEmail(e.target.value)} required /><label htmlFor="admin-password">Mật khẩu</label><Input.Password id="admin-password" autoComplete="current-password" placeholder="Nhập mật khẩu" value={password} onChange={e => setPassword(e.target.value)} required /><Button type="primary" htmlType="submit" block loading={busy} disabled={!email || !password}>Đăng nhập <ArrowUpRight size={17} /></Button></form><div className="login-security"><ShieldCheck size={15} />Phiên đăng nhập dành riêng cho quản trị viên</div></div></main></div>;
}

import { EmptyState } from './components/EmptyState';
import { ControlCenter } from './ControlCenter';
import { canAdmin } from './controlApi';
function AdminApp() {
  const [user, setUser] = useState<any>(null), [loading, setLoading] = useState(true), [hasUnsaved, setHasUnsaved] = useState(false);
  const location = useLocation(), routeNavigate = useNavigate();
  const activeTab = adminRouteId(location.pathname);
  const { modal, message } = AntApp.useApp();
  const blocker = useBlocker(({ currentLocation, nextLocation }) => hasUnsaved && currentLocation.pathname !== nextLocation.pathname);
  const asking = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked' || asking.current) return;
    asking.current = true;
    void modal.confirm(discardChangesDialog).then(confirmed => {
      asking.current = false;
      if (confirmed) blocker.proceed(); else blocker.reset();
    }, () => { asking.current = false; blocker.reset(); });
  }, [blocker, modal]);
  async function loadUser() {
    try { const res = await fetch('/api/admin/auth/me', { credentials: 'include' }); const data = await res.json(); setUser(res.ok && data.success ? data.data : null); }
    catch { setUser(null); } finally { setLoading(false); }
  }
  useEffect(() => { void loadUser(); }, []);
  useEffect(() => { document.title = (location.pathname === '/login' ? 'Đăng nhập quản trị' : adminPageName(activeTab || '')) + ' · Veltrix Admin'; }, [location.pathname, activeTab]);
  if (loading) return <div className="auth-loading"><Spin size="large" /><p>Đang mở không gian quản trị…</p></div>;
  if (!user && location.pathname !== '/login') return <Navigate to="/login" replace state={{ returnTo: activeTab ? location.pathname + location.search : '/' }} />;
  if (!user) return <AdminLogin onLogin={() => void loadUser()} />;
  if (location.pathname === '/login') {
    const returnTo = location.state?.returnTo;
    const pathname = typeof returnTo === 'string' ? returnTo.split('?')[0] : '';
    return <Navigate to={adminRouteId(pathname) ? returnTo : '/'} replace />;
  }
  if (!activeTab) return <AdminShell user={user} active="" onNavigate={navigate} onLogout={() => void logout()}><EmptyState title="Không tìm thấy trang" description="Đường dẫn quản trị không tồn tại. Chọn một trang trong menu để tiếp tục." /></AdminShell>;
  function navigate(id: string) { const path = adminRoutes[id]; if (path && id !== activeTab) void routeNavigate(path); }
  async function logout() {
    if (hasUnsaved && !await modal.confirm({ ...discardChangesDialog, title: 'Hủy thay đổi và đăng xuất?', okText: 'Đăng xuất' })) return;
    try {
      const res = await fetch('/api/admin/auth/csrf'); const csrf = (await res.json()).data?.csrfToken || '';
      const response = await fetch('/api/admin/auth/logout', { method: 'POST', credentials: 'include', headers: { 'x-csrf-token': decodeURIComponent(csrf) } });
      if (!response.ok) throw new Error('REQUEST_FAILED');
      window.location.replace('/login');
    } catch (e) { message.error(errorMessage(e)); }
  }
  return <AdminShell user={user} active={activeTab} onNavigate={navigate} onLogout={() => void logout()}>{!canAdmin(user,adminPagePermissions[activeTab]) ? <Alert type="warning" showIcon title="Bạn chưa có quyền truy cập trang này" description="Liên hệ chủ hệ thống để được phân quyền phù hợp." /> : ['RECONCILIATION','OVERVIEW','JOBS','DEVELOPERS','CONTENT','AUDIT','ADMINS','SETTINGS'].includes(activeTab) ? <ControlCenter key={activeTab} kind={activeTab} user={user} onNavigate={navigate}/> : activeTab === 'PLANS' ? <Plans onDirtyChange={setHasUnsaved} canManage={!!canAdmin(user,'plans.manage') || !!canAdmin(user,'plans.update')} /> : activeTab === 'USERS' ? <UserManagement canManage={!!canAdmin(user,'users.manage')} /> : activeTab === 'VOICES' ? <VoiceManagement onDirtyChange={setHasUnsaved} navigationBlocked={blocker.state === 'blocked'} /> : ['ORDERS','PAYMENTS','CASHFLOW','CREDITS'].includes(activeTab) ? <BillingManagement key={activeTab} kind={activeTab}/> : <EmptyState title={adminPageName(activeTab)} description="Không tìm thấy trang quản trị." />}</AdminShell>;
}
export default function App() { return <ConfigProvider locale={viVN} theme={{ token: { colorPrimary: '#635bdb', colorInfo: '#635bdb', colorText: '#243046', colorTextSecondary: '#7c879b', colorBorder: '#e5e9f1', colorBgLayout: '#f6f7fb', fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif", borderRadius: 9, controlHeight: 40, fontSize: 13 }, components: { Table: { headerBg: '#fafbfe', headerColor: '#8390a4', rowHoverBg: '#f8f9ff', borderColor: '#edf0f5', cellPaddingBlock: 18 }, Card: { headerFontSize: 14, headerHeight: 58 }, Tabs: { horizontalItemGutter: 24 }, Button: { fontWeight: 600, primaryShadow: '0 3px 8px rgba(99,91,219,.16)' }, Drawer: { colorBgElevated: '#f8f9fc' } } }}><AntApp><AdminApp /></AntApp></ConfigProvider>; }

