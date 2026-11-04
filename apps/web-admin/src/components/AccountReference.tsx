import { Link } from 'react-router-dom';
import { Typography } from 'antd';

export function AccountReference({ id, owner, link = true }: { id?: string; owner?: { displayName?: string; email?: string } | null; link?: boolean }) {
  if (!id) return <>—</>;
  return <div className="ops-account-reference"><strong>{owner?.displayName || (owner ? 'Người dùng' : 'Chưa có thông tin tài khoản')}</strong>{owner?.email && <small>{owner.email}</small>}<Typography.Text copyable={{ text: id, tooltips: ['Sao chép ID', 'Đã sao chép'] }}><code>{id}</code></Typography.Text>{link && <Link to={`/users?userId=${encodeURIComponent(id)}`}>Mở hồ sơ người dùng</Link>}</div>;
}
