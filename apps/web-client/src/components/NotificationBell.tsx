import {io} from 'socket.io-client';
import {useEffect,useRef,useState} from 'react';
import {Bell,CheckCheck} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {api} from '../api';
import {useAuth} from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import {errorMessage} from '../utils/userMessages';
export function NotificationBell(){
 const {user,refreshUser}=useAuth(),navigate=useNavigate(),[open,setOpen]=useState(false),[data,setData]=useState<any>({items:[],unread:0}),[error,setError]=useState('');
 const [page,setPage]=useState(1),[pageBusy,setPageBusy]=useState(false);const currentPage=useRef(page);currentPage.current=page;
 const loadPage=async(p:number)=>{setPageBusy(true);try{const r=await api.get('/notifications',{params:{page:p,limit:10}});if(currentPage.current===p)setData(r.data.data);}catch(e){setError(errorMessage(e));}finally{setPageBusy(false);}};
 useEffect(()=>{void loadPage(page);},[page]);
 const refresh=useRef(refreshUser);refresh.current=refreshUser;const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!user)return;let closed=false,first=true;const seen=new Set<string>();
 const receive=(next:any)=>{if(closed||!Array.isArray(next.items))return;const added=next.items.filter((n:any)=>!seen.has(n._id));next.items.forEach((n:any)=>seen.add(n._id));if(currentPage.current===1)setData(next);else{setData((old:any)=>({...old,unread:next.unread,total:next.total}));void loadPage(currentPage.current);}setError('');if(!first&&added.length){toast.success(added[0].title);void refresh.current();window.dispatchEvent(new Event('billing-updated'));}first=false;};
 const load=()=>api.get('/notifications').then(r=>receive(r.data.data)).catch(e=>{if(!closed)setError(errorMessage(e));});
 const url=new URL(api.defaults.baseURL||'/api',window.location.origin);const socket=io(url.origin+'/billing',{withCredentials:true});const events=new Set<string>();
 socket.on('connect',()=>{void load();void refresh.current();window.dispatchEvent(new Event('billing-updated'));});
 socket.on('billing:order',event=>{if(events.has(event.eventId))return;events.add(event.eventId);if(events.size>500)events.delete(events.values().next().value!);void load();void refresh.current();window.dispatchEvent(new Event('billing-updated'));});
 socket.on('connect_error',()=>{void load();});void load();const timer=setInterval(()=>{void load().finally(()=>{if(!closed&&!socket.connected)socket.connect();});},15000);
 return()=>{closed=true;socket.disconnect();clearInterval(timer);};},[user?.id]);
 useEffect(()=>{if(!open)return;const close=(e:MouseEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};document.addEventListener('mousedown',close);document.addEventListener('keydown',key);return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',key);};},[open]);
 const read=async(id:string)=>{try{const r=await api.post('/notifications/'+id+'/read',{});if(currentPage.current===1)setData(r.data.data);else await loadPage(currentPage.current);}catch(e){toast.error(errorMessage(e));}};
 return <div ref={ref} className="relative"><button aria-label="Thông báo" aria-expanded={open} onClick={()=>setOpen(v=>!v)} className="relative rounded-lg border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50"><Bell size={18}/>{data.unread>0&&<span className="absolute -top-1 -right-1 rounded-full bg-red-500 px-1.5 min-w-4 text-[10px] text-white">{data.unread>99?'99+':data.unread}</span>}</button>{open&&<div className="absolute right-0 top-12 w-[min(380px,90vw)] rounded-2xl border bg-white shadow-xl overflow-hidden"><div className="p-4 border-b flex items-center justify-between"><strong>Thông báo</strong><button className="text-xs text-indigo-600 flex items-center gap-1" disabled={!data.unread} onClick={()=>void read('all')}><CheckCheck size={14}/>Đọc tất cả</button></div>{error&&<p role="alert" className="p-4 text-sm text-red-600">{error}</p>}<div className="max-h-96 overflow-y-auto">{!data.items.length?<p className="p-6 text-sm text-slate-500">Bạn chưa có thông báo.</p>:data.items.map((n:any)=><button key={n._id} onClick={()=>{void read(n._id);setOpen(false);navigate('/account/billing'+(n.orderId?'?order='+n.orderId:''));}} className={`w-full p-4 text-left border-b hover:bg-slate-50 ${!n.readAt?'bg-indigo-50/50':''}`}><p className="font-semibold text-sm">{!n.readAt&&<span className="inline-block w-2 h-2 bg-indigo-500 rounded-full mr-2"/>}{n.title}</p><p className="mt-1 text-sm leading-6 text-slate-600">{n.message}</p><p className="mt-2 text-xs text-slate-400">{new Date(n.createdAt).toLocaleString('vi-VN',{timeZone:'Asia/Saigon'})}</p></button>)}</div>{data.total>10&&<div className="flex justify-between p-3 text-xs border-t"><button disabled={pageBusy||page===1} onClick={()=>setPage(p=>p-1)}>Trang trước</button><span>{page} / {Math.ceil(data.total/10)}</span><button disabled={pageBusy||page*10>=data.total} onClick={()=>setPage(p=>p+1)}>Trang sau</button></div>}</div>}</div>;
}
