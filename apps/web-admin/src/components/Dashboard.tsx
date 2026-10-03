import { useEffect, useState } from 'react';
import { Alert, Button, Skeleton } from 'antd';
import { ArrowRight, ArrowUpRight, Boxes, CheckCircle2, History, Mic, RefreshCw, Users } from 'lucide-react';
export function Dashboard({ onNavigate }: { onNavigate: (id: string) => void }) {
  const [plans, setPlans] = useState<any[]>([]), [totalUsers, setTotalUsers] = useState<number | null>(null), [history, setHistory] = useState<any[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try {
      const read = async (url: string) => { const res = await fetch(url, { credentials: 'include' }); const body = await res.json(); if (!res.ok) throw new Error('Không tải được dữ liệu tổng quan.'); return body.data; };
      const [catalogue, users] = await Promise.all([read('/api/admin/plans'), read('/api/admin/users?page=1&limit=1')]);
      setPlans(catalogue); setTotalUsers(users.total);
      const entries = await Promise.all(catalogue.map(async (plan: any) => (await read(`/api/admin/plans/${plan.tier}/history`)).map((entry: any) => ({ ...entry, name: plan.config.overview.name }))));
      setHistory(entries.flat().sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime()).slice(0, 5));
    } catch (e) { setError(e instanceof Error ? e.message : 'Không tải được dữ liệu.'); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const active = plans.filter(p => p.config.overview.active && !p.archived);
  const stats = [
    { label: 'Tổng người dùng', value: totalUsers, text: 'Tài khoản trong hệ thống', icon: Users, color: 'violet' },
    { label: 'Gói đang hoạt động', value: totalUsers !== null ? active.length : null, text: 'Đang nhận yêu cầu mới', icon: Boxes, color: 'blue' },
    { label: 'Gói hỗ trợ clone', value: totalUsers !== null ? active.filter(p => p.config.clone.enabled).length : null, text: 'Bật quyền nhân bản giọng', icon: Mic, color: 'orange' },
    { label: 'Gói đã cấu hình', value: totalUsers !== null ? plans.length : null, text: 'Có lịch sử phiên bản', icon: History, color: 'green' },
  ];
  return <div className="dashboard-page">
    <div className="page-heading"><div><span className="eyebrow">KHÔNG GIAN QUẢN TRỊ</span><h1>Tổng quan</h1><p>Theo dõi tài khoản, quản lý gói và các thay đổi gần đây.</p></div><Button icon={<RefreshCw size={16} />} loading={loading} onClick={() => void load()}>Làm mới</Button></div>
    {error && <Alert type="error" showIcon title={error} />}
    <div className="metric-grid">{stats.map(({ label, value, text, icon: Icon, color }) => <section className="metric-card" key={label}><div className="metric-top"><span>{label}</span><span className={`metric-icon ${color}`}><Icon size={18} /></span></div>{loading ? <Skeleton.Input active size="small" /> : <strong className="metric-value">{value?.toLocaleString('vi-VN') ?? '—'}</strong>}<p>{text}</p></section>)}</div>
    <section className="dashboard-banner"><div><span className="banner-label"><CheckCircle2 size={15} />CẤU HÌNH CÓ PHIÊN BẢN</span><h2>Quyền lợi phù hợp.<br />Trải nghiệm nhất quán.</h2><p>Kiểm soát tính năng, Credits và giới hạn cho từng gói trong một nơi.</p><Button type="primary" onClick={() => onNavigate('PLANS')}>Quản lý gói <ArrowRight size={16} /></Button></div><div className="banner-art" aria-hidden="true"><div className="art-card art-card-back"><span /><span /><span /></div><div className="art-card art-card-front"><span className="art-icon"><Boxes size={25} /></span><strong>Plan management</strong><div className="art-line" /><div className="art-line short" /><span className="art-check"><CheckCircle2 size={15} />Versioned configuration</span></div></div></section>
    <div className="dashboard-columns"><section className="surface"><div className="surface-heading"><div><h2>Danh mục gói</h2><p>Quyền lợi hiện đang được áp dụng</p></div><button className="text-action" onClick={() => onNavigate('PLANS')}>Xem tất cả <ArrowUpRight size={16} /></button></div>{loading ? <Skeleton active /> : !plans.length ? <p className="empty-copy">Chưa có dữ liệu gói.</p> : <div className="plan-overview-list">{plans.map(plan => <button key={plan.tier} className="plan-overview-row" onClick={() => onNavigate('PLANS')}><span className={`plan-monogram tier-${plan.tier.toLowerCase()}`}>{plan.config.overview.name.charAt(0)}</span><span className="plan-overview-name"><strong>{plan.config.overview.name}</strong><span>Phiên bản {plan.revision} · {plan.config.overview.active && !plan.archived ? 'Hoạt động' : 'Tạm ngưng'}</span></span><span className="plan-overview-credit"><strong>{plan.config.credits.monthlyGrant.toLocaleString('vi-VN')}</strong><span>Credit / tháng</span></span><ArrowRight size={16} className="muted-icon" /></button>)}</div>}</section>
    <section className="surface"><div className="surface-heading"><div><h2>Thay đổi gần đây</h2><p>Lịch sử cập nhật cấu hình gói</p></div><History size={18} className="muted-icon" /></div>{loading ? <Skeleton active /> : !history.length ? <p className="empty-copy">Chưa có thay đổi được ghi nhận.</p> : <div className="activity-list">{history.map(entry => <div className="activity-row" key={`${entry.planId}-${entry.revision}`}><span className="activity-dot" /><div><strong>{entry.name} <span>· v{entry.revision}</span></strong><p>{entry.reason}</p><time>{new Date(entry.changedAt).toLocaleString('vi-VN')}</time></div></div>)}</div>}</section></div>
  </div>;
}
