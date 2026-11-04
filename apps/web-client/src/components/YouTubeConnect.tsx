import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MonitorPlay as Youtube, Unlink, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../api';
import { errorMessage } from '../utils/userMessages';

export interface YouTubeState {
  configured: boolean;
  status: 'NOT_CONFIGURED' | 'NOT_CONNECTED' | 'CONNECTED' | 'NEEDS_REAUTH';
  connected: boolean;
  needsReauth: boolean;
  channelTitle: string | null;
  channelAvatar: string | null;
  channelId: string | null;
  connectedAt?: string | null;
  dailyLimit: number;
  usedToday: number;
  remainingToday: number;
  missingEnv?: string[];
}

export function parseYouTubeErrorMessage(reason?: string | null): string {
  switch (reason) {
    case 'access_denied':
    case 'denied':
      return 'Bạn đã từ chối cấp quyền hoặc tài khoản chưa được thêm vào Test Users trong Google Cloud Console (OAuth consent screen).';
    case 'missing_scope':
    case 'scope':
      return 'Cần cấp quyền tải video lên YouTube để sử dụng tính năng này.';
    case 'no_channel':
    case 'nochannel':
      return 'Tài khoản Google này chưa có kênh YouTube. Vui lòng tạo kênh trên YouTube trước khi kết nối.';
    case 'invalid_state':
      return 'Phiên xác thực đã hết hạn hoặc không hợp lệ. Vui lòng bấm kết nối lại.';
    case 'offline_denied':
      return 'Google không cấp quyền truy cập lâu dài (offline access). Vui lòng thử lại và tích chọn cấp quyền.';
    default:
      return 'Không thể kết nối tài khoản YouTube. Vui lòng kiểm tra lại cấu hình OAuth.';
  }
}

/** Loads the user's YouTube connection. `reload` refreshes it after connect/disconnect. */
export function useYouTube() {
  const [state, setState] = useState<YouTubeState | null>(null);
  const [loading, setLoading] = useState(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  /** Resolves to the state (null if it could not be read). Retries a few times on failure, e.g. while the API restarts. */
  const reload = useCallback(async (attemptArg?: unknown): Promise<YouTubeState | null> => {
    // Also used directly as an onChange handler: ignore anything that is not a retry count.
    const attempt = typeof attemptArg === 'number' ? attemptArg : 0;
    if (retry.current) { clearTimeout(retry.current); retry.current = null; }
    setLoading(true);
    let next: YouTubeState | null = null;
    try {
      next = (await api.get('/youtube/status')).data.data;
    } catch {
      try { next = (await api.get('/youtube/connection')).data.data; } catch { next = null; }
    } finally {
      if (alive.current) setLoading(false);
    }
    if (!alive.current) return next;
    if (next) setState(next);
    // Keep the last known state on a failure; try again 2, 4, 8, 16 s later.
    else if (attempt < 4) retry.current = setTimeout(() => { void reload(attempt + 1); }, 2000 * 2 ** attempt);
    return next;
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => { alive.current = false; if (retry.current) clearTimeout(retry.current); };
  }, [reload]);

  return { youtube: state, loadingYouTube: loading, reloadYouTube: reload };
}

interface YouTubeConnectProps {
  state: YouTubeState | null;
  onChange: () => void;
  returnPath?: string;
  variant?: 'inline' | 'card';
}

export const YouTubeConnect: React.FC<YouTubeConnectProps> = ({
  state,
  onChange,
  returnPath = '/auto-video',
  variant = 'inline',
}) => {
  const [busy, setBusy] = useState(false);

  if (!state) {
    return <div className="text-xs text-slate-400">Đang tải trạng thái YouTube...</div>;
  }

  const connect = async () => {
    setBusy(true);
    try {
      const res = await api.get('/youtube/auth-url', { params: { returnPath } });
      const authUrl = res.data.data?.url;
      if (authUrl) {
        window.location.assign(authUrl);
      } else {
        throw new Error('Không nhận được URL xác thực.');
      }
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };

  const disconnect = async () => {
    const confirmed = window.confirm(
      'Bạn có chắc chắn muốn ngắt kết nối kênh YouTube này?\nCác video đã tải lên trước đó vẫn được giữ nguyên trên kênh.'
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      await api.post('/youtube/disconnect');
      toast.success('Đã ngắt kết nối tài khoản YouTube thành công.');
      onChange();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!state.configured) {
    if (variant === 'card') {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-5 text-sm text-amber-800 space-y-2">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle size={18} className="text-amber-600" />
            <span>YouTube OAuth chưa được kích hoạt trên hệ thống</span>
          </div>
          <p className="text-xs text-amber-700 leading-relaxed">
            Hệ thống chưa thiết lập đủ biến môi trường kết nối YouTube. Vui lòng liên hệ quản trị viên để cấu hình.
          </p>
        </div>
      );
    }
    return <p className="text-xs text-slate-500">Đăng YouTube chưa được bật trên hệ thống.</p>;
  }

  // Card Variant for Settings / Account Page
  if (variant === 'card') {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-100 text-red-600">
              <Youtube size={24} />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 text-base">Kênh YouTube</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Liên kết tài khoản YouTube để tự động xuất bản video từ workflow Video Tự Động.
              </p>
            </div>
          </div>

          <div>
            {state.connected && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
                <CheckCircle2 size={13} className="text-emerald-600" /> Đã kết nối
              </span>
            )}
            {state.needsReauth && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700 border border-red-200">
                <AlertCircle size={13} className="text-red-600" /> Cần kết nối lại
              </span>
            )}
            {!state.connected && !state.needsReauth && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                Chưa kết nối
              </span>
            )}
          </div>
        </div>

        {state.connected ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl bg-slate-50 border border-slate-200/80 p-4">
            <div className="flex items-center gap-3.5">
              {state.channelAvatar ? (
                <img
                  src={state.channelAvatar}
                  alt={state.channelTitle || 'Channel'}
                  className="h-12 w-12 rounded-full object-cover border border-slate-200 shadow-sm"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600 font-bold text-lg border border-red-100">
                  {state.channelTitle ? state.channelTitle.charAt(0).toUpperCase() : 'YT'}
                </div>
              )}
              <div>
                <p className="font-semibold text-slate-900 text-sm">
                  {state.channelTitle || 'Kênh của bạn'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Hôm nay: Còn <strong className="text-slate-800">{state.remainingToday}</strong>/{state.dailyLimit} video
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={disconnect}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-xs font-semibold text-red-600 shadow-sm hover:bg-red-50 hover:border-red-300 disabled:opacity-50 transition-colors"
            >
              <Unlink size={14} />
              {busy ? 'Đang ngắt...' : 'Ngắt kết nối'}
            </button>
          </div>
        ) : state.needsReauth ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl bg-red-50/80 border border-red-200 p-4">
            <div>
              <p className="font-semibold text-red-900 text-sm">Phiên kết nối đã hết hạn hoặc bị thu hồi</p>
              <p className="text-xs text-red-700 mt-1">
                Google yêu cầu cấp quyền lại để tiếp tục tải video tự động lên kênh YouTube.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={connect}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50 transition-colors shrink-0"
            >
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
              {busy ? 'Đang chuyển hướng...' : 'Kết nối lại'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl bg-slate-50 border border-slate-200 p-4">
            <div>
              <p className="text-xs text-slate-600">
                Chưa có kênh YouTube nào được liên kết với tài khoản này.
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Giới hạn xuất bản: tối đa {state.dailyLimit} video/ngày (múi giờ Việt Nam).
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={connect}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50 transition-colors shrink-0"
            >
              <Youtube size={15} />
              {busy ? 'Đang chuyển hướng...' : 'Kết nối YouTube'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Inline Variant for AutoVideoPage
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm rounded-lg bg-slate-50/80 p-3 border border-slate-200/80">
      <div className="flex items-center gap-2.5 min-w-0">
        {state.connected && state.channelAvatar ? (
          <img
            src={state.channelAvatar}
            alt="Avatar"
            className="h-7 w-7 rounded-full object-cover border border-slate-200 shrink-0"
          />
        ) : (
          <Youtube size={20} className={state.connected ? 'text-red-600 shrink-0' : 'text-slate-400 shrink-0'} />
        )}

        {state.connected ? (
          <div className="min-w-0 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-800 truncate">{state.channelTitle || 'Kênh YouTube'}</span>
              <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-medium px-2 py-0.5">
                Đã kết nối
              </span>
            </div>
            <p className="text-slate-500 mt-0.5">
              Còn <strong>{state.remainingToday}</strong>/{state.dailyLimit} video hôm nay
            </p>
          </div>
        ) : state.needsReauth ? (
          <div className="text-xs text-red-700">
            <span className="font-semibold">Cần kết nối lại</span> · Quyền truy cập đã hết hạn
          </div>
        ) : (
          <div className="text-xs text-slate-600">
            <span>Chưa kết nối kênh YouTube</span>
          </div>
        )}
      </div>

      <div>
        {state.connected ? (
          <div className="flex items-center gap-2">
            <Link
              to="/account/settings"
              className="text-xs text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
            >
              Cài đặt
            </Link>
            <span className="text-slate-300">·</span>
            <button
              type="button"
              disabled={busy}
              onClick={disconnect}
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-600 disabled:opacity-50 transition-colors"
            >
              <Unlink size={13} /> Ngắt kết nối
            </button>
          </div>
        ) : (
          <Link
            to="/account/settings"
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 transition-colors shadow-sm"
          >
            <Youtube size={14} />
            {state.needsReauth ? 'Kết nối lại' : 'Kết nối YouTube'}
          </Link>
        )}
      </div>
    </div>
  );
};
