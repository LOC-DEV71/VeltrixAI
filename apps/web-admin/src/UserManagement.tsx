import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Checkbox, ConfigProvider, Drawer, Empty, Form, Input, InputNumber, Modal, Pagination, Segmented, Select, Skeleton, Table, Tooltip, Typography } from 'antd';
import { ArrowRight, CalendarDays, Check, Coins, Gift, Hourglass, Info, LockKeyhole, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, UnlockKeyhole, UserCheck, Users, UserX, Wallet } from 'lucide-react';
import { errorMessage } from './userMessages';
import './UserManagement.css';

const PAGE_SIZE = 10;
const PLAN_NAMES: Record<string, string> = { FREE: 'Free', BASIC_STUDENT: 'Basic Student', PLUS: 'Plus Creator', PRO: 'Pro' };
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('vi-VN') : '—';
const date = (value?: string, time = false) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Saigon', day: '2-digit', month: '2-digit', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }) : 'Không có';
const dateInput = (value?: string) => new Date(value && Number.isFinite(Date.parse(value)) ? value : Date.now()).toLocaleDateString('en-CA', { timeZone: 'Asia/Saigon' });
const planName = (value: string) => PLAN_NAMES[value] || value || 'Free';
type UserRow = { _id: string; email: string; displayName?: string; status: string; plan: string; createdAt?: string; controlRevision?: number; planPeriod?: { billingCycle: string; startsAt: string; endsAt: string } };
type WalletData = { _id: string; bucket: string; available: number; reserved: number };
type Details = { user: UserRow; wallets: WalletData[]; subscriptions: any[]; subscriptionsMeta?: { page: number; total: number }; recentJobs: any[] };
type Action = 'GRANT' | 'PLAN' | 'STATUS';

async function api(path: string, body?: unknown, method = 'GET', key?: string, signal?: AbortSignal) {
  let csrf = '';
  if (method !== 'GET') {
    const response = await fetch('/api/admin/auth/csrf', { credentials: 'include' });
    const result = await response.json();
    csrf = result.data?.csrfToken || '';
    if (!response.ok || !csrf) throw new Error('CSRF_UNAVAILABLE');
  }
  const response = await fetch('/api/admin/users' + path, {
    method, signal, credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}), ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(errorMessage({ code: result.error?.code }, response.status));
  return result.data;
}

function UserIdentity({ user, compact = false }: { user: UserRow; compact?: boolean }) {
  return <div className={`um-identity${compact ? ' compact' : ''}`}>
    <span className="um-avatar" aria-hidden="true">{(user.displayName || user.email || '?').slice(0, 1).toUpperCase()}</span>
    <div><strong>{user.displayName || 'Khách hàng'}</strong><span>{user.email || 'Chưa có email'}</span></div>
  </div>;
}
function PlanBadge({ tier }: { tier: string }) { return <span className={`um-badge plan-${(tier || 'FREE').toLowerCase()}`}>{planName(tier)}</span>; }
function UserStatus({ status }: { status: string }) { return <span className={`um-badge status-${status.toLowerCase()}`}><i />{status === 'ACTIVE' ? 'Hoạt động' : status === 'BANNED' ? 'Bị khóa' : status}</span>; }
function LoadingRows() { return <div className="um-loading" role="status" aria-label="Đang tải danh sách người dùng">{[1, 2, 3, 4].map(key => <Skeleton key={key} active avatar title={false} paragraph={{ rows: 2, width: ['35%', '75%'] }} />)}</div>; }

export function UserManagement({ canManage = true }: { canManage?: boolean }) {
  const { message } = App.useApp();
  const [users, setUsers] = useState<UserRow[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1);
  const [search, setSearch] = useState(''), [status, setStatus] = useState('ALL'), [loading, setLoading] = useState(true), [listError, setListError] = useState(''), [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<string | null>(null), [details, setDetails] = useState<Details | null>(null), [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState('');
  const [action, setAction] = useState<Action | null>(null), [busy, setBusy] = useState(false), [actionError, setActionError] = useState(''), [dirty, setDirty] = useState(false), [discarding, setDiscarding] = useState(false);
  const [tier, setTier] = useState('FREE'), [billingCycle, setBillingCycle] = useState('NONE'), [startsAt, setStartsAt] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [grantForm] = Form.useForm(), [statusForm] = Form.useForm();
  const amount = Form.useWatch('amount', grantForm);
  const grantKey = useRef(''), sending = useRef(false), detailRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setListError('');
      try {
        const data = await api(`?page=${page}&limit=${PAGE_SIZE}&search=${encodeURIComponent(search.trim())}${status === 'ALL' ? '' : '&status=' + status}`, undefined, 'GET', undefined, controller.signal);
        if (!controller.signal.aborted) {
          setUsers(data.users || []); setTotal(data.total || 0);
          const lastPage = Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE));
          if (page > lastPage) setPage(lastPage);
        }
      } catch (e) { if (!controller.signal.aborted) setListError(errorMessage(e)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, search ? 300 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [page, search, status, reload]);
  useEffect(() => () => detailRequest.current?.abort(), []);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [dirty]);

  const loadDetails = useCallback(async (id: string, subscriptionPage = 1) => {
    detailRequest.current?.abort();
    const controller = new AbortController(); detailRequest.current = controller;
    setDetailLoading(true); setDetailError('');
    try {
      const data = await api(`/${id}?page=${subscriptionPage}&limit=${PAGE_SIZE}`, undefined, 'GET', undefined, controller.signal);
      if (!controller.signal.aborted) setDetails(data);
    } catch (e) { if (!controller.signal.aborted) setDetailError(errorMessage(e)); }
    finally { if (!controller.signal.aborted) setDetailLoading(false); }
  }, []);
  function openUser(id: string) { setDetails(null); setSelected(id); void loadDetails(id); }
  function closeUser() { detailRequest.current?.abort(); setSelected(null); setDetails(null); }
  function openAction(next: Action, targetTier?: string) {
    if (!canManage || !details || detailLoading) return;
    setActionError(''); setDirty(false); setDiscarding(false); setConfirmed(false);
    if (next === 'GRANT') { grantKey.current = crypto.randomUUID(); grantForm.resetFields(); }
    if (next === 'STATUS') statusForm.resetFields();
    if (next === 'PLAN') {
      const value = targetTier || details.user.plan || 'FREE';
      setTier(value); setBillingCycle(value === 'FREE' ? 'NONE' : details.user.planPeriod?.billingCycle || 'NONE');
      setStartsAt(dateInput(details.user.planPeriod?.startsAt));
    }
    setAction(next);
  }
  function closeAction(force = false) {
    if (busy) return;
    if (dirty && !force) { setDiscarding(true); return; }
    setAction(null); setDirty(false); setDiscarding(false); setActionError('');
  }
  async function mutate(body: unknown, suffix: string, method: string, key?: string) {
    if (!selected || !canManage || sending.current) return;
    sending.current = true; setBusy(true); setActionError('');
    try {
      await api(`/${selected}/${suffix}`, body, method, key);
      message.success(suffix === 'credits' ? 'Đã cộng Credit vào tài khoản.' : suffix === 'plan' ? 'Đã cập nhật gói và thời hạn.' : 'Đã cập nhật trạng thái tài khoản.');
      setAction(null); setDirty(false); setDiscarding(false); setReload(value => value + 1);
      void loadDetails(selected, details?.subscriptionsMeta?.page || 1);
    } catch (e) { setActionError(errorMessage(e)); }
    finally { sending.current = false; setBusy(false); }
  }
  function savePlan() {
    if (!confirmed || (tier !== 'FREE' && billingCycle !== 'NONE' && !startsAt)) return;
    void mutate({ tier, planPeriod: tier === 'FREE' || billingCycle === 'NONE' ? null : { billingCycle, startsAt } }, 'plan', 'PUT');
  }
  function expectedEnd() {
    if (tier === 'FREE' || billingCycle === 'NONE') return 'Không có thời hạn';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startsAt)) return 'Chọn ngày bắt đầu';
    const [year, month, day] = startsAt.split('-').map(Number);
    const target = new Date(Date.UTC(year, month - 1 + (billingCycle === 'YEARLY' ? 12 : 1), 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, last));
    return target.toLocaleDateString('vi-VN', { timeZone: 'UTC' });
  }

  const wallets = details?.wallets || [];
  const available = wallets.reduce((sum, wallet) => sum + (Number.isFinite(wallet.available) ? wallet.available : 0), 0);
  const reserved = wallets.reduce((sum, wallet) => sum + (Number.isFinite(wallet.reserved) ? wallet.reserved : 0), 0);
  const grantTotal = Number.isSafeInteger(amount) && amount > 0 && Number.isSafeInteger(available + amount) ? available + amount : undefined;
  const kpis = [
    { label: 'Tổng tài khoản phù hợp', value: total, note: 'Theo tìm kiếm và bộ lọc hiện tại', icon: Users, tone: 'primary' },
    { label: 'Bị khóa trên trang này', value: users.filter(user => user.status === 'BANNED').length, note: 'Trong 10 dòng của trang đang xem', icon: UserX, tone: 'danger' },
    { label: 'Plus / Pro trên trang này', value: users.filter(user => ['PLUS', 'PRO'].includes(user.plan)).length, note: 'Trong 10 dòng của trang đang xem', icon: Sparkles, tone: 'info' },
    { label: 'Free trên trang này', value: users.filter(user => user.plan === 'FREE').length, note: 'Trong 10 dòng của trang đang xem', icon: UserCheck, tone: 'neutral' },
  ];
  const columns = [
    { title: 'STT', width: 60, render: (_: unknown, __: UserRow, index: number) => <span className="um-row-number">{String((page - 1) * PAGE_SIZE + index + 1).padStart(2, '0')}</span> },
    { title: 'Người dùng', width: 290, render: (_: unknown, user: UserRow) => <UserIdentity user={user} /> },
    { title: 'Tên đăng nhập', width: 170, render: (_: unknown, user: UserRow) => <Tooltip title={user.email}><span className="um-username">@{(user.email || '').split('@')[0] || '—'}</span></Tooltip> },
    { title: 'Gói hiện tại', dataIndex: 'plan', width: 160, render: (value: string) => <PlanBadge tier={value} /> },
    { title: 'Trạng thái', dataIndex: 'status', width: 145, render: (value: string) => <UserStatus status={value} /> },
    { title: 'Thao tác', width: 126, render: (_: unknown, user: UserRow) => <Button className="um-manage" icon={<SlidersHorizontal size={15} />} onClick={() => openUser(user._id)}>{canManage ? 'Quản lý' : 'Chi tiết'}</Button> },
  ];
  const modalTitle = action === 'GRANT' ? 'Tặng Credit' : action === 'PLAN' ? 'Cập nhật gói & thời hạn' : details?.user.status === 'ACTIVE' ? 'Khóa tài khoản' : 'Mở khóa tài khoản';

  return <ConfigProvider theme={{ token: { colorPrimary: '#4F46E5', colorText: '#172033', colorTextSecondary: '#777587', colorBorder: '#E8EBF2', borderRadius: 12, fontFamily: '"Be Vietnam Pro", sans-serif', controlHeight: 42 } }}>
    <div className="users-stitch">
      <header className="um-page-heading"><div><span>QUẢN LÝ TÀI KHOẢN</span><h1>Người dùng</h1><p>Tra cứu tài khoản, quyền truy cập và lịch sử sử dụng.</p></div><Button disabled={loading} icon={<RefreshCw size={16} />} onClick={() => setReload(value => value + 1)}>Làm mới</Button></header>
      <div className="um-stats">{kpis.map(kpi => <section className={`um-stat ${kpi.tone}`} key={kpi.label}><div><span>{kpi.label}</span><small>{kpi.note}</small></div><span className="um-stat-icon"><kpi.icon size={22} /></span><div className="um-stat-value">{loading ? <Skeleton.Input active size="small" /> : <><strong>{listError ? '—' : number(kpi.value)}</strong><span>tài khoản</span></>}</div></section>)}</div>
      <section className="um-list" aria-label="Danh sách người dùng">
        <div className="um-toolbar"><Input aria-label="Tìm người dùng" prefix={<Search size={18} />} placeholder="Tìm email hoặc tên người dùng..." allowClear value={search} onChange={event => { setSearch(event.target.value); setPage(1); setLoading(true); }} /><div className="um-filter" aria-label="Lọc trạng thái">{[{ value: 'ALL', label: 'Tất cả' }, { value: 'ACTIVE', label: 'Hoạt động' }, { value: 'BANNED', label: 'Bị khóa' }].map(option => <button key={option.value} aria-pressed={status === option.value} className={status === option.value ? 'selected' : ''} onClick={() => { setStatus(option.value); setPage(1); setLoading(true); }}>{option.label}</button>)}</div></div>
        {listError ? <div className="um-error"><Alert showIcon type="error" title="Không thể tải người dùng" description={listError} action={<Button onClick={() => setReload(value => value + 1)}>Thử lại</Button>} /></div> : loading ? <LoadingRows /> : <Table<UserRow> rowKey="_id" columns={columns} dataSource={users} pagination={false} scroll={{ x: 960 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><strong>Không tìm thấy tài khoản</strong><p>Thử một email khác hoặc xóa bộ lọc hiện tại.</p><Button onClick={() => { setSearch(''); setStatus('ALL'); setPage(1); }}>Xóa bộ lọc</Button></>} /> }} />}
        <div className="um-list-footer"><span>{loading ? 'Đang tải dữ liệu...' : listError ? 'Dữ liệu chưa tải được' : <>Hiển thị <strong>{total ? (page - 1) * PAGE_SIZE + 1 : 0} – {Math.min(page * PAGE_SIZE, total)}</strong> trong tổng số <strong>{number(total)}</strong> tài khoản</>}</span><Pagination current={page} total={total} pageSize={PAGE_SIZE} showSizeChanger={false} disabled={loading || !!listError} onChange={value => { setPage(value); setLoading(true); }} /></div>
      </section>
      {!action && <Drawer className="stitch-user-drawer" placement="right" size={920} title={<div className="um-drawer-title"><Users size={21} /><strong>Chi tiết người dùng</strong></div>} open={!!selected} onClose={closeUser} footer={<div className="um-drawer-footer"><span><ShieldCheck size={16} />{canManage ? 'Thao tác quản trị được ghi vào nhật ký hệ thống' : 'Bạn đang xem với quyền chỉ đọc'}</span><Button onClick={closeUser}>Đóng</Button></div>}>
        {detailLoading ? <div className="um-detail-loading" role="status" aria-label="Đang tải chi tiết người dùng"><Skeleton active avatar paragraph={{ rows: 3 }} /><Skeleton active paragraph={{ rows: 5 }} /><Skeleton active paragraph={{ rows: 5 }} /></div> : detailError ? <div className="um-error"><Alert type="error" showIcon title="Không thể tải chi tiết tài khoản" description={detailError} action={<Button onClick={() => selected && void loadDetails(selected)}>Thử lại</Button>} /></div> : details && <>
          <div className="um-user-header"><div className="um-user-profile"><UserIdentity user={details.user} /><div className="um-user-badges"><UserStatus status={details.user.status} /><PlanBadge tier={details.user.plan} /></div></div><div className="um-user-id"><Typography.Text copyable={{ text: details.user._id, tooltips: ['Sao chép ID', 'Đã sao chép'] }}>ID: {details.user._id}</Typography.Text><span>Tham gia {date(details.user.createdAt)}</span></div>{canManage && <div className="um-access"><ShieldCheck size={19} /><p>{details.user.status === 'ACTIVE' ? 'Khóa quyền truy cập của tài khoản, giữ lại dữ liệu và lịch sử.' : 'Tài khoản đang bị khóa. Mở khóa để khôi phục quyền truy cập.'}</p><Button danger={details.user.status === 'ACTIVE'} icon={details.user.status === 'ACTIVE' ? <LockKeyhole size={15} /> : <UnlockKeyhole size={15} />} onClick={() => openAction('STATUS')}>{details.user.status === 'ACTIVE' ? 'Khóa tài khoản' : 'Mở khóa'}</Button></div>}</div>
          <div className="um-detail-content">
            <section className="um-detail-section"><div className="um-section-heading"><h2><i />Số dư Credit</h2>{canManage && <Button type="primary" icon={<Gift size={16} />} onClick={() => openAction('GRANT')}>Tặng Credit</Button>}</div><div className="um-wallets"><div className="um-wallet"><header>CREDIT KHẢ DỤNG<Wallet size={18} /></header><strong>{number(available)} <small>Credit</small></strong><div className="um-wallet-breakdown">{wallets.length ? wallets.map(wallet => <span key={wallet._id}>{wallet.bucket === 'FREE' ? 'Được cấp theo gói' : wallet.bucket === 'PAID' ? 'Mua / quản trị viên tặng' : wallet.bucket}: <b>{number(wallet.available)}</b></span>) : <span>Tài khoản chưa có ví Credit.</span>}</div></div><div className="um-wallet pending"><header>CREDIT TẠM GIỮ<Hourglass size={18} /></header><strong>{number(reserved)} <small>Credit</small></strong><p><Info size={15} />Dành cho các tác vụ đang xử lý, chưa quyết toán.</p></div></div><p className="um-caption">Khả dụng: dùng được ngay. Tạm giữ: sẽ được trừ hoặc hoàn lại khi tác vụ kết thúc.</p></section>
            <section className="um-detail-section"><div className="um-section-heading"><h2><i />Gói & thời hạn sử dụng</h2>{canManage && <Button icon={<SlidersHorizontal size={16} />} onClick={() => openAction('PLAN')}>Cập nhật gói</Button>}</div><p className="um-caption">Tài khoản có thể sở hữu nhiều gói còn hạn. Nhãn “Đang dùng” thể hiện quyền lợi được chọn hiện tại.</p><Table size="small" rowKey="_id" dataSource={details.subscriptions || []} scroll={{ x: 750 }} pagination={{ current: details.subscriptionsMeta?.page || 1, total: details.subscriptionsMeta?.total || details.subscriptions?.length || 0, pageSize: PAGE_SIZE, showSizeChanger: false, hideOnSinglePage: true, onChange: value => selected && void loadDetails(selected, value) }} locale={{ emptyText: 'Chưa có lịch sử gói được cấp hoặc mua.' }} columns={[
              { title: 'Gói', dataIndex: 'tier', width: 145, render: (value: string) => <PlanBadge tier={value} /> },
              { title: 'Trạng thái', dataIndex: 'status', width: 140, render: (value: string, row: any) => <div className="um-sub-status"><span className={`um-badge term-${value.toLowerCase()}`}>{value === 'ACTIVE' ? 'Còn hạn' : value === 'EXPIRED' ? 'Hết hạn' : 'Chưa bắt đầu'}</span>{(row.selected || row.provider === 'ADMIN' && row.tier === details.user.plan) && <span className="um-selected"><Check size={12} />Đang dùng</span>}</div> },
              { title: 'Nguồn kích hoạt', dataIndex: 'provider', width: 155, render: (value: string) => value === 'VNPAY' ? 'Thanh toán VNPay' : value === 'ADMIN' ? 'Quản trị viên cấp' : value },
              { title: 'Chu kỳ', dataIndex: 'billingCycle', width: 95, render: (value: string) => value === 'YEARLY' ? '12 tháng' : value === 'MONTHLY' ? '1 tháng' : 'Không thời hạn' },
              { title: 'Ngày bắt đầu', dataIndex: 'startsAt', width: 110, render: (value: string) => date(value) },
              { title: 'Hết hạn', dataIndex: 'endsAt', width: 110, render: (value: string) => date(value) },
            ]} />{canManage && <div className="um-plan-picker"><h3>Điều chỉnh gói do quản trị viên cấp</h3><p>Chọn gói để xem và xác nhận thời hạn trước khi lưu.</p><div>{Object.entries(PLAN_NAMES).map(([value, label]) => <button key={value} className={details.user.plan === value ? 'current' : ''} onClick={() => openAction('PLAN', value)}><strong>{label}</strong><small>{value.replaceAll('_', ' ')}</small>{details.user.plan === value && <span><Check size={12} />Hiện tại</span>}</button>)}</div></div>}</section>
            <section className="um-detail-section"><div className="um-section-heading"><h2><i />Tác vụ gần đây</h2><span>Tối đa 10 tác vụ mới nhất</span></div><Table size="small" rowKey="_id" dataSource={details.recentJobs || []} pagination={false} scroll={{ x: 650 }} locale={{ emptyText: 'Chưa có tác vụ AI hoặc giọng nói.' }} columns={[
              { title: 'Loại tác vụ', dataIndex: 'type', render: (value: string) => value || '—' },
              { title: 'Trạng thái', dataIndex: 'status', render: (value: string) => <span className={`um-badge job-${value?.toLowerCase()}`}>{({ SUCCEEDED: 'Hoàn tất', COMPLETED: 'Hoàn tất', FAILED: 'Thất bại', RUNNING: 'Đang xử lý', QUEUED: 'Đang chờ', CANCELLED: 'Đã hủy' } as Record<string, string>)[value] || value || '—'}</span> },
              { title: 'Credit dự kiến', dataIndex: ['payload', 'cost'], render: (value: number) => number(value) },
              { title: 'Ngày tạo', dataIndex: 'createdAt', render: (value: string) => date(value, true) },
            ]} /></section>
          </div>
        </>}
      </Drawer>}
      <Modal className="stitch-user-modal" open={!!action} width={action === 'PLAN' ? 700 : 600} centered title={<span className="um-modal-title">{action === 'GRANT' ? <Gift size={22} /> : action === 'PLAN' ? <Sparkles size={22} /> : <ShieldCheck size={22} />}{modalTitle}</span>} footer={null} maskClosable={false} keyboard={!busy} closable={!busy} onCancel={() => closeAction()}>
        {discarding ? <div className="um-discard"><h3>Hủy các thay đổi chưa lưu?</h3><p>Nội dung đang nhập sẽ bị xóa. Tài khoản chưa được cập nhật.</p><div className="um-modal-footer"><Button onClick={() => setDiscarding(false)}>Tiếp tục chỉnh sửa</Button><Button danger onClick={() => closeAction(true)}>Hủy thay đổi</Button></div></div> : details && <>
          <p className="um-modal-description">{action === 'GRANT' ? 'Cấp thêm Credit cho tài khoản. Số dư chỉ thay đổi sau khi hệ thống xác nhận.' : action === 'PLAN' ? 'Điều chỉnh quyền sử dụng và thời hạn của tài khoản.' : 'Xác nhận thay đổi quyền truy cập và ghi rõ lý do.'}</p>
          <div className="um-modal-user"><UserIdentity user={details.user} compact /><div><small>MÃ TÀI KHOẢN</small><Typography.Text copyable={{ text: details.user._id }}>{details.user._id}</Typography.Text></div></div>
          {actionError && <Alert className="um-action-error" showIcon type="error" title="Chưa cập nhật được tài khoản" description={actionError} action={<Button disabled={busy} size="small" onClick={() => { closeAction(true); if (selected) void loadDetails(selected); }}>Tải lại tài khoản</Button>} />}
          {action === 'GRANT' && <Form form={grantForm} layout="vertical" onValuesChange={() => setDirty(true)} onFinish={values => void mutate({ amount: values.amount, reason: values.reason.trim() }, 'credits', 'POST', grantKey.current)} disabled={busy}>
            <Form.Item name="amount" label="Số lượng Credit tặng" rules={[{ required: true, message: 'Nhập số Credit cần tặng.' }, { validator: (_, value) => Number.isSafeInteger(value) && value > 0 && Number.isSafeInteger(available + value) ? Promise.resolve() : Promise.reject(new Error('Nhập số nguyên dương hợp lệ.')) }]}><InputNumber aria-label="Số lượng Credit tặng" className="um-grant-amount" min={1} max={Number.MAX_SAFE_INTEGER - available} precision={0} controls={false} suffix="CREDIT" formatter={value => String(value ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')} parser={value => Number((value || '').replace(/\./g, ''))} /></Form.Item>
            <div className="um-presets"><span>Gợi ý:</span>{[1000, 5000, 10000, 20000].map(value => <button type="button" disabled={busy} className={amount === value ? 'selected' : ''} key={value} onClick={() => { grantForm.setFieldValue('amount', value); setDirty(true); }}>+{number(value)}</button>)}</div>
            <div className="um-preview"><header><Coins size={16} />SỐ DƯ KHẢ DỤNG DỰ KIẾN</header><div><span>{number(available)} <small>Credit hiện tại</small></span><ArrowRight size={20} /><strong>{number(grantTotal)} <small>Credit sau khi cộng</small></strong></div><p>Credit được cộng vào ví mua / quản trị viên tặng, không tự đặt hạn dùng.</p></div>
            <Form.Item name="reason" label="Lý do cập nhật (ghi vào nhật ký)" rules={[{ required: true, message: 'Nhập lý do cấp Credit.' }, { validator: (_, value) => typeof value === 'string' && value.trim().length >= 5 ? Promise.resolve() : Promise.reject(new Error('Lý do cần ít nhất 5 ký tự.')) }]}><Input.TextArea aria-label="Lý do tặng Credit" rows={3} maxLength={1000} showCount placeholder="Ví dụ: Bồi hoàn tác vụ lỗi theo yêu cầu hỗ trợ..." /></Form.Item><div className="um-modal-footer"><span><ShieldCheck size={16} />Thao tác được ghi vào Audit Log</span><Button disabled={busy} onClick={() => closeAction()}>Hủy</Button><Button type="primary" htmlType="submit" disabled={busy} icon={<Check size={16} />}>{busy ? 'Đang cấp Credit...' : 'Cập nhật Credit'}</Button></div>
          </Form>}
          {action === 'PLAN' && <div className="um-plan-form"><h3>Phân hạng gói cước</h3><div className="um-plan-comparison"><div><small>GÓI HIỆN TẠI</small><strong>{planName(details.user.plan)}</strong><span>{details.user.planPeriod?.billingCycle === 'YEARLY' ? 'Theo năm' : details.user.planPeriod?.billingCycle === 'MONTHLY' ? 'Theo tháng' : 'Không có thời hạn'}</span></div><ArrowRight size={22} /><div><label htmlFor="um-target-plan">GÓI SẮP ÁP DỤNG</label><Select id="um-target-plan" aria-label="Gói sắp áp dụng" value={tier} disabled={busy} options={Object.entries(PLAN_NAMES).map(([value, label]) => ({ value, label }))} onChange={value => { setTier(value); if (value === 'FREE') setBillingCycle('NONE'); setConfirmed(false); setDirty(true); }} /></div></div>
            <div className="um-period-fields"><div><label>Chu kỳ sử dụng</label><Segmented aria-label="Chu kỳ sử dụng" block value={billingCycle} disabled={busy || tier === 'FREE'} options={[{ label: 'Không hạn', value: 'NONE' }, { label: 'Theo tháng', value: 'MONTHLY' }, { label: 'Theo năm', value: 'YEARLY' }]} onChange={value => { setBillingCycle(String(value)); setConfirmed(false); setDirty(true); }} /></div><div><div className="um-date-label"><label htmlFor="um-plan-start">Ngày bắt đầu (giờ Việt Nam)</label><button type="button" disabled={busy || billingCycle === 'NONE' || tier === 'FREE'} onClick={() => { setStartsAt(dateInput()); setConfirmed(false); setDirty(true); }}>Hôm nay</button></div><Input id="um-plan-start" aria-label="Ngày bắt đầu" type="date" prefix={<CalendarDays size={16} />} value={startsAt} disabled={busy || billingCycle === 'NONE' || tier === 'FREE'} onChange={event => { setStartsAt(event.target.value); setConfirmed(false); setDirty(true); }} /></div></div>
            <div className="um-preview"><header><CalendarDays size={16} />TÓM TẮT THAY ĐỔI</header><dl><div><dt>Quyền lợi đang áp dụng</dt><dd>{planName(details.user.plan)} → {planName(tier)}</dd></div><div><dt>Ngày hết hạn hiện tại</dt><dd>{date(details.user.planPeriod?.endsAt)}</dd></div><div><dt>Ngày hết hạn dự kiến</dt><dd>{expectedEnd()}</dd></div></dl><p><Info size={15} />Thao tác cấp gói thủ công không tạo đơn thanh toán, cộng Credit, hoàn tiền hoặc tự gia hạn. Các đơn đã mua vẫn được giữ trong lịch sử.</p></div>
            <Checkbox checked={confirmed} disabled={busy} onChange={event => { setConfirmed(event.target.checked); setDirty(true); }}>Tôi xác nhận thay đổi quyền lợi và thời hạn của tài khoản này.</Checkbox><div className="um-modal-footer"><span><ShieldCheck size={16} />Gói trước / sau được ghi vào nhật ký</span><Button disabled={busy} onClick={() => closeAction()}>Quay lại</Button><Button type="primary" disabled={busy || !confirmed || (tier !== 'FREE' && billingCycle !== 'NONE' && !startsAt)} icon={<Check size={16} />} onClick={savePlan}>{busy ? 'Đang lưu...' : 'Lưu gói & thời hạn'}</Button></div>
          </div>}
          {action === 'STATUS' && <Form form={statusForm} layout="vertical" disabled={busy} onValuesChange={() => setDirty(true)} onFinish={values => void mutate({ status: details.user.status === 'ACTIVE' ? 'BANNED' : 'ACTIVE', reason: values.reason.trim(), confirmed: true, expectedRevision: details.user.controlRevision || 0 }, 'status', 'POST')}><Alert type={details.user.status === 'ACTIVE' ? 'warning' : 'info'} showIcon title={details.user.status === 'ACTIVE' ? 'Tài khoản sẽ mất quyền truy cập.' : 'Tài khoản sẽ được mở lại quyền truy cập.'} description="Dữ liệu, số dư Credit và lịch sử gói được giữ lại." /><Form.Item name="reason" label="Lý do thay đổi trạng thái" rules={[{ required: true, message: 'Nhập lý do thay đổi.' }, { validator: (_, value) => typeof value === 'string' && value.trim().length >= 5 ? Promise.resolve() : Promise.reject(new Error('Lý do cần ít nhất 5 ký tự.')) }]}><Input.TextArea aria-label="Lý do thay đổi trạng thái" rows={3} maxLength={1000} showCount /></Form.Item><div className="um-modal-footer"><Button disabled={busy} onClick={() => closeAction()}>Hủy</Button><Button type="primary" danger={details.user.status === 'ACTIVE'} htmlType="submit" disabled={busy}>{busy ? 'Đang cập nhật...' : modalTitle}</Button></div></Form>}
        </>}
      </Modal>
    </div>
  </ConfigProvider>;
}
