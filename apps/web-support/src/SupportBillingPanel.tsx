import {useEffect,useRef,useState} from 'react';
import {RefreshCw,ShieldCheck} from 'lucide-react';
import {loadSupportBilling,checkSupportRefund,confirmSupportRefund,loadSupportRefund,SupportApiError} from './supportApi';
import {refundErrors,refundStatus} from './refundMessages';
import './billing.css';
const money=(amount:number)=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND'}).format(amount);
function errorMessage(error:unknown){return error instanceof SupportApiError?refundErrors[error.code]||error.message:error instanceof Error?error.message:'Chưa thực hiện được yêu cầu. Vui lòng xem trạng thái trước khi thử lại.';}
export function SupportBillingPanel(){
 const [data,setData]=useState<any>(null),[page,setPage]=useState(1),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[quote,setQuote]=useState<any>(null),[result,setResult]=useState<any>(null);
 const active=useRef(false),mounted=useRef(true),confirmation=useRef('');
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{let live=true;setLoading(true);loadSupportBilling(page).then(value=>{if(live){setData(value);setError('');}}).catch(err=>{if(live)setError(errorMessage(err));}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[page]);
 async function run(operation:()=>Promise<void>){if(active.current)return;active.current=true;setBusy(true);setError('');try{await operation();}catch(err){if(mounted.current)setError(errorMessage(err));}finally{active.current=false;if(mounted.current)setBusy(false);}}
 const reload=async()=>{const updated=await loadSupportBilling(page);if(mounted.current)setData(updated);};
 const check=(orderId:string)=>void run(async()=>{const value=await checkSupportRefund(orderId);if(mounted.current){setQuote(value);setResult(null);confirmation.current=crypto.randomUUID();}});
 const confirm=()=>void run(async()=>{if(!quote)return;const value=await confirmSupportRefund(quote.orderId,quote.quoteId,confirmation.current);if(mounted.current){setResult(value);setQuote(null);}await reload();});
 const status=(orderId:string)=>void run(async()=>{const value=await loadSupportRefund(orderId);if(mounted.current)setResult(value);await reload();});
 return <div className="chat-billing">
  <header><ShieldCheck size={20}/><div><h3>Gia hạn & hoàn tiền</h3><p>Kiểm tra dữ liệu của chính tài khoản bạn.</p></div></header>
  <p className="billing-policy">Chỉ áp dụng cho gia hạn đã thanh toán trong 24 giờ, dùng không quá 1.000 Credit từ lần gia hạn đó. Hệ thống kiểm tra lại thanh toán và Credit trước khi gửi hoàn toàn bộ tiền.</p>
  {error&&<p role="alert" className="billing-error">{error}</p>}
  {loading?<div className="session-skeleton" aria-label="Đang tải thanh toán" role="status"><span/><span/><span/></div>:data&&<>
   <div className="billing-account"><strong>Gói đang dùng: {data.account.name}</strong><span>{data.account.availableCredits.toLocaleString('vi-VN')} Credit khả dụng · {data.account.reservedCredits.toLocaleString('vi-VN')} đang giữ</span></div>
   {quote&&<section className="billing-confirm"><h4>Xác nhận hoàn toàn bộ {money(quote.amount)}</h4><p>Đã đối chiếu VNPay. Credit đã dùng: {quote.spentCredits.toLocaleString('vi-VN')}. Kết quả kiểm tra có hiệu lực 2 phút và được kiểm tra lại khi xác nhận.</p><p>Gói gia hạn và Credit còn lại của lần này sẽ ngừng sử dụng khi bạn xác nhận. Các gói khác và dữ liệu đã tạo được giữ lại. Tiền hoàn qua giao dịch VNPay ban đầu.</p>{quote.mode==='sandbox'&&<strong>Sandbox · Giao dịch thử, không chuyển tiền thật.</strong>}<div><button disabled={busy} onClick={confirm}>{busy?'Đang xử lý…':'Xác nhận hoàn toàn bộ tiền'}</button><button disabled={busy} onClick={()=>setQuote(null)}>Giữ gói</button></div></section>}
   {result&&<p className="billing-status" role="status">{refundStatus[result.status]||'Đã ghi nhận yêu cầu'}. {['UNKNOWN','PROCESSING','SENDING','PREPARED'].includes(result.status)&&'Chưa xác nhận tiền đã về ngân hàng. Không gửi lại lệnh hoàn.'}</p>}
   {data.items.length?data.items.map((order:any)=><section className="billing-order" key={order.orderId}><div><strong>{order.name} · {money(order.amount)}</strong><span>{order.purpose==='RENEWAL'?'Gia hạn':order.purpose==='PURCHASE'?'Mua mới':'Đơn cũ chưa phân loại'} · {order.status==='PAID'?'Đã ghi nhận thanh toán':order.status==='FAILED'?'Thanh toán thất bại':'Chờ thanh toán'}{order.mode==='sandbox'?' · Sandbox':''}</span><small>Mã đơn: {order.orderId}</small></div>{order.refund?<><p>{refundStatus[order.refund.status]||order.refund.status}</p><button disabled={busy} onClick={()=>status(order.orderId)}><RefreshCw size={14}/> Xem trạng thái</button></>:order.canCheck?<button disabled={busy} onClick={()=>check(order.orderId)}>Kiểm tra điều kiện hoàn</button>:<p className="billing-note">Chưa đủ điều kiện kiểm tra tự động: chỉ hỗ trợ lần gia hạn được phân loại và trong 24 giờ.</p>}</section>):<p>Bạn chưa có đơn thanh toán.</p>}
   <nav aria-label="Trang lịch sử thanh toán"><button disabled={page===1||busy||loading} onClick={()=>{setQuote(null);setPage(value=>value-1);}}>Trước</button><span>Trang {page} · {data.total} đơn</span><button disabled={page*10>=data.total||busy||loading} onClick={()=>{setQuote(null);setPage(value=>value+1);}}>Sau</button></nav>
  </>}
  <button className="billing-refresh" disabled={busy||loading} onClick={()=>void run(reload)}><RefreshCw size={14}/> Tải lại thanh toán</button>
 </div>;
}
