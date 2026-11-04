import {useEffect, useState} from 'react';
import {useSearchParams, Link} from 'react-router-dom';
import {Alert, Button, Empty, Input, Pagination, Skeleton, Table, Tag, Typography} from 'antd';
import {Network, Search} from 'lucide-react';
import {AdminTime} from './components/AdminTime';
import {errorMessage} from './userMessages';

type Account = {_id: string; email?: string; displayName?: string; deleted?: boolean};
type Denial = {_id: string; occurredAt: string; verifiedEmail: string; userId?: string; linkedCount: number; kind: string; account?: Account};
type NetworkRow = {_id: string; ip: string; month: string; accountIds: string[]; suspicious: boolean; lastDeniedAt?: string};
type History = {linkedAccounts: Account[]; suspicious: boolean; items: Denial[]; total: number};
async function get(path: string, signal: AbortSignal) {
  const response = await fetch('/api/admin/users/' + path, {credentials: 'include', signal});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.code === 'ADMIN_INVALID_IP' ? 'Nhập địa chỉ IPv4 hoặc IPv6 hợp lệ.' : errorMessage({code: result.error?.code}, response.status));
  return result.data;
}
function AccountLabel({account}: {account: Account}) {
  return account.deleted ? <span>Tài khoản đã bị xóa · {account._id}</span> : <Link to={`/users?userId=${account._id}`}>
    {account.displayName || account.email || account._id}{account.displayName && account.email && <small style={{display: 'block'}}>{account.email}</small>}
  </Link>;
}
export function IpAccountMonitor() {
  const [params, setParams] = useSearchParams();
  const routeIp = params.get('ip') || '';
  const [open, setOpen] = useState(!!routeIp || params.has('ipMonitor'));
  const [input, setInput] = useState(routeIp), [ip, setIp] = useState(routeIp), [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [page, setPage] = useState(1), [historyPage, setHistoryPage] = useState(1), [reload, setReload] = useState(0);
  const [networks, setNetworks] = useState<NetworkRow[]>([]), [total, setTotal] = useState(0), [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  useEffect(() => {if (routeIp) {setOpen(true); setInput(routeIp); setIp(routeIp); setPage(1); setHistoryPage(1);}}, [routeIp]);
  useEffect(() => {const refresh = () => setReload(value => value + 1); window.addEventListener('admin-free-ip-updated', refresh); return () => window.removeEventListener('admin-free-ip-updated', refresh);}, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setLoading(true); setError('');
    const query = `month=${encodeURIComponent(month)}${ip ? '&ip=' + encodeURIComponent(ip) : ''}`;
    void (async () => {
      try {
        const [rows, detail] = await Promise.all([get(`ip-networks?${query}&page=${page}`, controller.signal), ip ? get(`ip-history?${query}&page=${historyPage}`, controller.signal) : null]);
        if (!controller.signal.aborted) {setNetworks(rows.items); setTotal(rows.total); setHistory(detail);}
      } catch (e) {if (!controller.signal.aborted) setError(errorMessage(e));}
      finally {if (!controller.signal.aborted) setLoading(false);}
    })();
    return () => controller.abort();
  }, [open, ip, month, page, historyPage, reload]);
  function select(value: string) {setIp(value.trim()); setInput(value.trim()); setPage(1); setHistoryPage(1);}
  return <section className="um-detail-section" style={{marginBottom: 24}}>
    <div className="um-section-heading"><h2><Network size={18} /> Kiểm soát tài khoản Free theo IP</h2><Button onClick={() => setOpen(value => !value)}>{open ? 'Thu gọn' : 'Tra cứu IP'}</Button></div>
    {open && <>
      <p className="um-caption">Tối đa 3 tài khoản Free duy nhất / IP / tháng UTC, cùng lịch cấp Credit hiện tại. Credit riêng từng tài khoản. Cờ nghi vấn không khóa IP hoặc tài khoản.</p>
      <form style={{display: 'flex', gap: 12, flexWrap: 'wrap', margin: '16px 0'}} onSubmit={event => {event.preventDefault(); select(input);}}>
        <Input style={{width: 320, maxWidth: '100%'}} aria-label="IP cần tra cứu" placeholder="Địa chỉ IPv4 hoặc IPv6" value={input} onChange={event => setInput(event.target.value)} prefix={<Search size={16} />} />
        <Input style={{width: 180}} aria-label="Tháng theo dõi IP" type="month" value={month} onChange={event => {setMonth(event.target.value); setPage(1); setHistoryPage(1);}} />
        <Button htmlType="submit" type="primary">Tra cứu</Button>
        <Button onClick={() => {select(''); const next = new URLSearchParams(params); next.delete('ip'); setParams(next, {replace: true});}}>Tất cả IP</Button>
      </form>
      {error ? <Alert type="error" showIcon title="Không tải được dữ liệu IP" description={error} action={<Button onClick={() => setReload(value => value + 1)}>Thử lại</Button>} /> : loading ? <Skeleton active paragraph={{rows: 4}} /> : <>
        <Table<NetworkRow> rowKey="_id" pagination={false} dataSource={networks} scroll={{x: 660}} locale={{emptyText: <Empty description="Chưa có IP được liên kết trong tháng này" />}} columns={[
          {title: 'IP mạng', render: (_, row) => <Button type="link" onClick={() => select(row.ip)}>{row.ip}</Button>},
          {title: 'Free đã liên kết', render: (_, row) => `${row.accountIds.length} / 3`},
          {title: 'Trạng thái IP', render: (_, row) => <Tag color={row.suspicious ? 'orange' : 'default'}>{row.suspicious ? 'Nghi vấn spam tài khoản' : 'Chưa có lượt vượt giới hạn'}</Tag>},
          {title: 'Từ chối gần nhất trong tháng', dataIndex: 'lastDeniedAt', render: value => <AdminTime value={value} />},
        ]} />
        <Pagination style={{marginTop: 16}} current={page} total={total} pageSize={10} showSizeChanger={false} onChange={setPage} />
        {ip && history && <div style={{marginTop: 24}}>
          <h3>IP {ip} <Tag color={history.suspicious ? 'orange' : 'default'}>{history.suspicious ? 'Nghi vấn spam tài khoản' : 'Chưa có cờ nghi vấn'}</Tag></h3>
          <p>Các tài khoản đã liên kết vẫn được đăng nhập. Cờ nghi vấn được giữ để tra cứu cả các tháng trước.</p>
          <h4>Tài khoản liên kết trong tháng {month}</h4>
          {history.linkedAccounts.length ? history.linkedAccounts.map(account => <div key={account._id} style={{marginBottom: 10}}><AccountLabel account={account} /> <Typography.Text copyable>{account._id}</Typography.Text></div>) : <Empty description="Chưa liên kết tài khoản nào trong tháng này" />}
          <h4>Lịch sử từ chối trong tháng</h4>
          <Table<Denial> rowKey="_id" pagination={false} dataSource={history.items} scroll={{x: 680}} locale={{emptyText: <Empty description="Chưa có lượt từ chối trong tháng này" />}} columns={[
            {title: 'Thời gian', dataIndex: 'occurredAt', render: value => <AdminTime value={value} />},
            {title: 'Tài khoản đã xác thực', render: (_, row) => row.account ? <AccountLabel account={row.account} /> : <span>{row.verifiedEmail}<small style={{display: 'block'}}>{row.userId ? 'Tài khoản không còn tồn tại' : 'Đăng ký chưa được tạo'}</small></span>},
            {title: 'Lý do từ chối', render: (_, row) => <>Đã đủ {row.linkedCount} tài khoản Free · {row.kind === 'LOGIN' ? 'Đăng nhập' : 'Đăng ký mới'}</>},
          ]} />
          <Pagination style={{marginTop: 16}} current={historyPage} total={history.total} pageSize={10} showSizeChanger={false} onChange={setHistoryPage} />
        </div>}
      </>}
    </>}
  </section>;
}
