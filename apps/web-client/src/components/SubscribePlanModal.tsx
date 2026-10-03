import { useEffect, useRef, useState } from 'react';
import { Modal } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { errorMessage } from '../utils/userMessages';

export function SubscribePlanModal({plan,billingCycle,onClose}:{plan:any;billingCycle:'monthly'|'yearly';onClose:()=>void}) {
  const {user}=useAuth();const navigate=useNavigate();
  const requestKey=useRef(crypto.randomUUID());
  const [methods,setMethods]=useState<any[]>([]),[methodId,setMethodId]=useState('');
  useEffect(()=>{if(user)void api.get('/billing/payment-methods').then(r=>setMethods(r.data.data.methods)).catch(()=>{});},[user?.id]);
  const [config,setConfig]=useState<any>(null),[error,setError]=useState(''),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false);
  const price=plan.config.pricing[billingCycle+'Price'];
  useEffect(()=>{const controller=new AbortController();api.get('/billing/config',{signal:controller.signal}).then(r=>setConfig(r.data.data)).catch(()=>{if(!controller.signal.aborted)setError('Chưa tải được thông tin thanh toán. Vui lòng thử lại sau.');});return()=>controller.abort();},[]);
  const subscribe=async()=>{
    if(!user){onClose();navigate('/login',{state:{returnTo:`/pricing?plan=${encodeURIComponent(plan.tier)}&billing=${billingCycle}`}});return;}
    if(!consent || !config?.available || busy)return;
    setBusy(true);setError('');
    try {const r=await api.post('/billing/checkout',{tier:plan.tier,billingCycle,expectedRevision:plan.revision,...(methodId?{paymentMethodId:methodId}:{})},{headers:{'Idempotency-Key':requestKey.current}});const url=new URL(r.data.data.checkoutUrl);if(url.protocol!=='https:')throw new Error('INVALID_CHECKOUT_URL');window.location.assign(url.href);}
    catch(e){setError(errorMessage(e));setBusy(false);}
  };
  return <Modal open onCancel={()=>{if(!busy)onClose();}} title={`Đăng ký ${plan.config.overview.name}`} footer={null} destroyOnHidden>
    <div className="space-y-5 py-3">
      <div className="rounded-xl bg-indigo-50 p-5"><p className="text-sm text-indigo-700">{billingCycle==='yearly'?'Đăng ký 12 tháng':'Đăng ký 1 tháng'}</p><p className="mt-2 text-3xl font-bold text-slate-900">{price.toLocaleString('vi-VN')} ₫ <span className="text-sm font-normal text-slate-500">/ {billingCycle==='yearly'?'năm':'tháng'}</span></p><p className="mt-2 text-xs text-slate-500">Giá và quyền lợi lấy theo cấu hình hiện hành. Gói được kích hoạt sau khi thanh toán được xác nhận.</p></div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {config?.mode==='sandbox'&&<p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">VNPay đang ở chế độ thử nghiệm. Giao dịch này không thu tiền thật.</p>}
      <p className="text-sm text-slate-600">Thanh toán một lần qua VNPay. Gói không tự động gia hạn.</p>
      {config?.savedCardsAvailable&&methods.length>0&&<label className="block text-sm font-medium">Phương thức thanh toán<select className="mt-2 w-full rounded-xl border p-3" value={methodId} disabled={busy} onChange={e=>{setMethodId(e.target.value);requestKey.current=crypto.randomUUID();}}><option value="">Chọn phương thức tại VNPay</option>{methods.map(m=><option key={m._id} value={m._id}>{m.brand} ···· {m.last4}</option>)}</select></label>}
      {!config&&!error&&<p role="status" className="text-sm text-slate-500">Đang kiểm tra phương thức thanh toán...</p>}
      {config&&!config.available&&<div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-900">Thanh toán trực tuyến đang được chuẩn bị. Hiện chưa thể thu tiền hoặc lưu thẻ Visa.</div>}
      <p className="text-sm text-slate-600">Bạn sẽ nhập thẻ tại trang bảo mật của đơn vị thanh toán. Veltrix không lưu số thẻ đầy đủ hoặc CVV.</p>
      <label className="flex gap-3 text-sm text-slate-600"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)} className="mt-1"/><span>Tôi đã xem giá, chu kỳ và <Link to="/chinh-sach-dieu-khoan" className="text-indigo-600 underline">chính sách thanh toán</Link>.</span></label>
      <button onClick={()=>void subscribe()} disabled={busy || !!user && (!consent || !config?.available)} className="w-full rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white disabled:opacity-40">{busy?'Đang chuyển tới thanh toán...':user?'Tiếp tục thanh toán':'Đăng nhập để đăng ký'}</button>
      <Link to="/account/billing" onClick={onClose} className="block text-center text-sm font-semibold text-indigo-600">Quản lý phương thức thanh toán trong tài khoản →</Link>
    </div>
  </Modal>;
}
