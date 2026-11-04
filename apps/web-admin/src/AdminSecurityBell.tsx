import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {App, Badge, Button, Empty, List, Popover, Tag} from 'antd';
import {ShieldAlert} from 'lucide-react';
import {io} from 'socket.io-client';
import {AdminTime} from './components/AdminTime';

type Event = {_id: string; eventId?: string; ip: string; occurredAt: string; linkedCount: number};
export function AdminSecurityBell({accountKey}: {accountKey: string}) {
  const {notification} = App.useApp(), navigate = useNavigate();
  const [items, setItems] = useState<Event[]>([]), [unread, setUnread] = useState(0);
  const [connected, setConnected] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let disposed = false, initialized = false;
    const storageKey = `admin-free-ip-events:${accountKey}`;
    let stored: string[] = [];
    try {const parsed = JSON.parse(sessionStorage.getItem(storageKey) || '[]'); if (Array.isArray(parsed)) stored = parsed.filter(value => typeof value === 'string').slice(-500);} catch { /* Storage may be unavailable. */ }
    const seen = new Set(stored);
    const remember = (id: string) => {
      seen.add(id); if (seen.size > 500) seen.delete(seen.values().next().value!);
      try {sessionStorage.setItem(storageKey, JSON.stringify([...seen]));} catch { /* In-memory deduplication remains active. */ }
    };
    const notify = (event: Event) => {
      const id = event.eventId || event._id;
      if (seen.has(id)) return;
      remember(id); setUnread(value => value + 1);
      notification.warning({key: id, message: 'Nghi vấn spam tài khoản', description: `IP ${event.ip} · Từ chối tài khoản Free ngoài danh sách ${event.linkedCount} tài khoản.`, duration: 8});
      window.dispatchEvent(new Event('admin-free-ip-updated'));
    };
    const load = async () => {
      try {
        const response = await fetch('/api/admin/users/ip-history?page=1', {credentials: 'include'});
        if (!response.ok) throw new Error('Không tải được lịch sử cảnh báo.');
        const result = await response.json();
        if (disposed) return;
        if (initialized) result.data.items.forEach(notify); else result.data.items.forEach((event: Event) => remember(event._id));
        initialized = true;
        setItems(previous => {
          const latest = result.data.items as Event[], ids = new Set(latest.map(event => event._id));
          return [...latest, ...previous.filter(event => !ids.has(event._id))]
            .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || b._id.localeCompare(a._id)).slice(0, 10);
        });
        setError('');
      } catch {if (!disposed) setError('Không tải được lịch sử cảnh báo.');}
    };
    const socket = io('/admin-security', {withCredentials: true});
    socket.on('connect', () => {setConnected(true); void load(); window.dispatchEvent(new Event('admin-free-ip-updated'));});
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('security:free-ip', (event: Event) => {if (!disposed) {notify(event); setItems(previous => [event, ...previous.filter(item => item._id !== event._id)].slice(0, 10));}});
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {disposed = true; clearInterval(timer); socket.disconnect();};
  }, [accountKey, notification]);
  return <Popover placement="bottomRight" trigger="click" onOpenChange={open => {if (open) setUnread(0);}} content={<div style={{width: 360, maxWidth: '80vw'}}>
    <strong>Cảnh báo tài khoản Free</strong> <Tag color={connected ? 'green' : 'default'}>{connected ? 'Trực tiếp' : 'Đang kết nối'}</Tag>
    <p>10 lượt từ chối gần nhất. Cờ nghi vấn chỉ phục vụ theo dõi.</p>
    {error && <p role="alert">{error}</p>}
    <List dataSource={items} style={{maxHeight: 340, overflowY: 'auto'}} locale={{emptyText: <Empty description="Chưa có lượt vượt giới hạn" />}} renderItem={event => <List.Item>
      <Button type="text" onClick={() => navigate(`/users?ip=${encodeURIComponent(event.ip)}`)}><span>{event.ip} · <AdminTime value={event.occurredAt} /></span></Button>
    </List.Item>} />
    <Button type="link" onClick={() => navigate('/users?ipMonitor=1')}>Tra cứu IP và lịch sử</Button>
  </div>}><Badge count={unread} size="small"><Button aria-label="Cảnh báo tài khoản Free theo IP" icon={<ShieldAlert size={18} />} /></Badge></Popover>;
}
