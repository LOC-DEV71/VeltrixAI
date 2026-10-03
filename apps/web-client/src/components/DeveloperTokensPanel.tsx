import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {Modal, Pagination} from 'antd';
import toast from 'react-hot-toast';
import {api} from '../api';

type Token = {id:string;name:string;prefix:string;scopes:string[];expiresAt:string;revokedAt:string|null;lastUsedAt:string|null};
const scopes = [{'key':'voices:read',label:'Xem thư viện giọng'}, {key:'tts:write',label:'Tạo TTS (sử dụng Credit)'}, {key:'tts:read',label:'Xem tác vụ và tải audio'}];
export function DeveloperTokensPanel() {
  const [modal, contextHolder] = Modal.useModal();
  const [items,setItems]=useState<Token[]>([]), [total,setTotal]=useState(0), [page,setPage]=useState(1);
  const [loading,setLoading]=useState(true), [busy,setBusy]=useState(false), [error,setError]=useState('');
  const [open,setOpen]=useState(false), [name,setName]=useState(''), [days,setDays]=useState(90), [permissions,setPermissions]=useState(scopes.map(s=>s.key)), [secret,setSecret]=useState('');
  async function load(current=page) {setLoading(true);setError('');try {const r=await api.get('/developer/tokens',{params:{page:current}});setItems(r.data.data.items || []);setTotal(r.data.data.total || 0);}catch {setError('Không tải được danh sách token. Vui lòng thử lại.');}finally {setLoading(false);}}
  useEffect(()=>{void load(page);},[page]);
  async function create() {setBusy(true);try {const r=await api.post('/developer/tokens',{name,scopes:permissions,expiresInDays:days});setSecret(r.data.data.token);setOpen(false);setName('');setPage(1);await load(1);toast.success('Đã tạo API token.');}catch {toast.error('Không tạo được token. Kiểm tra tên, quyền và hạn dùng.');}finally {setBusy(false);}}
  async function revoke(token:Token) {if (!await modal.confirm({title:'Thu hồi API token?',content:`Ứng dụng sử dụng token “${token.name}” sẽ mất quyền gọi API.`,okText:'Thu hồi',cancelText:'Hủy',okButtonProps:{danger:true}})) return;setBusy(true);try {await api.delete('/developer/tokens/'+token.id);await load();toast.success('Đã thu hồi token.');}catch {toast.error('Không thu hồi được token. Vui lòng thử lại.');}finally {setBusy(false);}}
  return <section className="border-t border-slate-100 pt-6 space-y-4">{contextHolder}
    <div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold text-lg">Developer · API TTS</h3><p className="text-sm text-slate-500 mt-1">Tích hợp giọng đọc vào ứng dụng của bạn, sử dụng Credit và quyền của gói hiện tại.</p></div><button onClick={()=>setOpen(true)} disabled={busy} className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm">+ Tạo API token</button></div>
    <Link to="/docs?section=developer" className="inline-block text-sm text-indigo-600">Hướng dẫn tích hợp API →</Link>
    {error && <p role="alert" className="text-red-600 text-sm">{error} <button onClick={()=>void load()} className="underline">Thử lại</button></p>}
    {loading ? <p className="text-sm text-slate-500">Đang tải token...</p> : !items.length ? <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">Chưa có API token. Tạo token để bắt đầu tích hợp.</p> : <ul className="divide-y rounded-xl border border-slate-200">{items.map(t=>{const active=!t.revokedAt && Date.parse(t.expiresAt)>Date.now();return <li key={t.id} className="p-4 flex flex-wrap justify-between gap-3"><div><p className="font-medium">{t.name} <span className="text-xs text-slate-500">· {t.revokedAt?'Đã thu hồi':active?'Đang hoạt động':'Đã hết hạn'}</span></p><p className="text-xs text-slate-500 mt-2">{t.prefix}… · {t.scopes.join(', ')}</p><p className="text-xs text-slate-500 mt-1">Hết hạn: {new Date(t.expiresAt).toLocaleString('vi-VN')} · Dùng gần nhất: {t.lastUsedAt?new Date(t.lastUsedAt).toLocaleString('vi-VN'):'Chưa sử dụng'}</p></div>{!t.revokedAt && <button disabled={busy} onClick={()=>void revoke(t)} className="text-sm text-red-600">Thu hồi</button>}</li>;})}</ul>}
    {total>10 && <Pagination current={page} pageSize={10} total={total} showSizeChanger={false} onChange={setPage}/>}
    <Modal destroyOnHidden title="Tạo API token" open={open} onCancel={()=>!busy && setOpen(false)} onOk={()=>void create()} okText="Tạo token" cancelText="Hủy" confirmLoading={busy} okButtonProps={{disabled:!name.trim() || !permissions.length || !Number.isInteger(days) || days<1 || days>365}}>
      <label className="block my-4">Tên ứng dụng<input className="block w-full border rounded-lg p-2 mt-2" maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder="Ví dụ: Website của tôi"/></label>
      <label className="block my-4">Hạn dùng (ngày, 1–365)<input type="number" min={1} max={365} className="block w-full border rounded-lg p-2 mt-2" value={days} onChange={e=>setDays(Number(e.target.value))}/></label>
      <fieldset className="space-y-2"><legend className="mb-2">Quyền truy cập</legend>{scopes.map(s=><label key={s.key} className="flex gap-2"><input type="checkbox" checked={permissions.includes(s.key)} onChange={e=>setPermissions(p=>e.target.checked?[...p,s.key]:p.filter(k=>k!==s.key))}/>{s.label}</label>)}</fieldset>
    </Modal>
    <Modal destroyOnHidden title="Sao chép token ngay" open={!!secret} onCancel={()=>setSecret('')} footer={<button className="rounded-lg bg-indigo-600 text-white px-4 py-2" onClick={()=>setSecret('')}>Đã lưu token</button>}>
      <p className="my-4 text-sm">Token chỉ hiển thị đầy đủ lần này. Lưu trong biến môi trường ở máy chủ; không đưa vào mã frontend hay chia sẻ công khai.</p><textarea readOnly rows={3} className="w-full border rounded-lg p-3 font-mono text-sm" value={secret}/><button className="my-3 text-indigo-600" onClick={()=>void navigator.clipboard.writeText(secret).then(()=>toast.success('Đã sao chép token.')).catch(()=>toast.error('Hãy sao chép token trong ô phía trên.'))}>Sao chép token</button>
    </Modal>
  </section>;
}
