import {AdminBillingBell} from './AdminBillingBell';
import {AdminSecurityBell} from './AdminSecurityBell';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { adminRoutes, adminPagePermissions } from './adminRoutes';
import { canAdmin } from './controlApi';
import { Button, Tooltip } from 'antd';
import { ArrowUpRight, Boxes, ChevronRight, Code2, CreditCard, FileText, History, LayoutDashboard, LogOut, Menu, Mic, Search, Settings, ShieldCheck, Users, Wallet, X } from 'lucide-react';
import './AdminShell.css';
const groups = [
  { title: 'Không gian quản trị', items: [
    { id: 'OVERVIEW', label: 'Tổng quan', icon: LayoutDashboard },
    { id: 'USERS', label: 'Người dùng', icon: Users },
    { id: 'PLANS', label: 'Gói & quyền lợi', icon: Boxes },
  ] },
  { title: 'Vận hành', items: [
    { id: 'VOICES', label: 'Thư viện giọng', icon: Mic },
    { id: 'CONTENT', label: 'Nội dung AI', icon: FileText },
    { id: 'DEVELOPERS', label: 'Developer API', icon: Code2 },
    { id: 'JOBS', label: 'Tác vụ', icon: History },
    { id: 'CREDITS', label: 'Giao dịch Credit', icon: Wallet },
    { id: 'ORDERS', label: 'Quản lý đơn hàng', icon: Boxes },
    { id: 'CASHFLOW', label: 'Quản lý dòng tiền', icon: ArrowUpRight },
    { id: 'RECONCILIATION', label: 'Đối soát bất thường', icon: ShieldCheck },
    { id: 'PAYMENTS', label: 'Thanh toán', icon: CreditCard },
  ] },
  { title: 'Hệ thống', items: [
    { id: 'ADMINS', label: 'Quản trị viên', icon: ShieldCheck },
    { id: 'AUDIT', label: 'Nhật ký hệ thống', icon: History },
    { id: 'SETTINGS', label: 'Cài đặt', icon: Settings },
  ] },
];
export const adminPageName = (id: string) => groups.flatMap(g => g.items).find(item => item.id === id)?.label || 'Quản trị';
export function AdminShell({ user, active, onNavigate, onLogout, children }: {
  user: { email: string; displayName?: string; roleId?: any; permissions?: string[] }; active: string; onNavigate: (id: string) => void; onLogout: () => void; children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [year] = useState(() => new Date().getFullYear());
  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen]);
  const navigate = (id: string) => { onNavigate(id); setMobileOpen(false); };
  return <div className={`admin-shell ${active === 'PLANS' ? 'plans-shell' : ''}`}>
    {mobileOpen && <button className="nav-backdrop" aria-label="Đóng menu" onClick={() => setMobileOpen(false)} />}
    <aside id="admin-navigation-sidebar" className={`admin-sidebar ${mobileOpen ? 'is-open' : ''}`}>
      <a className="brand" href="/" onClick={e => { e.preventDefault(); navigate('OVERVIEW'); }}><span className="brand-mark brand-logo"><img src="/logo-icon.png" alt="" /></span><span className="brand-word">Veltrix AI<span>ADMIN CORE</span></span></a>
      <button className="mobile-nav-close icon-button" aria-label="Đóng menu" onClick={() => setMobileOpen(false)}><X size={18} /></button>
      <nav aria-label="Menu quản trị">{groups.map(group => ({ ...group, items: group.items.filter(item => canAdmin(user, adminPagePermissions[item.id])) })).filter(group => group.items.length > 0).map(group => <div className="nav-group" key={group.title}><p>{group.title}</p>{group.items.map(item => {
        const Icon = item.icon; const pending = 'pending' in item && item.pending === true;
        return <a key={item.id} href={adminRoutes[item.id]} className={`nav-item ${active === item.id ? 'active' : ''}`} aria-current={active === item.id ? 'page' : undefined} onClick={e => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); navigate(item.id); }}><Icon size={18} /><span>{item.label}</span>{pending && <span className="nav-soon">Sắp có</span>}{active === item.id && <ChevronRight size={15} />}</a>;
      })}</div>)}</nav>
      <div className="sidebar-bottom"><div className="access-note"><ShieldCheck size={17} /><div><strong>Quyền truy cập quản trị</strong><span>Mọi thay đổi đều được ghi nhận</span></div></div><a href="http://localhost:5173/" target="_blank" rel="noreferrer">Mở ứng dụng Creator <ArrowUpRight size={15} /></a></div>
    </aside>
    <div className="admin-main">
      <header className="admin-header"><div className="header-location"><button className="mobile-menu icon-button" onClick={() => setMobileOpen(true)} aria-label="Mở menu" aria-expanded={mobileOpen} aria-controls="admin-navigation-sidebar"><Menu size={20} /></button><span>{active === 'PLANS' ? 'Quản lý dịch vụ' : 'Workspace'}</span><ChevronRight size={14} /><strong>{adminPageName(active)}</strong></div><div className="header-account">{active === 'PLANS' && <Button className="plan-header-search" icon={<Search size={16} />} onClick={() => { const input = document.querySelector<HTMLInputElement>('input[aria-label="Tìm gói"]'); input?.scrollIntoView({ block: 'center', behavior: 'smooth' }); input?.focus(); }}>Tìm gói dịch vụ...</Button>}{canAdmin(user,'users.read')&&<AdminSecurityBell accountKey={user.email}/>}{canAdmin(user,'billing.read')&&<AdminBillingBell onOrders={()=>navigate('ORDERS')}/>}<span className="admin-access"><ShieldCheck size={14} />Quản trị</span><div className="account-copy"><strong>{user.displayName || 'Administrator'}</strong><span>{user.email}</span></div><span className="account-avatar">{(user.displayName || user.email).charAt(0).toUpperCase()}</span><Tooltip title="Đăng xuất"><Button type="text" className="logout-button" aria-label="Đăng xuất" icon={<LogOut size={17} />} onClick={onLogout} /></Tooltip></div></header>
      <main className="admin-content">{children}</main>
      <footer className="admin-footer"><span>© {year} Veltrix · Admin Workspace</span><span>Quản lý rõ ràng. Sáng tạo tự do.</span></footer>
    </div>
  </div>;
}


