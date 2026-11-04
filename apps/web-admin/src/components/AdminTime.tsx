import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Tooltip } from 'antd';
import { absoluteAdminTime, adminTimestamp, relativeAdminTime } from '../adminTime';

const ClockContext = createContext(Date.now());
export function AdminClock({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    const refresh = () => { if (!document.hidden) setNow(Date.now()); };
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  return <ClockContext.Provider value={now}>{children}</ClockContext.Provider>;
}
export function AdminTime({ value, absolute = false }: { value: unknown; absolute?: boolean }) {
  const now = useContext(ClockContext);
  const timestamp = adminTimestamp(value);
  if (timestamp === null) return <>—</>;
  const full = absoluteAdminTime(value);
  return <Tooltip title={`${full} · UTC+7`}><time dateTime={new Date(timestamp).toISOString()}>{absolute ? full : relativeAdminTime(value, now)}</time></Tooltip>;
}
export const RenderAdminTime = (value: unknown) => <AdminTime value={value} />;
export const RenderAbsoluteTime = (value: unknown) => <AdminTime value={value} absolute />;
