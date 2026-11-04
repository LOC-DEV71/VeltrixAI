import { cloneElement, Fragment, isValidElement, useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Drawer as AntDrawer, Modal as AntModal, Skeleton, Table as AntTable, Tag, Tooltip } from 'antd';
import type { DrawerProps, ModalProps, TableProps } from 'antd';
import { ArrowDownToLine, ArrowRight, CircleCheck, CircleHelp, CircleX, Inbox, RefreshCw, ShieldAlert } from 'lucide-react';

export function PageHeader({ eyebrow, title, description, primary, actions, status }: { eyebrow?: string; title: string; description?: string; primary?: ReactNode; actions?: ReactNode; status?: ReactNode }) {
  return <div className="ds-page-header"><div><div className="ds-page-context">{eyebrow || 'CONTROL CENTER'}{status}</div><h1>{title}</h1>{description && <p>{description}</p>}</div><div className="ds-page-actions">{actions}{primary}</div></div>;
}
export function Section({ title, description, action, children, className = '' }: { title?: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`ds-section ${className}`}>{(title || action) && <div className="ds-section-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>}<div className="ds-section-body">{children}</div></section>;
}
export function PageSkeleton() { return <div className="ds-page-skeleton" role="status" aria-label="Đang tải dữ liệu"><Skeleton active title={{ width: '35%' }} paragraph={{ rows: 2 }} /><div className="ds-skeleton-metrics">{[1, 2, 3, 4].map(key => <Skeleton key={key} active paragraph={{ rows: 1 }} />)}</div><Skeleton active paragraph={{ rows: 6 }} /></div>; }
export function StatePanel({ kind = 'empty', title, description, onRetry, action }: { kind?: 'empty' | 'error' | 'forbidden' | 'missing'; title?: string; description?: string; onRetry?: () => void; action?: ReactNode }) {
  const Icon = kind === 'error' ? CircleX : kind === 'forbidden' ? ShieldAlert : Inbox;
  return <div className={`ds-state ds-state-${kind}`} role={kind === 'error' ? 'alert' : undefined}><span className="ds-state-icon"><Icon size={24} /></span><h2>{title || (kind === 'error' ? 'Chưa tải được dữ liệu' : 'Chưa có bản ghi phù hợp')}</h2><p>{description || 'Thử bỏ bộ lọc hoặc kiểm tra lại sau khi có hoạt động mới.'}</p>{onRetry && <Button icon={<RefreshCw size={16} />} onClick={onRetry}>Thử lại</Button>}{action}</div>;
}
export function StatusBadge({ tone = 'info', children }: { tone?: 'success' | 'warning' | 'danger' | 'info' | 'disabled'; children: ReactNode }) {
  return <span className={`ds-badge ds-badge-${tone}`}><i />{children}</span>;
}
export function MetricStrip({ items, loading }: { items: { label: string; value: ReactNode; note?: string; icon?: ReactNode }[]; loading?: boolean }) {
  return <div className="ds-metric-strip">{items.map(item => <div className="ds-metric" key={item.label}><span>{item.icon}{item.label}</span>{loading ? <Skeleton.Input active size="small" /> : <strong>{item.value}</strong>}{item.note && <small>{item.note}</small>}</div>)}</div>;
}
export function FilterChips({ values, onRemove, onReset }: { values: { key: string; label: string; removable?: boolean }[]; onRemove: (key: string) => void; onReset?: () => void }) {
  return values.length > 0 ? <div className="ds-filter-chips"><span>Đang lọc</span>{values.map(v => <Tag key={v.key} closable={v.removable !== false} onClose={() => onRemove(v.key)}>{v.label}</Tag>)}{onReset && <Button type="text" size="small" onClick={onReset}>Xóa bộ lọc</Button>}</div> : null;
}
const csvCell = (value: unknown) => '"' + String(value ?? '').replace(/^[=+@-]/, "'$&").replace(/"/g, '""') + '"';
export function DataTable<T extends object>(props: TableProps<T> & { exportName?: string; emptyDescription?: string }) {
  const { loading, exportName, emptyDescription, ...tableProps } = props;
  const [selected, setSelected] = useState<React.Key[]>([]);
  useEffect(() => { setSelected([]); }, [props.dataSource]);
  const exportRows = () => {
    const key = typeof props.rowKey === 'string' ? props.rowKey : '_id';
    const rows = (props.dataSource || []).filter((r: any) => selected.includes(r[key]));
    const fields = [...new Set(rows.flatMap(r => Object.keys(r).filter(k => ['string', 'number', 'boolean'].includes(typeof (r as any)[k]))))];
    const csv = '\uFEFF' + [fields.map(csvCell).join(','), ...rows.map(r => fields.map(k => csvCell((r as any)[k])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${exportName || 'ban-ghi'}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  return <div className="ds-data-table">{loading ? <div className="ds-table-skeleton" role="status" aria-label="Đang tải danh sách">{[1, 2, 3, 4, 5].map(key => <Skeleton active key={key} title={false} paragraph={{ rows: 1, width: '100%' }} />)}</div> : <>
    {selected.length > 0 && <div className="ds-bulk-bar"><span><CircleCheck size={16} />Đã chọn {selected.length} bản ghi trong trang này</span><Button size="small" icon={<ArrowDownToLine size={14} />} onClick={exportRows}>Xuất CSV đã chọn</Button><Button size="small" type="text" onClick={() => setSelected([])}>Bỏ chọn</Button></div>}
    <AntTable {...tableProps} loading={false} rowSelection={props.rowSelection || (exportName ? { selectedRowKeys: selected, onChange: keys => setSelected(keys) } : undefined)} locale={{ emptyText: <StatePanel description={emptyDescription} />, ...props.locale }} />
  </>}</div>;
}
export const Table = DataTable;
export function Drawer(props: DrawerProps) { return <AntDrawer {...props} className={`ds-drawer ${props.className || ''}`} styles={{ ...props.styles, wrapper: { maxWidth: '100vw', ...(props.styles as any)?.wrapper } }} />; }
export function Modal(props: ModalProps) { return <AntModal width={640} centered {...props} className={`ds-modal ${props.className || ''}`} />; }
export function FormField({ label, help, unit, children }: { label: string; help?: string; unit?: string; children: ReactNode }) {
  const generatedId = useId();
  const control = isValidElement<{id?: string; 'aria-describedby'?: string}>(children) && children.type !== Fragment ? children : null;
  const id = control?.props.id || generatedId;
  return <div className="ds-field"><label htmlFor={control ? id : undefined}>{label}{unit && <small> · {unit}</small>}{help && <Tooltip title={help}><CircleHelp size={14} /></Tooltip>}</label>{control ? cloneElement(control, { id, 'aria-describedby': help ? `${id}-help` : control.props['aria-describedby'] }) : children}{help && <p id={`${id}-help`}>{help}</p>}</div>;
}
export function ChangePreview({ before, after, labels = {} }: { before: Record<string, any>; after: Record<string, any>; labels?: Record<string, string> }) {
  const changes = Object.keys(after).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]) && k !== 'password');
  return <div className="ds-change-preview"><h3>Giá trị sẽ thay đổi</h3>{changes.length ? changes.map(k => <div key={k}><span>{labels[k] || k}</span><code>{String(before[k] ?? 'Chưa có')}</code><ArrowRight size={14} /><strong>{String(after[k] ?? 'Không giới hạn')}</strong></div>) : <p>Chưa có thay đổi.</p>}</div>;
}
export function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return debounced;
}
export function useValidFilters(filters: Record<string, string>) {
  const debounced = useDebouncedValue(JSON.stringify(filters));
  return useMemo(() => Object.fromEntries(Object.entries(JSON.parse(debounced) as Record<string, string>).filter(([key, value]) => !value || !['ownerId', 'jobId', 'projectId', 'adminId'].includes(key) || /^[a-f0-9]{24}$/i.test(value))), [debounced]);
}
