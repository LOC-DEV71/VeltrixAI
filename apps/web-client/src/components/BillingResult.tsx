import {useEffect,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {api} from '../api';
import {useAuth} from '../contexts/AuthContext';
import {errorMessage} from '../utils/userMessages';
export function BillingResult(){
  const [params]=useSearchParams(),id=params.get('order');const [order,setOrder]=useState<any>(null),[error,setError]=useState('');const {refreshUser}=useAuth();
  const [revision,setRevision]=useState(0);useEffect(()=>{const listener=()=>setRevision(v=>v+1);window.addEventListener('billing-updated',listener);return()=>window.removeEventListener('billing-updated',listener);},[]);
  useEffect(()=>{
    if(!id)return;let cancelled=false,timer:ReturnType<typeof setTimeout>;let attempts=0;
    const load=async()=>{try{const r=await api.get('/billing/orders/'+encodeURIComponent(id));if(cancelled)return;setOrder(r.data.data);if(r.data.data.status==='PAID')await refreshUser();else if(r.data.data.status==='PENDING'&&++attempts<20)timer=setTimeout(load,3000);}catch(e){if(!cancelled)setError(errorMessage(e));}};
    void load();return()=>{cancelled=true;clearTimeout(timer);};
  },[id,revision]);
  if(!id)return null;
  return <div className="mb-6 rounded-xl border border-indigo-100 bg-indigo-50 p-5" role="status"><h2 className="font-semibold">Kết quả đăng ký gói</h2><p className="mt-2 text-sm">{error||(!order?'Đang kiểm tra đơn thanh toán...':order.status==='PAID'?'Thanh toán đã được xác nhận. Gói và credit đã được cập nhật.':order.status==='FAILED'?'Thanh toán chưa thành công. Gói của bạn chưa thay đổi.':'Đang chờ xác nhận từ VNPay. Chưa kích hoạt gói; bạn có thể tải lại trang để kiểm tra.')}</p>{order&&<p className="mt-2 text-xs text-slate-500">Mã đơn: {order._id} · {Number(order.amount).toLocaleString('vi-VN')} ₫{order.mode==='sandbox'?' · Giao dịch thử nghiệm':''}</p>}</div>;
}
