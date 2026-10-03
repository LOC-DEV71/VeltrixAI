import { Avatar, Button, Typography } from 'antd';
import { AudioLines, CheckCircle2, Clock3, ShieldCheck } from 'lucide-react';

import { voiceStatusLabels, voiceGenderLabels } from './voiceModel';
import type { Voice } from './voiceModel';
export function VoiceStatus({ status }: { status: string }) { return <span className={`vm-badge status-${status.toLowerCase()}`}><i />{voiceStatusLabels[status] || status}</span>; }
export function VoiceIdentity({ voice, large = false }: { voice: Voice; large?: boolean }) { return <div className={`vm-identity${large ? ' large' : ''}`}><Avatar src={voice.avatarUrl} size={large ? 64 : 44} shape="square">{voice.name?.charAt(0).toUpperCase()}</Avatar><div><strong>{voice.name}</strong><small>{voice.language === 'vi-VN' ? 'Tiếng Việt' : voice.language} · {voiceGenderLabels[voice.gender] || voice.gender}</small></div>{voice.isDefault && <span className="vm-default">Mặc định</span>}</div>; }
export function VoiceJobState({ job, onRetry, busy }: { job: { id: string; status: string } | null; onRetry?: () => void; busy?: boolean }) {
  if (!job) return null;
  const complete = job.status === 'COMPLETED', failed = job.status === 'FAILED';
  return <section className={`vm-job-state ${complete ? 'complete' : failed ? 'failed' : ''}`} aria-live="polite"><header>{complete ? <CheckCircle2 size={18} /> : job.status === 'PROCESSING' ? <AudioLines size={18} /> : <Clock3 size={18} />}<strong>{complete ? 'Worker đã hoàn tất' : failed ? 'Tác vụ thất bại' : job.status === 'PROCESSING' ? 'Worker đang xử lý' : 'Đã tiếp nhận vào hàng đợi'}</strong></header><p>Trạng thái lấy trực tiếp từ tác vụ hệ thống.</p><Typography.Text copyable={{ text: job.id }}>Job ID: {job.id}</Typography.Text>{onRetry && !busy && !complete && !failed && <Button size="small" onClick={onRetry}>Theo dõi lại</Button>}</section>;
}
export function VoiceAuditNote() { return <span className="vm-audit-note"><ShieldCheck size={15} />Thao tác được ghi vào nhật ký hệ thống</span>; }
