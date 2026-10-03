export function billingNumber(value: unknown): string {
  if (value === null || value === undefined || value === '' ||
      !['number', 'string'].includes(typeof value)) return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('vi-VN') : '—';
}

export function billingDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('vi-VN', { timeZone: 'Asia/Saigon' }) : '—';
}
