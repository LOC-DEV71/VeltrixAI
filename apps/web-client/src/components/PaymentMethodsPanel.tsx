import { useCallback, useEffect, useState } from 'react';
import { Modal } from 'antd';
import { CreditCard, LockKeyhole, Plus } from 'lucide-react';
import { Link,useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { errorMessage } from '../utils/userMessages';

export function PaymentMethodsPanel() {
  const [params]=useSearchParams(),setupId=params.get('setup');const [setupStatus,setSetupStatus]=useState('');
  const [methods,setMethods]=useState<any[]>([]),[config,setConfig]=useState<any>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [open,setOpen]=useState(false),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false);
  const load=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setError('');
    try{const [c,m]=await Promise.all([api.get('/billing/config',{signal}),api.get('/billing/payment-methods',{signal})]);if(!signal?.aborted){setConfig(c.data.data);setMethods(m.data.data.methods);}}
    catch(e){if(!signal?.aborted)setError(errorMessage(e));}finally{if(!signal?.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load]);
  useEffect(()=>{if(!setupId)return;let cancelled=false,timer:ReturnType<typeof setTimeout>,attempts=0;const poll=async()=>{try{const r=await api.get('/billing/payment-methods/setup/'+encodeURIComponent(setupId));if(cancelled)return;setSetupStatus(r.data.data.status);if(r.data.data.status==='ACTIVE')void load();else if(r.data.data.status==='PENDING'&&++attempts<20)timer=setTimeout(poll,3000);}catch(e){if(!cancelled)setError(errorMessage(e));}};void poll();return()=>{cancelled=true;clearTimeout(timer);};},[setupId,load]);
  const add=async()=>{
    if(busy||!consent||!config?.savedCardsAvailable)return;setBusy(true);setError('');
    try{const response=await api.post('/billing/payment-methods/setup',{consent:true});const url=new URL(response.data.data.setupUrl);if(url.protocol!=='https:')throw new Error('INVALID_SETUP_URL');window.location.assign(url.href);}
    catch(e){setError(errorMessage(e));setBusy(false);}
  };
  return <div className="space-y-6">
    {setupId&&<p role="status" className="rounded-xl bg-indigo-50 p-4 text-sm">{setupStatus==='ACTIVE'?'Đã xác thực và lưu thẻ Visa vào tài khoản.':setupStatus==='FAILED'?'Chưa xác thực được thẻ Visa. Vui lòng thử lại.':'Đang chờ VNPay xác nhận lưu thẻ. Bạn có thể tải lại trang để kiểm tra.'}</p>}
    <div className="flex flex-wrap justify-between items-start gap-4"><div><h2 className="text-lg font-semibold">Phương thức thanh toán</h2><p className="mt-2 text-sm text-slate-500">Quản lý thẻ Visa đã lưu cho tài khoản của bạn.</p></div><button disabled={loading||!!error} onClick={()=>{setConsent(false);setOpen(true);}} className="flex gap-2 items-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"><Plus size={17}/>Thêm thẻ Visa</button></div>
    {loading?<p role="status" className="text-sm text-slate-500">Đang tải phương thức thanh toán...</p>:error?<p role="alert" className="text-sm text-red-600">{error}<button className="underline ml-2" onClick={()=>void load()}>Thử lại</button></p>:methods.length?<div className="space-y-3">{methods.map(card=><div key={card._id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 p-5"><div className="flex items-center gap-4"><CreditCard className="text-indigo-600"/><div><p className="font-semibold capitalize">{card.brand} ···· {card.last4}</p><p className="text-xs text-slate-500 mt-1">{card.expiryMonth&&card.expiryYear?<>Hết hạn {String(card.expiryMonth).padStart(2,'0')}/{card.expiryYear}</>:'?? x?c th?c qua VNPay'}</p></div></div>{card.isDefault&&<span className="rounded-full bg-indigo-50 px-3 py-1 text-xs text-indigo-600">Mặc định</span>}</div>)}</div>:<div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center"><CreditCard size={32} className="mx-auto text-slate-300"/><h3 className="mt-3 font-semibold">Bạn chưa lưu thẻ thanh toán</h3><p className="mt-2 text-sm text-slate-500">Thẻ được xác thực tại đơn vị thanh toán trước khi xuất hiện trong tài khoản.</p></div>}
    {config&&!config.available&&<p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Thanh toán trực tuyến đang được chuẩn bị. Hiện chưa thể đăng ký trả phí hoặc lưu thẻ mới.</p>}
    <p className="flex gap-2 text-xs leading-6 text-slate-500"><LockKeyhole size={16} className="shrink-0 mt-1"/>Tài khoản chỉ hiển thị loại thẻ, 4 số cuối và hạn thẻ. Veltrix không lưu số thẻ đầy đủ hoặc CVV.</p>
    <Link to="/pricing" className="inline-block text-sm font-semibold text-indigo-600">Xem gói & đăng ký →</Link>
    <Modal open={open} onCancel={()=>{if(!busy)setOpen(false);}} title="Lưu thẻ Visa cho tài khoản" footer={null}>
      <div className="space-y-5 py-3"><p className="text-sm text-slate-600">Bạn sẽ được chuyển tới trang bảo mật của đơn vị thanh toán để nhập và xác thực thẻ.</p>{!config?.savedCardsAvailable&&<p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Chức năng lưu thẻ chưa sẵn sàng. Vui lòng quay lại sau.</p>}<label className="flex gap-3 text-sm"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>Tôi đồng ý lưu phương thức thanh toán để dùng cho những lần đăng ký sau.</span></label><button onClick={()=>void add()} disabled={busy||!consent||!config?.savedCardsAvailable} className="w-full rounded-xl bg-indigo-600 px-5 py-3 text-white font-semibold disabled:opacity-40">{busy?'Đang chuyển...':'Tiếp tục xác thực thẻ'}</button></div>
    </Modal>
  </div>;
}
