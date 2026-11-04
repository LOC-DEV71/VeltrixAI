import {useEffect, useRef, useState} from 'react';
import {ArrowRight, ImagePlus, MessageCircle, RefreshCw, Send, Sparkles, SquarePen, X} from 'lucide-react';
import {articles} from './articles';
import {clientReferenceUrl} from './config';
import './reference.css';
import {askSupport, SupportApiError} from './supportApi';
import {supportLoginUrl, useSupportSession} from './SupportSession';
import {SupportBillingPanel} from './SupportBillingPanel';
import {prepareChatImage} from './chatImage';
import type {ChatImage, ChatImagePreview} from './chatImage';

type Reference = {id:string; title:string; url:string};
type ImageObservation = {description:string;visibleText:string[]};
type Message = {id: string; role: 'user' | 'assistant'; content: string; image?:ChatImagePreview; imageObservation?:ImageObservation; sources?: string[]; references?:Reference[]; reviewRefund?:boolean};
type Pending = {requestId: string; messages: {role: 'user' | 'assistant'; content: string}[]; memory:string; imageBase64?:string};
const suggestions = ['Credit tạm giữ là gì?', 'Vì sao tài khoản Free không đăng nhập được?', 'Làm sao tạo API token?'];

export function SupportChat({onOpenArticle}: {onOpenArticle: (id: string) => void}) {
  const {user, state, error: sessionError, recheck} = useSupportSession();
  const [open, setOpen] = useState(() => new URL(window.location.href).searchParams.get('chat') === '1');
  const [checking, setChecking] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [memory, setMemory] = useState('');
  const [billingOpen,setBillingOpen]=useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<Pending | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [clearing, setClearing] = useState(false);
  const [image, setImage] = useState<ChatImage | null>(null);
  const [preparingImage, setPreparingImage] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageGeneration = useRef(0);
  const imagePreparingRef = useRef(false);
  const imageUrls = useRef(new Set<string>());
  const formRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const activeRef = useRef(false);
  const mountedRef = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);
  const waitSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  useEffect(() => {
    if (!open) return;
    formRef.current?.focus();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && panelRef.current?.contains(document.activeElement)) {
        setOpen(false); openerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open]);

  useEffect(() => {if (open) bottomRef.current?.scrollIntoView({behavior: 'smooth', block: 'nearest'});}, [open, messages, busy, error]);
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [cooldownUntil]);
  useEffect(() => {
    mountedRef.current = true;
    const urls = imageUrls.current;
    return () => {mountedRef.current = false; imageGeneration.current++; controllerRef.current?.abort(); for (const url of urls) URL.revokeObjectURL(url); urls.clear();};
  }, []);

  async function attachImage(file: File) {
    if (!user || activeRef.current || retry || messages.length >= 20 || imagePreparingRef.current) return;
    const generation = ++imageGeneration.current;
    imagePreparingRef.current = true;
    setPreparingImage(true); setError('');
    try {
      const prepared = await prepareChatImage(file);
      if (!mountedRef.current || generation !== imageGeneration.current) {URL.revokeObjectURL(prepared.url); return;}
      if (image) {URL.revokeObjectURL(image.url); imageUrls.current.delete(image.url);}
      imageUrls.current.add(prepared.url);
      setImage(prepared);
    } catch (caught) {
      if (mountedRef.current && generation === imageGeneration.current) setError(caught instanceof Error ? caught.message : 'Không đọc được ảnh.');
    } finally {
      if (generation === imageGeneration.current) {imagePreparingRef.current = false; if (mountedRef.current) setPreparingImage(false);}
    }
  }

  function removeImage() {
    if (image) {URL.revokeObjectURL(image.url); imageUrls.current.delete(image.url);}
    setImage(null);
  }

  async function requestAnswer(pending: Pending) {
    if (!user || activeRef.current || Date.now() < cooldownUntil) return;
    activeRef.current = true;
    setBusy(true); setError(''); setRetry(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), pending.imageBase64 ? 110000 : 95000);
    try {
      const data = await askSupport(pending, controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      if (typeof data?.answer !== 'string' || !data.answer.trim()) throw new Error('AI chưa trả lời được câu hỏi này.');
      if (typeof data.memory !== 'string' || !data.memory.trim() || data.memory.length > 1800) throw new Error('Chưa cập nhật được ngữ cảnh hội thoại. Vui lòng thử lại.');
      const knownSources = Array.isArray(data.sources) ? data.sources.filter((id: unknown) => articles.some(article => article.id === id)).slice(0, 3) : [];
      const references: Reference[] = Array.isArray(data.references) ? data.references.flatMap((reference: any) => {
        const url = clientReferenceUrl(reference?.path);
        return url && typeof reference?.id === 'string' && typeof reference?.title === 'string' && Array.isArray(data.sources) && data.sources.includes(reference.id) ? [{id:reference.id,title:reference.title.slice(0,180),url}] : [];
      }).slice(0,3) : [];
      const observed = data.imageObservation;
      const imageObservation:ImageObservation|undefined = observed && typeof observed.description === 'string' && observed.description.length <= 400 && Array.isArray(observed.visibleText) && observed.visibleText.length <= 24 && observed.visibleText.every((text:unknown) => typeof text === 'string' && text.length <= 240) ? {description:observed.description,visibleText:observed.visibleText} : undefined;
      setMessages(current => [...current, {id: crypto.randomUUID(), role: 'assistant', content: data.answer, imageObservation, sources: knownSources, references,reviewRefund:Array.isArray(data.actions)&&data.actions.includes('review-renewal-refund')}]);
      setMemory(data.memory);
    } catch (caught) {
      if (!mountedRef.current || controllerRef.current !== controller) return;
      if (caught instanceof SupportApiError && caught.status === 429) {
        setCooldownUntil(Date.now() + ((caught as SupportApiError & {retryAfter?: number}).retryAfter || 10) * 1000);
        setNow(Date.now());
      }
      if (caught instanceof SupportApiError && caught.status === 401) void recheck();
      setError(controller.signal.aborted ? 'AI mất nhiều thời gian hơn dự kiến. Bạn có thể thử lại sau.' : caught instanceof TypeError ? 'Không kết nối được trợ lý AI. Kiểm tra kết nối hoặc thử lại sau; các hướng dẫn vẫn dùng được.' : caught instanceof Error ? caught.message : 'Không thể gửi câu hỏi. Vui lòng thử lại.');
      setRetry(pending);
    } finally {
      window.clearTimeout(timeout); controllerRef.current = null;
      activeRef.current = false; if (mountedRef.current) setBusy(false);
    }
  }

  function send(text = input) {
    const question = text.trim() || (image ? 'Hãy đọc ảnh tôi gửi và giúp tôi hiểu nội dung hoặc lỗi trong ảnh.' : '');
    if (!user || !question || question.length > 1000 || activeRef.current || imagePreparingRef.current || Date.now() < cooldownUntil || retry) return;
    if (messages.length >= 20) {setError('Hội thoại đã có 10 câu hỏi. Hãy bắt đầu cuộc trò chuyện mới để tiếp tục.'); return;}
    let history = messages.slice(-6).map(({role, content}) => ({role, content}));
    const current = {role: 'user' as const, content: question};
    while (history.length && JSON.stringify([...history, current]).length > 6000) history = history.slice(2);
    const pending: Pending = {requestId: crypto.randomUUID(), messages: [...history, current],memory,...(image ? {imageBase64:image.base64} : {})};
    const preview = image ? {name:image.name,url:image.url,width:image.width,height:image.height} : undefined;
    setMessages(value => [...value, {...current, id: pending.requestId, image:preview}]);
    setImage(null);
    setInput(''); setClearing(false);
    void requestAnswer(pending);
  }

  function newConversation() {
    if (activeRef.current) return;
    imageGeneration.current++; imagePreparingRef.current = false; setPreparingImage(false);
    for (const url of imageUrls.current) URL.revokeObjectURL(url);
    imageUrls.current.clear(); setImage(null);
    setMessages([]); setMemory(''); setBillingOpen(false); setInput(''); setError(''); setRetry(null); setClearing(false);
    formRef.current?.focus();
  }

  return <>
    {open && <section ref={panelRef} className="chat-panel" role="region" aria-labelledby="chat-title">
      <header className="chat-header"><span className="chat-avatar"><Sparkles size={21} /></span><div><h2 id="chat-title">Trợ lý Veltrix AI</h2><p>{user ? `Hỗ trợ ${user.displayName || user.email}` : 'Hướng dẫn bạn sử dụng Veltrix'}</p></div>{user && <button className="icon-button" title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới" disabled={busy} onClick={() => messages.length ? setClearing(value => !value) : newConversation()}><SquarePen size={18} /></button>}<button className="icon-button" aria-label="Đóng chat AI" onClick={() => {setOpen(false); openerRef.current?.focus();}}><X size={20} /></button></header>
      {user&&<div className="chat-tools"><button aria-pressed={!billingOpen} onClick={()=>setBillingOpen(false)}>Chat AI</button><button aria-pressed={billingOpen} onClick={()=>setBillingOpen(true)}>Gia hạn & hoàn tiền</button></div>}
      {!user ? <div className="chat-messages"><div className="chat-welcome chat-session"><span className="chat-welcome-icon"><MessageCircle size={27} strokeWidth={1.6} /></span>{state === 'loading' || checking ? <><h3>Đang nhận phiên Creator</h3><div className="session-skeleton" role="status" aria-label="Đang kiểm tra phiên đăng nhập"><span /><span /><span /></div></> : <><h3>Đăng nhập để chat với AI</h3><p>AI dùng tên và email từ tài khoản Creator để biết đang hỗ trợ ai. Bạn vẫn có thể đọc và tìm kiếm mọi hướng dẫn mà không cần đăng nhập.</p>{state === 'error' && <p role="alert">{sessionError}</p>}{supportLoginUrl(true) ? <a className="button button-primary" href={supportLoginUrl(true)!}>Đăng nhập bằng Creator<ArrowRight size={16} /></a> : <p>Chưa cấu hình địa chỉ đăng nhập Creator.</p>}<button className="chat-session-retry" disabled={checking} onClick={async () => {setChecking(true); try {await recheck();} finally {setChecking(false);}}}><RefreshCw size={14} />{state === 'error' ? 'Thử lại kết nối' : 'Đã đăng nhập ở Creator? Kiểm tra lại'}</button></>}</div></div> : billingOpen?<SupportBillingPanel/>:<>
      {clearing && <div className="chat-clear"><p>Xóa cuộc trò chuyện trong tab này?</p><button onClick={newConversation}>Bắt đầu mới</button><button onClick={() => setClearing(false)}>Giữ lại</button></div>}
      <div className="chat-messages" aria-busy={busy}>
        {!messages.length && <div className="chat-welcome"><span className="chat-welcome-icon"><MessageCircle size={27} strokeWidth={1.6} /></span><h3>Chào {user.displayName || user.email}!</h3><p>Hỏi về Credit, giọng đọc, tài khoản hoặc tích hợp API. Tôi sẽ tìm câu trả lời từ hướng dẫn Veltrix.</p><div className="chat-suggestions">{suggestions.map(question => <button key={question} onClick={() => send(question)} disabled={busy || waitSeconds > 0}>{question}<ArrowRight size={14} /></button>)}</div></div>}
        <div className="chat-log" role="log" aria-live="polite" aria-relevant="additions">{messages.map(message => <div key={message.id} className={`chat-message ${message.role}`}><span className="chat-message-label">{message.role === 'user' ? 'Bạn' : 'Veltrix AI'}</span>{message.image && <figure className="chat-sent-image"><img src={message.image.url} alt={`Ảnh đã gửi: ${message.image.name}`} /><figcaption>{message.image.name}</figcaption></figure>}<p>{message.content}</p>{message.imageObservation && <details className="chat-image-reading"><summary>Nội dung đọc được trong ảnh</summary><p>{message.imageObservation.description}</p>{message.imageObservation.visibleText.length > 0 && <pre>{message.imageObservation.visibleText.join('\n')}</pre>}</details>}{message.reviewRefund&&<div className="chat-sources"><button onClick={()=>setBillingOpen(true)}>Kiểm tra đơn gia hạn<ArrowRight size={13}/></button></div>}{message.sources?.length ? <div className="chat-sources"><span>Hướng dẫn liên quan</span>{message.sources.map(id => <button key={id} onClick={() => {onOpenArticle(id); setOpen(false);}}>{articles.find(article => article.id === id)?.title}<ArrowRight size={13} /></button>)}</div> : null}{message.references?.length ? <div className="chat-sources"><span>Mở trang liên quan</span>{message.references.map(reference => <a key={reference.id} href={reference.url} target="_blank" rel="noopener noreferrer">{reference.title}<ArrowRight size={13} /></a>)}</div> : null}</div>)}</div>
        {busy && <div className="chat-pending" role="status"><span className="chat-pending-dot" />{messages.at(-1)?.image ? 'AI đang đọc ảnh và trả lời…' : 'AI đang đọc hướng dẫn và trả lời…'}</div>}
        {error && <div className="chat-error" role="alert"><p>{error}</p>{retry && <button onClick={() => void requestAnswer(retry)} disabled={busy || waitSeconds > 0}>{waitSeconds ? `Thử lại sau ${waitSeconds}s` : 'Thử lại câu hỏi này'}</button>}<button disabled={busy} onClick={newConversation}>Cuộc trò chuyện mới</button></div>}
        <div ref={bottomRef} />
      </div>
      <div className="chat-composer-area">
        <p className="chat-privacy">Ảnh gửi cho AI Veltrix phân tích. Không gửi mật khẩu, OTP hoặc token.</p>
        {preparingImage && <p className="chat-image-loading" role="status">Đang kiểm tra ảnh…</p>}
        {image && <div className="chat-image-draft"><img src={image.url} alt="Ảnh chờ gửi" /><div><strong>{image.name}</strong><span>{image.width} × {image.height} · Chưa gửi</span></div><button type="button" className="icon-button" aria-label="Bỏ ảnh đính kèm" disabled={preparingImage} onClick={removeImage}><X size={16} /></button></div>}
        <input ref={fileRef} className="chat-file-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Chọn ảnh hỗ trợ" onChange={event => {const file = event.target.files?.[0]; event.target.value = ''; if (file) void attachImage(file);}} />
        <form className="chat-composer" onSubmit={event => {event.preventDefault(); send();}} onPaste={event => {
          const files = Array.from(event.clipboardData.items).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => !!file);
          if (!files.length) return; // Keep ordinary text paste, including file paths.
          event.preventDefault();
          if (files.length !== 1) {setError('Mỗi lượt gửi một ảnh. Hãy chọn ảnh cần hỗ trợ.'); return;}
          void attachImage(files[0]);
        }}>
          <button type="button" className="chat-attach-button" aria-label="Đính kèm ảnh" title="Chọn ảnh hoặc dán Ctrl/Cmd + V · PNG, JPG, WebP · 3 MB" disabled={busy || !!retry || preparingImage || messages.length >= 20} onClick={() => fileRef.current?.click()}><ImagePlus size={18} /></button>
          <textarea ref={formRef} rows={2} maxLength={1000} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => {if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {event.preventDefault(); send();}}} disabled={busy || !!retry || messages.length >= 20} aria-label="Câu hỏi cho AI" placeholder={retry ? 'Thử lại câu hỏi hoặc bắt đầu cuộc trò chuyện mới' : 'Nhập câu hỏi hoặc dán ảnh…'} />
          <button type="submit" aria-label="Gửi câu hỏi" disabled={busy || !!retry || preparingImage || (!input.trim() && !image) || waitSeconds > 0 || messages.length >= 20}><Send size={18} /></button>
        </form>
        <div className="chat-composer-meta"><span>{messages.length >= 20 ? 'Đã đủ 10 câu hỏi · Bấm nút viết mới để tiếp tục' : waitSeconds ? `Chờ ${waitSeconds}s trước lượt tiếp theo` : 'Enter gửi · Shift + Enter xuống dòng · Ctrl/Cmd + V dán ảnh'}</span><span>{input.length}/1.000</span></div>
        <p className="chat-footnote">AI có thể trả lời chưa chính xác · Hội thoại chỉ giữ trong tab này</p>
      </div>
      </>}
    </section>}
    <button ref={openerRef} className={`chat-launcher ${open ? 'open' : ''}`} aria-label={open ? 'Thu gọn chat AI' : 'Chat với AI hỗ trợ'} aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? <X size={23} /> : <><MessageCircle size={22} /><span>Hỏi Veltrix AI</span></>}</button>
  </>;
}
