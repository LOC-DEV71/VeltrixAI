import {useEffect, useRef, useState} from 'react';
import {io} from 'socket.io-client';
import {App, Badge, Button, Empty, List, Popover, Tag} from 'antd';
import {Bell} from 'lucide-react';
import {billingNumber} from './billingFormatting';
import {AdminTime} from './components/AdminTime';
import {errorMessage} from './userMessages';

export function AdminBillingBell({onOrders}: {onOrders: () => void}) {
  const {notification} = App.useApp();
  const [items, setItems] = useState<any[]>([]), [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false), [connected, setConnected] = useState(false), [error, setError] = useState('');
  const isOpen = useRef(open); isOpen.current = open;
  useEffect(() => {
    let cancelled = false;
    const seen = new Set<string>();
    const load = async () => {
      try {
        const response = await fetch('/api/admin/billing/orders?status=PAID&page=1&limit=10', {credentials: 'include'});
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.code || 'BILLING_UNAVAILABLE');
        if (!cancelled) {setItems(result.data.items); setError('');}
      } catch (e) {if (!cancelled) setError(errorMessage(e));}
    };
    const socket = io('/admin-billing', {withCredentials: true});
    socket.on('connect', () => {setConnected(true); void load(); window.dispatchEvent(new Event('admin-billing-updated'));});
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('billing:order', event => {
      if (seen.has(event.eventId)) return;
      seen.add(event.eventId);
      if (seen.size > 500) seen.delete(seen.values().next().value!);
      window.dispatchEvent(new Event('admin-billing-updated'));
      if(event.refundStatus){
        if(!isOpen.current)setUnread(count=>count+1);
        notification.info({message:event.refundStatus==='COMPLETED'?'VNPay xác nhận hoàn tiền':event.refundStatus==='REJECTED'?'VNPay từ chối hoàn tiền':'Hoàn tiền đang đối soát',description:`${event.planName} · ${billingNumber(event.amount)} ₫${event.mode==='sandbox'?' · Thử nghiệm':''}`,duration:6});
        void load();return;
      }
      if (event.status !== 'PAID') return;
      if (!isOpen.current) setUnread(count => count + 1);
      notification.success({message: 'Có đăng ký gói mới', description: `${event.planName} · ${billingNumber(event.amount)} ₫${event.mode === 'sandbox' ? ' · Giao dịch thử nghiệm' : ''}`, duration: 6});
      void load();
    });
    void load();
    const timer = setInterval(() => {void load(); if (!socket.connected) {socket.connect(); window.dispatchEvent(new Event('admin-billing-updated'));}}, 15000);
    return () => {cancelled = true; clearInterval(timer); socket.disconnect();};
  }, [notification]);
  return <Popover placement="bottomRight" trigger="click" open={open} onOpenChange={value => {setOpen(value); if (value) setUnread(0);}} content={
    <div style={{width: 340, maxWidth: '80vw'}}>
      <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 12}}><strong>Thanh toán đăng ký gói</strong><Tag color={connected ? 'green' : 'default'}>{connected ? 'Trực tiếp' : 'Đang kết nối'}</Tag></div>
      {error && <p role="alert">{error}</p>}
      <List style={{maxHeight: 360, overflowY: 'auto'}} dataSource={items} locale={{emptyText: <Empty description="Chưa có thanh toán thành công"/>}} renderItem={order =>
        <List.Item><button style={{border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', width: '100%'}} onClick={() => {setOpen(false); onOrders();}}>
          <strong>{order.planName} · {billingNumber(order.amount)} ₫</strong>{order.refundedAt?<Tag>Đã hoàn tiền</Tag>:order.refundLockedAt?<Tag>Đang đối soát hoàn tiền</Tag>:null}
          <div><AdminTime value={order.paidAt}/></div><small>{order.mode === 'sandbox' ? 'Thử nghiệm' : 'Thực tế'} · {order._id}</small>
        </button></List.Item>}/>
      <Button type="link" onClick={() => {setOpen(false); onOrders();}}>Xem toàn bộ đơn hàng</Button>
    </div>
  }><Badge count={unread} size="small"><Button aria-label="Thông báo thanh toán" icon={<Bell size={18}/>}/></Badge></Popover>;
}
