import type { ReactNode } from 'react';
import { ConfigProvider, Drawer as AntDrawer, Modal as AntModal } from 'antd';
import type { DrawerProps, ModalProps } from 'antd';
import { ShieldCheck } from 'lucide-react';
import './Operations.css';
export { PageHeader, Section, MetricStrip, StatePanel, DataTable as Table, FilterChips, FormField, ChangePreview, PageSkeleton, StatusBadge } from './components';

export function OperationsUI({ children }: { children: ReactNode }) {
  return <ConfigProvider theme={{ token: {
    fontFamily: "'Be Vietnam Pro', sans-serif", colorPrimary: '#4F46E5', colorInfo: '#4F46E5',
    colorText: '#172033', colorTextSecondary: '#64748B', colorBorder: '#E8EBF2',
    colorBgLayout: '#F7F8FC', borderRadius: 12, controlHeight: 42, fontSize: 13,
  }, components: {
    Table: { headerBg: '#E9EDFF', headerColor: '#464555', cellPaddingBlock: 18, cellPaddingInline: 20, rowHoverBg: '#F9FAFF' },
    Button: { primaryShadow: 'none', fontWeight: 600 }, Card: { headerFontSize: 15 },
  } }}><div className="operations-page">{children}</div></ConfigProvider>;
}

export function Drawer(props: DrawerProps) {
  return <AntDrawer {...props} className={`operations-drawer ${props.className || ''}`} styles={{
    ...props.styles, wrapper: { maxWidth: '100vw' }, body: { padding: 24, background: '#F7F8FC' },
  }} footer={props.footer ?? <div className="ops-overlay-footer"><span><ShieldCheck size={15} />Không gian quản trị Veltrix</span></div>} />;
}
export function Modal(props: ModalProps) {
  return <AntModal width={720} centered {...props} className={`operations-modal ${props.className || ''}`} />;
}
