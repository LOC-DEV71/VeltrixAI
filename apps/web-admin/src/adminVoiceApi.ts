export async function voiceApi(path: string, body?: unknown, method = 'GET', key?: string, signal?: AbortSignal) {
  let csrf = '';
  if (body) {
    const response = await fetch('/api/admin/auth/csrf', { credentials: 'include' });
    const result = await response.json(); csrf = result.data?.csrfToken || '';
    if (!response.ok || !csrf) throw new Error('CSRF_UNAVAILABLE');
  }
  const response = await fetch('/api/admin/voices' + path, { method, credentials: 'include', signal,
    headers: { 'Content-Type': 'application/json', ...(body ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error?.code || 'REQUEST_FAILED'), { code: result.error?.code, status: response.status });
  return result.data;
}
export async function waitVoiceJob(id: string, signal: AbortSignal, onStatus?: (job: any) => void) {
  for (let i = 0; i < 900; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const job = await voiceApi('/jobs/' + id, undefined, 'GET', undefined, signal);
    onStatus?.(job);
    if (job.status === 'COMPLETED') return job;
    if (job.status === 'FAILED') throw Object.assign(new Error(job.error || 'VOICE_PROVISIONING_FAILED'), { code: job.error, terminal: true });
    await new Promise<void>(resolve => { const timer = setTimeout(done, 1000); function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); } signal.addEventListener('abort', done, { once: true }); });
  }
  throw new Error('VOICE_JOB_WAIT_TIMEOUT');
}
export function fileBase64(file: Blob) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
}
