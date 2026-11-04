const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function adminTimestamp(value: unknown): number | null {
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return null;
  if (value === '') return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function absoluteAdminTime(value: unknown): string {
  const timestamp = adminTimestamp(value);
  return timestamp === null ? '—' : new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(timestamp);
}

/** Elapsed months/years use 30/365 days; future dates remain explicit dates. */
export function relativeAdminTime(value: unknown, now = Date.now()): string {
  const timestamp = adminTimestamp(value);
  if (timestamp === null) return '—';
  const elapsed = now - timestamp;
  if (elapsed < 0) return absoluteAdminTime(value);
  if (elapsed < MINUTE) return 'Vừa xong';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} phút trước`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} giờ trước`;
  if (elapsed < 30 * DAY) return `${Math.floor(elapsed / DAY)} ngày trước`;
  if (elapsed < 365 * DAY) return `${Math.floor(elapsed / (30 * DAY))} tháng trước`;
  return `${Math.floor(elapsed / (365 * DAY))} năm trước`;
}
