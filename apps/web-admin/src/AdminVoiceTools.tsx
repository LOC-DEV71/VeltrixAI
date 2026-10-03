import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App, Avatar, Button, Checkbox, Empty, Input, InputNumber, Modal, Pagination, Select, Skeleton } from 'antd';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, AudioLines, Check, FileAudio, GripVertical, ImagePlus, Plus, ShieldCheck } from 'lucide-react';
import { errorMessage } from './userMessages';
import { voiceApi, waitVoiceJob, fileBase64 } from './adminVoiceApi';
import { prepareCloneSample } from './cloneSample';
import { VoiceAuditNote, VoiceIdentity, VoiceJobState } from './voiceUi';
import { voiceGenderLabels, voicePlanLabels, voiceStatusLabels } from './voiceModel';
import type { Voice } from './voiceModel';

type Job = { id: string; status: string };
type Capabilities = { minSeconds: number; maxSeconds: number; maxBytes: number; languages: string[]; maxPreviewCharacters: number };
const initial = () => ({ name: '', language: 'vi-VN', gender: 'unknown', tags: [] as string[], avatarUrl: '', position: 1, planEntitlements: ['*'], isDefault: false, status: 'ACTIVE', text: 'Đây là Veltrix TTS, ứng dụng chuyển đổi văn bản thành giọng nói và sáng tạo nội dung.', reason: '', consent: { hasVoiceRights: false, consentToClone: false, allowSystemUse: false } });
const validTags = (tags: string[]) => tags.length <= 20 && tags.every(tag => !!tag.trim() && tag.trim().length <= 40);
const validAvatar = (value: string) => !value || /^https:\/\/[^\s]+$|^\/voice-avatars\/[\w-]+\.svg$/.test(value);
const unfinished = (job: Job | null) => !!job && !['FAILED', 'COMPLETED'].includes(job.status);

export function VoicePreviewEditor({ voice, disabled, onSaved, onDirtyChange, onClose, hidden = false }: { voice: Voice; disabled: boolean; onSaved: () => Promise<void>; onDirtyChange: (dirty: boolean) => void; onClose: () => void; hidden?: boolean }) {
  const { message } = App.useApp();
  const [text, setText] = useState(voice.previewText || ''), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [discard, setDiscard] = useState(false);
  const [max, setMax] = useState(0), [capError, setCapError] = useState(''), [error, setError] = useState(''), [job, setJob] = useState<Job | null>(null);
  const controller = useRef<AbortController | null>(null), key = useRef(''), sending = useRef(false);
  const dirty = text !== (voice.previewText || '') || !!reason.trim() || busy || unfinished(job);
  const locked = busy || unfinished(job);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const capabilities = useCallback(async () => { setCapError(''); try { const cap = await voiceApi('/capabilities'); setMax(cap.maxPreviewCharacters); } catch (e) { setCapError(errorMessage(e)); } }, []);
  useEffect(() => { queueMicrotask(() => void capabilities()); return () => controller.current?.abort(); }, [capabilities]);
  async function generate(trackOnly = false) {
    if (sending.current || disabled || !trackOnly && (!max || !text.trim() || [...text.trim()].length > max || reason.trim().length < 5 || !confirmed)) return;
    sending.current = true; setBusy(true); setError(''); controller.current = new AbortController();
    try {
      key.current ||= crypto.randomUUID();
      const next = trackOnly && job ? job : await voiceApi('/' + voice.id + '/preview', { text, reason: reason.trim(), expectedVersion: voice.version }, 'POST', key.current);
      setJob(next); await waitVoiceJob(next.id, controller.current.signal, setJob);
      key.current = ''; setReason(''); await onSaved(); message.success('Đã lưu audio mẫu để client nghe thử.'); onClose();
    } catch (e: any) { if (e.terminal) key.current = ''; if (!controller.current.signal.aborted) setError(errorMessage(e)); }
    finally { sending.current = false; setBusy(false); }
  }
  const actions = <div className="vm-modal-footer"><VoiceAuditNote /><Button disabled={locked} onClick={() => dirty ? setDiscard(true) : onClose()}>Quay lại</Button><Button type="primary" disabled={locked || disabled || !max || !text.trim() || [...text.trim()].length > max || reason.trim().length < 5 || !confirmed} icon={<AudioLines size={16} />} onClick={() => void generate()}>{busy ? 'Đang theo dõi Worker...' : 'Tạo audio mẫu'}</Button></div>;
  return <Modal className="stitch-voice-modal vm-preview-modal" open={!hidden} centered width={680} title={<span className="vm-modal-title"><AudioLines size={22} />Tạo audio nghe thử</span>} footer={discard ? null : actions} mask={{ closable: false }} closable={!locked} keyboard={!locked} onCancel={() => { if (!locked) { if (dirty) setDiscard(true); else onClose(); } }}>
    {discard ? <><p className="vm-modal-description">Hủy nội dung audio mẫu chưa lưu? Audio hiện tại vẫn được giữ.</p><div className="vm-modal-footer"><Button onClick={() => setDiscard(false)}>Tiếp tục chỉnh sửa</Button><Button danger onClick={onClose}>Hủy thay đổi</Button></div></> : <><p className="vm-modal-description">Tạo một file nghe thử để dùng trên landing và thư viện phía client. Không trừ Credit của người dùng.</p><div className="vm-modal-identity"><VoiceIdentity voice={voice} /><span className="vm-badge">Phiên bản {voice.version}</span></div>{capError ? <Alert type="error" showIcon title="Không tải được giới hạn audio mẫu" description={capError} action={<Button onClick={() => void capabilities()}>Thử lại</Button>} /> : !max && <Skeleton active paragraph={{ rows: 2 }} />}{error && <Alert type="error" showIcon title="Chưa tạo được audio mẫu" description={error} />}
    <div className="vm-form"><section className="vm-form-section"><header><h2>Nội dung nghe thử</h2><p>Audio mới thay thế mẫu hiện tại sau khi Worker tạo thành công.</p></header><label>Lời đọc<Input.TextArea aria-label="Nội dung nghe thử" value={text} onChange={event => { setText(event.target.value); key.current = ''; setConfirmed(false); }} rows={5} maxLength={max || undefined} showCount disabled={locked || disabled} /></label><label>Lý do cập nhật mẫu<Input aria-label="Lý do cập nhật mẫu" value={reason} onChange={event => { setReason(event.target.value); key.current = ''; }} maxLength={1000} disabled={locked || disabled} placeholder="Nhập ít nhất 5 ký tự..." /></label><Checkbox checked={confirmed} disabled={locked || disabled} onChange={event => setConfirmed(event.target.checked)}>Tôi xác nhận công bố audio mẫu này cho client nghe thử.</Checkbox></section></div>
    <VoiceJobState job={job} busy={busy} onRetry={() => void generate(true)} /></>}
  </Modal>;
}

export function AdminVoiceTools({ tiers, onSaved, onDirtyChange, hidden = false }: { tiers: string[]; onSaved: () => Promise<void>; onDirtyChange: (dirty: boolean) => void; hidden?: boolean }) {
  const { message } = App.useApp();
  const [dialog, setDialog] = useState<'CREATE' | 'ORDER' | null>(null), [draft, setDraft] = useState(initial), [step, setStep] = useState(0);
  const [sample, setSample] = useState<{ base64: string; duration: number; name: string } | null>(null), [avatar, setAvatar] = useState<{ base64: string; name: string } | null>(null);
  const [cap, setCap] = useState<Capabilities | null>(null), [capError, setCapError] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [reading, setReading] = useState(false), [confirmed, setConfirmed] = useState(false), [job, setJob] = useState<Job | null>(null);
  const [order, setOrder] = useState<Voice[]>([]), [originalOrder, setOriginalOrder] = useState(''), [orderPage, setOrderPage] = useState(1), [orderTotal, setOrderTotal] = useState(0), [orderReason, setOrderReason] = useState(''), [orderLoading, setOrderLoading] = useState(false), [dragged, setDragged] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false), [pendingPage, setPendingPage] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null), key = useRef(''), sending = useRef(false), orderRequest = useRef<AbortController | null>(null);
  const orderDirty = dialog === 'ORDER' && (JSON.stringify(order.map(voice => voice.id)) !== originalOrder || !!orderReason.trim());
  const dirty = dialog === 'CREATE' && (JSON.stringify(draft) !== JSON.stringify(initial()) || !!sample || !!avatar || unfinished(job)) || orderDirty || busy || reading;
  const locked = busy || unfinished(job);
  useEffect(() => { onDirtyChange(!!dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => () => { controller.current?.abort(); orderRequest.current?.abort(); }, []);
  const capabilities = useCallback(async () => { setCapError(''); try { setCap(await voiceApi('/capabilities')); } catch (e) { setCapError(errorMessage(e)); } }, []);
  function update(field: string, value: any) { setDraft(previous => ({ ...previous, [field]: value })); key.current = ''; setConfirmed(false); }
  function startCreate() { setDialog('CREATE'); setStep(0); setError(''); setDiscard(false); void capabilities(); }
  function close(force = false) {
    if (locked || reading) return;
    if (dirty && !force) { setPendingPage(null); setDiscard(true); return; }
    orderRequest.current?.abort(); setDialog(null); setDraft(initial()); setSample(null); setAvatar(null); setJob(null); setError(''); setDiscard(false); key.current = '';
  }
  async function chooseSample(file?: File) {
    if (!file) return;
    setReading(true); setError('');
    try {
      if (cap && file.size > cap.maxBytes) throw new Error(`Mẫu tối đa ${cap.maxBytes / 1024 / 1024} MB.`);
      const prepared = await prepareCloneSample(file);
      if (cap && (prepared.duration < cap.minSeconds || prepared.duration > cap.maxSeconds)) throw new Error(`Mẫu phải dài ${cap.minSeconds}–${cap.maxSeconds} giây.`);
      setSample({ base64: await fileBase64(prepared.blob), duration: prepared.duration, name: file.name }); key.current = ''; setConfirmed(false);
    } catch (e) { setError(errorMessage(e)); } finally { setReading(false); }
  }
  async function chooseAvatar(file?: File) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setError('Chọn ảnh PNG, JPG hoặc WebP tối đa 5 MB.'); return; }
    setReading(true);
    try { setAvatar({ base64: await fileBase64(file), name: file.name }); key.current = ''; setConfirmed(false); }
    catch { setError('Không đọc được ảnh.'); } finally { setReading(false); }
  }
  const identityValid = !!cap && !!draft.name.trim() && cap.languages.includes(draft.language) && validTags(draft.tags) && validAvatar(draft.avatarUrl);
  const accessValid = draft.planEntitlements.length > 0 && Number.isSafeInteger(draft.position) && draft.position >= 1 && draft.position <= 100000 && (!draft.isDefault || draft.status === 'ACTIVE' && draft.planEntitlements.includes('*'));
  const canCreate = identityValid && accessValid && sample && draft.text.trim() && [...draft.text.trim()].length <= (cap?.maxPreviewCharacters || 0) && draft.reason.trim().length >= 5 && Object.values(draft.consent).every(Boolean) && confirmed;
  async function create(trackOnly = false) {
    if (sending.current || !trackOnly && (!canCreate || reading || !sample)) return;
    sending.current = true; setBusy(true); setError(''); controller.current = new AbortController();
    try {
      key.current ||= crypto.randomUUID();
      const next = trackOnly && job ? job : await voiceApi('', { ...draft, name: draft.name.trim(), reason: draft.reason.trim(), audioBase64: sample!.base64, ...(avatar ? { avatarUpload: { base64: avatar.base64 } } : {}) }, 'POST', key.current);
      setJob(next); await onSaved(); await waitVoiceJob(next.id, controller.current.signal, setJob);
      setDialog(null); setDraft(initial()); setSample(null); setAvatar(null); setJob(null); key.current = ''; await onSaved(); message.success('Đã tạo giọng hệ thống và audio nghe thử.');
    } catch (e: any) { if (e.terminal) key.current = ''; if (!controller.current.signal.aborted) { setError(errorMessage(e)); await onSaved(); } }
    finally { sending.current = false; setBusy(false); }
  }
  async function loadOrder(page = 1) {
    orderRequest.current?.abort(); const request = new AbortController(); orderRequest.current = request;
    setOrderLoading(true); setError(''); setOrder([]); setOriginalOrder(''); setOrderReason(''); setDialog('ORDER');
    try { const result = await voiceApi('/order?page=' + page + '&limit=10', undefined, 'GET', undefined, request.signal); if (!request.signal.aborted) { setOrderPage(page); setOrderTotal(result.total); setOrder(result.items); setOriginalOrder(JSON.stringify(result.items.map((voice: Voice) => voice.id))); setOrderReason(''); } }
    catch (e) { if (!request.signal.aborted) setError(errorMessage(e)); }
    finally { if (!request.signal.aborted) setOrderLoading(false); }
  }
  function requestPage(value: number) { if (orderDirty) { setPendingPage(value); setDiscard(true); } else void loadOrder(value); }
  function move(id: string, index: number) {
    setOrder(items => { const source = items.findIndex(voice => voice.id === id); if (source < 0 || index < 0 || index >= items.length) return items; const next = [...items], [item] = next.splice(source, 1); next.splice(index, 0, item); return next; });
  }
  async function saveOrder() {
    if (sending.current || !orderDirty || orderReason.trim().length < 5 || orderLoading) return;
    sending.current = true; setBusy(true); setError('');
    try { await voiceApi('/order', { page: orderPage, items: order.map(voice => ({ id: voice.id, version: voice.version })), reason: orderReason.trim() }, 'POST'); setDialog(null); await onSaved(); message.success('Đã lưu thứ tự giọng hiển thị cho client.'); }
    catch (e) { setError(errorMessage(e)); } finally { sending.current = false; setBusy(false); }
  }
  const createActions = <div className="vm-modal-footer"><VoiceAuditNote />{step > 0 ? <Button disabled={locked || reading} icon={<ArrowLeft size={15} />} onClick={() => setStep(value => value - 1)}>Quay lại</Button> : <Button disabled={locked || reading} onClick={() => close()}>Hủy</Button>}{step < 2 ? <Button type="primary" icon={<ArrowRight size={15} />} disabled={reading || locked || (step === 0 ? !identityValid : !accessValid || !Object.values(draft.consent).every(Boolean))} onClick={() => setStep(value => value + 1)}>Tiếp tục</Button> : <Button type="primary" disabled={!canCreate || reading || locked} icon={<Plus size={15} />} onClick={() => void create()}>{busy ? 'Đang theo dõi Worker...' : 'Tạo giọng & audio mẫu'}</Button>}</div>;
  const orderActions = <div className="vm-modal-footer"><VoiceAuditNote /><Button disabled={busy} onClick={() => close()}>Quay lại</Button><Button type="primary" disabled={busy || orderLoading || !order.length || JSON.stringify(order.map(voice => voice.id)) === originalOrder || orderReason.trim().length < 5} icon={<Check size={16} />} onClick={() => void saveOrder()}>{busy ? 'Đang lưu...' : 'Lưu thứ tự'}</Button></div>;
  return <><Button icon={<GripVertical size={16} />} disabled={busy} onClick={() => { setDiscard(false); void loadOrder(); }}>Sắp xếp giọng</Button><Button type="primary" icon={<Plus size={16} />} onClick={startCreate}>Tạo giọng hệ thống</Button>
    <Modal className={`stitch-voice-modal ${dialog === 'CREATE' ? 'system-voice-create-modal' : 'vm-order-modal'}`} open={!!dialog && !hidden} centered width={dialog === 'CREATE' ? 800 : 680} title={<span className="vm-modal-title">{dialog === 'CREATE' ? <MicIcon /> : <GripVertical size={22} />}{dialog === 'CREATE' ? 'Tạo giọng hệ thống mới' : 'Sắp xếp giọng hệ thống'}</span>} footer={discard ? null : dialog === 'CREATE' ? createActions : orderActions} mask={{ closable: false }} closable={!locked && !reading} keyboard={!locked && !reading} onCancel={() => close()}>
    {discard ? <><p className="vm-modal-description">{pendingPage ? 'Chuyển trang sẽ bỏ thứ tự chưa lưu trên trang hiện tại.' : 'Nội dung chưa lưu sẽ bị hủy. Bạn có muốn tiếp tục?'}</p><div className="vm-modal-footer"><Button onClick={() => { setDiscard(false); setPendingPage(null); }}>Tiếp tục chỉnh sửa</Button><Button danger onClick={() => { if (pendingPage) { const value = pendingPage; setPendingPage(null); setDiscard(false); void loadOrder(value); } else close(true); }}>Hủy thay đổi</Button></div></> : dialog === 'CREATE' ? <>
      <p className="vm-modal-description">Nhân bản từ mẫu được cấp quyền, tạo giọng dùng chung và audio nghe thử cho client.</p><nav className="vm-create-steps" aria-label="Các bước tạo giọng">{['Thông tin giọng', 'Quyền & hiển thị', 'Mẫu & xác nhận'].map((label, index) => <span key={label} className={index === step ? 'current' : index < step ? 'done' : ''}><i>{index < step ? <Check size={12} /> : index + 1}</i>{label}</span>)}</nav>
      {capError && <Alert showIcon type="error" title="Không tải được cấu hình tạo giọng" description={capError} action={<Button onClick={() => void capabilities()}>Thử lại</Button>} />}{!cap && !capError && <Skeleton active paragraph={{ rows: 2 }} />}{error && <Alert showIcon type="error" title="Chưa thực hiện được yêu cầu" description={error} />}
      <div className="vm-form voice-edit-form">
      {step === 0 && <section className="vm-form-section"><header><h2>Thông tin giọng</h2><p>Tên và đặc điểm hiển thị trong thư viện. Có thể chỉnh sửa sau khi tạo.</p></header><label>Tên hiển thị<Input aria-label="Tên giọng hệ thống mới" value={draft.name} maxLength={100} disabled={locked} onChange={event => update('name', event.target.value)} placeholder="Nhập tên giọng..." /></label><div className="vm-field-grid"><label>Ngôn ngữ<Select aria-label="Ngôn ngữ giọng mới" value={draft.language} options={(cap?.languages || []).map(value => ({ value, label: value === 'vi-VN' ? 'Tiếng Việt' : value }))} disabled={locked} onChange={value => update('language', value)} /></label><label>Giới tính<Select aria-label="Giới tính giọng mới" value={draft.gender} disabled={locked} onChange={value => update('gender', value)} options={Object.entries(voiceGenderLabels).map(([value, label]) => ({ value, label }))} /></label></div><label>Tag / Đặc điểm giọng<Select mode="tags" aria-label="Tag giọng hệ thống mới" maxCount={20} tokenSeparators={[',']} value={draft.tags} disabled={locked} onChange={value => update('tags', value)} placeholder="Miền Bắc, Lịch sự, Bản tin..." /><small>Tối đa 20 tag, mỗi tag từ 1 đến 40 ký tự.</small>{!validTags(draft.tags) && <span className="vm-validation">Kiểm tra lại độ dài tag.</span>}</label><label>URL ảnh đại diện<Input aria-label="URL ảnh giọng mới" value={draft.avatarUrl} maxLength={2048} disabled={locked || !!avatar} onChange={event => update('avatarUrl', event.target.value)} placeholder="https://… hoặc /voice-avatars/…svg" /></label><label className="vm-file-upload"><ImagePlus size={20} /><strong>Tải ảnh lên Cloudinary</strong><span>PNG, JPG, WebP · Tối đa 5 MB</span><input aria-label="Ảnh giọng hệ thống mới" type="file" accept="image/png,image/jpeg,image/webp" disabled={locked || reading} onChange={event => { void chooseAvatar(event.target.files?.[0]); event.target.value = ''; }} />{avatar && <small>{avatar.name} · /veltrixai/voice-avatars/</small>}</label>{avatar && <Button disabled={locked} size="small" onClick={() => { setAvatar(null); key.current = ''; setConfirmed(false); }}>Bỏ ảnh đã chọn</Button>}</section>}
      {step === 1 && <section className="vm-form-section"><header><h2>Quyền sử dụng & hiển thị</h2><p>Giọng sẽ được chia sẻ cho các gói được chọn sau khi tạo thành công.</p></header><label>Gói được sử dụng<Select mode="multiple" aria-label="Gói giọng hệ thống mới" value={draft.planEntitlements} disabled={locked} onChange={value => update('planEntitlements', value)} options={['*', ...tiers].map(value => ({ value, label: voicePlanLabels[value] || value }))} /></label><div className="vm-field-grid"><label>Vị trí hiển thị<InputNumber aria-label="Vị trí giọng hệ thống mới" min={1} max={100000} precision={0} value={draft.position} disabled={locked} onChange={value => update('position', value)} /><small>Số nhỏ hơn hiển thị trước.</small></label><label>Trạng thái sau khi tạo<Select aria-label="Trạng thái giọng hệ thống mới" value={draft.status} disabled={locked} onChange={value => update('status', value)} options={[{ value: 'ACTIVE', label: 'Đang hoạt động' }, { value: 'REVOKED', label: 'Chưa công bố' }]} /></label></div><Checkbox checked={draft.isDefault} disabled={locked} onChange={event => update('isDefault', event.target.checked)}>Dùng làm giọng mặc định</Checkbox><p className="vm-caption">Giọng mặc định phải hoạt động và dành cho tất cả các gói.</p>{!accessValid && <Alert type="warning" showIcon title="Kiểm tra gói sử dụng, vị trí và điều kiện giọng mặc định." />}<div className="vm-consents"><h3>Quyền đối với mẫu giọng</h3><Checkbox checked={draft.consent.hasVoiceRights} disabled={locked} onChange={event => update('consent', { ...draft.consent, hasVoiceRights: event.target.checked })}>Tôi có quyền sử dụng audio và giọng nói này.</Checkbox><Checkbox checked={draft.consent.consentToClone} disabled={locked} onChange={event => update('consent', { ...draft.consent, consentToClone: event.target.checked })}>Chủ giọng đồng ý nhân bản giọng nói.</Checkbox><Checkbox checked={draft.consent.allowSystemUse} disabled={locked} onChange={event => update('consent', { ...draft.consent, allowSystemUse: event.target.checked })}>Tôi có quyền cung cấp giọng này cho người dùng hệ thống.</Checkbox></div></section>}
      {step === 2 && <section className="vm-form-section"><header><h2>Mẫu giọng & audio nghe thử</h2><p>Worker chỉ công bố giọng sau khi xử lý thành công.</p></header><Alert type="info" showIcon title={cap ? `WAV dài ${cap.minSeconds}–${cap.maxSeconds} giây · Tối đa ${cap.maxBytes / 1024 / 1024} MB` : 'Đang tải cấu hình...'} description="Chọn đoạn lời nói rõ tiếng, không nhạc nền. Mẫu tham chiếu được bảo vệ." /><label className="vm-file-upload"><FileAudio size={24} /><strong>{sample?.name || 'Chọn audio tham chiếu'}</strong><span>{reading ? 'Đang kiểm tra tệp...' : sample ? `${sample.duration.toFixed(2)} giây · WAV đã kiểm tra` : 'Tệp WAV chứa mẫu giọng được cấp quyền'}</span><input aria-label="Audio tham chiếu giọng hệ thống" type="file" accept=".wav,audio/wav" disabled={locked || reading} onChange={event => { void chooseSample(event.target.files?.[0]); event.target.value = ''; }} /></label><label>Nội dung audio nghe thử<Input.TextArea aria-label="Nội dung mẫu giọng mới" rows={4} maxLength={cap?.maxPreviewCharacters} showCount value={draft.text} disabled={locked} onChange={event => update('text', event.target.value)} /></label><label>Lý do tạo giọng<Input.TextArea aria-label="Lý do tạo giọng hệ thống" rows={2} maxLength={1000} showCount value={draft.reason} disabled={locked} onChange={event => update('reason', event.target.value)} placeholder="Nhập ít nhất 5 ký tự..." /></label><div className="vm-create-review"><header><ShieldCheck size={17} /><strong>Kiểm tra trước khi tạo</strong></header><dl><div><dt>Tên giọng</dt><dd>{draft.name}</dd></div><div><dt>Quyền sử dụng</dt><dd>{draft.planEntitlements.map(value => voicePlanLabels[value] || value).join(', ')}</dd></div><div><dt>Vị trí / Trạng thái</dt><dd>{draft.position} · {voiceStatusLabels[draft.status]}</dd></div><div><dt>Giọng mặc định</dt><dd>{draft.isDefault ? 'Có' : 'Không'}</dd></div><div><dt>Ảnh đại diện</dt><dd>{avatar?.name || draft.avatarUrl || 'Dùng chữ cái tên giọng'}</dd></div></dl></div><Checkbox checked={confirmed} disabled={locked} onChange={event => setConfirmed(event.target.checked)}>Tôi xác nhận tạo giọng hệ thống với thông tin và quyền sử dụng trên.</Checkbox></section>}
      </div><VoiceJobState job={job} busy={busy} onRetry={() => void create(true)} />
    </> : <><p className="vm-modal-description">Kéo thả hoặc dùng nút lên / xuống. Thay đổi áp dụng cho thứ tự thư viện phía client.</p>{error && <Alert showIcon type="error" title="Chưa cập nhật được thứ tự" description={error} action={<Button disabled={busy} onClick={() => void loadOrder(orderPage)}>Tải lại</Button>} />}{orderLoading ? <div className="vm-order-loading"><Skeleton active avatar paragraph={{ rows: 5 }} /></div> : order.length ? <><ol className="voice-order-list vm-order-list">{order.map((voice, index) => <li key={voice.id} draggable={!busy} className={dragged === voice.id ? 'dragging' : ''} onDragStart={event => { setDragged(voice.id); event.dataTransfer.setData('text/plain', voice.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDragged(null)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = dragged || event.dataTransfer.getData('text/plain'); if (id) move(id, index); setDragged(null); }}><GripVertical size={18} /><span>{(orderPage - 1) * 10 + index + 1}</span><Avatar src={voice.avatarUrl} shape="square">{voice.name?.charAt(0)}</Avatar><strong>{voice.name}</strong><Button aria-label={`Đưa ${voice.name} lên`} icon={<ArrowUp size={14} />} disabled={busy || index === 0} onClick={() => move(voice.id, index - 1)} /><Button aria-label={`Đưa ${voice.name} xuống`} icon={<ArrowDown size={14} />} disabled={busy || index === order.length - 1} onClick={() => move(voice.id, index + 1)} /></li>)}</ol><div className="vm-order-pagination"><span>{orderTotal} giọng · 10 giọng / trang</span><Pagination current={orderPage} total={orderTotal} pageSize={10} showSizeChanger={false} disabled={busy} onChange={requestPage} /></div><label className="vm-reason-label">Lý do thay đổi<Input aria-label="Lý do sắp xếp giọng" value={orderReason} onChange={event => setOrderReason(event.target.value)} maxLength={1000} disabled={busy} placeholder="Nhập ít nhất 5 ký tự..." /></label></> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có giọng hệ thống để sắp xếp." />}</>}
    </Modal>
  </>;
}
function MicIcon() { return <AudioLines size={22} />; }
