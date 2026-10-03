import {useEffect,useState} from 'react';
import {useNavigate,useSearchParams} from 'react-router-dom';
import {Check,Coins,FileText,Layers,Mic,Sparkles,Video,Folder,History,X,ChevronDown,ChevronUp} from 'lucide-react';
import {SubscribePlanModal} from './SubscribePlanModal';
import {api} from '../api';
import {useAuth} from '../contexts/AuthContext';
const icons:Record<string,typeof Check>={credits:Coins,content:FileText,scenes:Layers,voice:Mic,clone:Mic,sparkles:Sparkles,video:Video,projects:Folder,history:History};
 export function PlanCards(){
  const {user}=useAuth(),navigate=useNavigate();const [plans,setPlans]=useState<any[]>([]),[error,setError]=useState(false),[billing,setBilling]=useState<'monthly'|'yearly'>('monthly'),[selected,setSelected]=useState<any>(null),[expandedPlans,setExpandedPlans]=useState<Record<string,boolean>>({});
  const [subscription,setSubscription]=useState<any>(null);
  const [params,setParams]=useSearchParams();
  useEffect(()=>{const tier=params.get('plan'),cycle=params.get('billing')==='yearly'?'yearly':'monthly';if(!tier||!plans.length||!user)return;const plan=plans.find(p=>p.tier===tier&&p.tier!=='FREE');if(plan){setBilling(cycle);setSubscription({plan,billingCycle:cycle});}const next=new URLSearchParams(params);next.delete('plan');next.delete('billing');setParams(next,{replace:true});},[plans,user?.id,params,setParams]);
  const handleCheckout=()=>{if(selected){setSubscription({plan:selected,billingCycle:billing});setSelected(null);}};
  useEffect(()=>{const controller=new AbortController();api.get('/plans',{signal:controller.signal}).then(res=>setPlans(res.data.data)).catch(()=>{if(!controller.signal.aborted)setError(true);});return()=>controller.abort();},[]);
 useEffect(()=>{if(!selected)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setSelected(null);};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[selected]);
 const amount=(n:number)=>Number(n).toLocaleString('vi-VN'),limit=(n:number|null)=>n===null?'Không giới hạn':amount(n);
  const card=(p:any)=>{
    const c=p.config,current=user?.plan===p.tier,free=p.tier==='FREE',available=c.pricing[billing+'Available'],price=c.pricing[billing+'Price'];
    const isExpanded=expandedPlans[p.tier]||false;
    const hasMoreFeatures=p.presentation.features.length>3;
    return <article key={p.tier} className={`relative flex flex-col rounded-[28px] border bg-white p-7 ${c.overview.highlighted?'border-indigo-400 shadow-lg shadow-indigo-100':'border-slate-200 shadow-sm'}`}>
      {c.overview.highlighted&&<span className="absolute top-0 right-6 -translate-y-1/2 rounded-full bg-indigo-600 px-3 py-1 text-xs font-medium text-white">Gói nổi bật</span>}
      {c.overview.popular && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full w-max bg-gradient-to-r from-indigo-500 to-cyan-500 p-1.5 pr-6 text-white shadow-lg shadow-indigo-200 flex items-center gap-3 whitespace-nowrap z-10">
          <div className="flex -space-x-2 shrink-0" aria-label="Avatar minh họa">
            {['hai-dang','mai-anh','quang-son'].map(avatar => <img key={avatar} src={`/voice-avatars/${avatar}.png`} alt="" className="w-9 h-9 rounded-full border-2 border-indigo-400 bg-white shadow-sm" />)}
          </div>
          <div className="flex flex-col justify-center text-left">
            <span className="text-sm font-bold leading-tight">Thường được dùng</span>
            <span className="text-[10px] font-medium text-white/90 leading-tight mt-0.5">Hơn 10.000 người sử dụng</span>
          </div>
        </div>
      )}
      <p className="font-semibold text-lg text-slate-900">{c.overview.name}</p><h3 className="mt-7 text-2xl font-semibold tracking-tight text-slate-900 min-h-[64px]">{p.presentation.headline}</h3><p className="mt-4 text-sm leading-7 text-slate-500 min-h-[112px]">{p.presentation.description}</p>
      <button disabled={current} className={`mt-6 w-full rounded-full border px-4 py-3 text-sm font-semibold ${current?'border-slate-200 text-slate-400':'border-indigo-600 text-indigo-600 hover:bg-indigo-50'}`} onClick={()=>free?navigate(user?'/workspace':'/login'):setSelected(p)}>{current?'Gói đang dùng':free?'Bắt đầu miễn phí':'Xem chi tiết gói'}</button>
      {!free&&available&&<button className="mt-3 w-full rounded-full bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700" onClick={()=>setSubscription({plan:p,billingCycle:billing})}>Đăng ký gói</button>}
      <div className="mt-7 mb-7 flex items-baseline flex-wrap gap-2 min-h-[58px]">{free||available?<><span className="text-4xl font-semibold tracking-tight">{amount(price)}<span className="text-lg ml-1">₫</span></span><span className="text-sm text-slate-500">{free?'Miễn phí':billing==='monthly'?'/ tháng':'/ năm'}</span></>:<span className="text-lg text-slate-500">Chưa mở đăng ký theo {billing==='monthly'?'tháng':'năm'}</span>}</div>
      <div className="relative">
        <ul className={`space-y-5 text-sm text-slate-700 transition-all duration-300 custom-scrollbar ${isExpanded?'overflow-y-auto pr-2':'overflow-hidden pr-2'}`} style={{ height: '144px' }}>
          {p.presentation.features.map((f:any)=>{const Icon=icons[f.icon]||Check;return <li key={f.text} className="flex gap-3 leading-6"><Icon className="shrink-0 mt-0.5 text-slate-600" size={19}/><span>{f.text}</span></li>;})}
        </ul>
        {!isExpanded && hasMoreFeatures && <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>}
      </div>
      {hasMoreFeatures&&<div className="flex justify-center mt-3 pt-3 border-t border-slate-100"><button className="flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium transition-colors text-sm" onClick={()=>setExpandedPlans(prev=>({...prev,[p.tier]:!isExpanded}))}>{isExpanded?<><ChevronUp size={16}/><span>Đóng cuộn</span></>:<><ChevronDown size={16}/><span>Xem thêm quyền lợi</span></>}</button></div>}
      <div className="mt-auto pt-7 text-xs leading-6 text-slate-500 border-t border-slate-100"><p>Viết nội dung: {amount(c.credits.contentCost)} credit/lần.</p><p>TTS: {amount(c.credits.ttsPer100Chars)} credit/100 ký tự, làm tròn lên.</p></div>
    </article>;
  };
 return <section id="pricing" className="py-20 px-6 bg-slate-50/60"><div className="max-w-[1400px] mx-auto"><div className="text-center max-w-2xl mx-auto"><span className="text-xs font-semibold tracking-widest uppercase text-indigo-600">Gói & quyền lợi</span><h2 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900">Chọn không gian sáng tạo của bạn</h2><p className="mt-4 text-slate-500 leading-7">Từ kịch bản đầu tiên đến quy trình sản xuất nội dung mỗi ngày. Chọn gói phù hợp với cách bạn sáng tạo.</p></div>
 <div className="flex justify-center my-9"><div className="inline-flex rounded-full border border-slate-200 bg-white p-1">{(['monthly','yearly'] as const).map(value=><button key={value} aria-pressed={billing===value} className={`rounded-full px-6 py-2.5 text-sm font-medium ${billing===value?'bg-slate-900 text-white':'text-slate-500'}`} onClick={()=>setBilling(value)}>{value==='monthly'?'Theo tháng':'Theo năm'}</button>)}</div></div>
 {error?<p role="alert" className="text-center text-red-600">Chưa tải được các gói. Vui lòng tải lại trang.</p>:!plans.length?<p role="status" className="text-center text-slate-500">Đang tải các gói…</p>:<div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-5 items-stretch">{plans.map(card)}</div>}
 </div>{selected&&<div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={()=>setSelected(null)}><div role="dialog" aria-modal="true" aria-label={`Chi tiết gói ${selected.config.overview.name}`} className="bg-white rounded-3xl p-7 max-w-xl w-full max-h-[85vh] overflow-y-auto" onClick={e=>e.stopPropagation()}><div className="flex justify-between"><h3 className="text-xl font-semibold">{selected.config.overview.name} · Quyền lợi hiện hành</h3><button aria-label="Đóng chi tiết"  onClick={()=>setSelected(null)}><X size={20}/></button></div><p className="my-4 text-slate-500">{selected.presentation.description}</p><dl className="space-y-3 text-sm">{[['Ký tự đầu vào mỗi yêu cầu',selected.config.content.maxInputChars],['Ký tự kịch bản tối đa',selected.config.content.maxOutputChars],['Ký tự TTS mỗi tháng',selected.config.tts.monthlyChars],['Số nội dung lưu trữ',selected.config.storage.maxContents],['Số workspace',selected.config.storage.maxWorkspaces]].map(([label,n])=><div className="flex justify-between gap-4" key={String(label)}><dt>{label}</dt><dd className="font-semibold">{limit(n as number|null)}</dd></div>)}</dl><div className="flex flex-col sm:flex-row gap-3 mt-7"><button  className="flex-1 rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 py-3 font-medium transition-colors disabled:opacity-50" onClick={()=>navigate('/docs')}>Xem hướng dẫn</button><button  className="flex-[2] rounded-full bg-indigo-600 text-white hover:bg-indigo-700 py-3 font-medium transition-colors disabled:opacity-50" onClick={handleCheckout}>{'Thanh toán & Đăng ký ngay'}</button></div></div></div>}{subscription&&<SubscribePlanModal plan={subscription.plan} billingCycle={subscription.billingCycle} onClose={()=>setSubscription(null)}/>}</section>;
}
