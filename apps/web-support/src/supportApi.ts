import {supportApiUrl} from './config';
import {refundErrors} from './refundMessages';

export class SupportApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {super(message);}
}
export type SupportUser = {id: string; email: string; displayName: string};
let csrfToken: string | null = null;
let refreshPromise: Promise<SupportUser> | null = null;

async function request(endpoint: string, options: RequestInit = {}) {
  if (!supportApiUrl) throw new SupportApiError(0, 'CONFIG_INVALID', 'Chưa cấu hình địa chỉ backend Support.');
  let response: Response;
  try {response = await fetch(supportApiUrl + endpoint, {...options, credentials: 'include'});}
  catch (error) {
    if (options.signal?.aborted) throw error;
    throw new SupportApiError(0, 'NETWORK_ERROR', 'Không thể kết nối backend. Kiểm tra kết nối và thử lại.');
  }
  const token = response.headers.get('x-csrf-token');
  if (token) csrfToken = token;
  let payload: any;
  try {payload = await response.json();}
  catch {throw new SupportApiError(response.status || 502, 'INVALID_RESPONSE', 'Backend chưa trả về phản hồi hợp lệ. Vui lòng thử lại.');}
  if (!response.ok || !payload.success) {
    const failure = new SupportApiError(response.status, payload.error?.code || 'REQUEST_FAILED', response.status === 401 ? 'Phiên đăng nhập đã hết hạn.' : refundErrors[payload.error?.code] || payload.error?.message || 'Không thể thực hiện yêu cầu.');
    if (response.status === 429) {
      const seconds = Number(response.headers.get('Retry-After'));
      Object.assign(failure, {retryAfter: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 300) : 10});
    }
    throw failure;
  }
  return payload.data;
}

async function ensureCsrf() {
  if (!csrfToken) {
    const data = await request('/csrf');
    if (typeof data?.csrfToken === 'string') csrfToken = data.csrfToken;
    if (!csrfToken) throw new SupportApiError(502, 'CSRF_UNAVAILABLE', 'Chưa xác thực được kết nối. Vui lòng tải lại trang.');
  }
}

async function mutation(endpoint: string, body: unknown, signal?: AbortSignal) {
  await ensureCsrf();
  const send = () => request(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json', 'x-csrf-token': csrfToken!}, body: JSON.stringify(body), signal});
  try {return await send();}
  catch (error) {
    // Creator logout/login can rotate the shared CSRF cookie while Support is open.
    if (!(error instanceof SupportApiError) || error.status !== 403 || error.code !== 'FORBIDDEN') throw error;
    csrfToken = null;
    await ensureCsrf();
    return send();
  }
}

export async function loadSharedSession(): Promise<SupportUser> {
  try {return await request('/session');}
  catch (error) {
    if (!(error instanceof SupportApiError) || error.status !== 401) throw error;
    if (!refreshPromise) {
      refreshPromise = (async () => {
        try {await mutation('/refresh', {});}
        catch (refreshError) {
          // Creator may have rotated the shared cookie in another tab.
          if (!(refreshError instanceof SupportApiError) || ![401, 409].includes(refreshError.status)) throw refreshError;
        }
        return request('/session');
      })().finally(() => {refreshPromise = null;});
    }
    return refreshPromise;
  }
}

export async function askSupport(body: unknown, signal: AbortSignal) {
  try {return await mutation('/chat', body, signal);}
  catch (error) {
    if (!(error instanceof SupportApiError) || error.status !== 401) throw error;
    await loadSharedSession();
    return mutation('/chat', body, signal);
  }
}

export async function logoutSharedSession() {
  await mutation('/logout', {});
  csrfToken = null;
}
export const loadSupportBilling=(page:number)=>request('/billing?page='+page,{signal:AbortSignal.timeout(20000)});
export const checkSupportRefund=(id:string)=>mutation('/billing/'+encodeURIComponent(id)+'/check',{},AbortSignal.timeout(30000));
export const confirmSupportRefund=(id:string,quoteId:string,requestId:string)=>mutation('/billing/'+encodeURIComponent(id)+'/refund',{quoteId,requestId,confirmed:true},AbortSignal.timeout(60000));
export const loadSupportRefund=(id:string)=>request('/billing/'+encodeURIComponent(id)+'/refund',{signal:AbortSignal.timeout(30000)});
