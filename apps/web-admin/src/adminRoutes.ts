export const adminRoutes: Record<string, string> = {
  OVERVIEW: '/', USERS: '/users', PLANS: '/plans', VOICES: '/voices',
  CONTENT: '/contents', JOBS: '/jobs', CREDITS: '/credits', PAYMENTS: '/payments', ORDERS: '/orders', CASHFLOW: '/cashflow',
  ADMINS: '/admins', AUDIT: '/audit', SETTINGS: '/settings', DEVELOPERS: '/developers', RECONCILIATION:'/reconciliation',
};
export const adminPagePermissions: Record<string,string> = { RECONCILIATION:'billing.read', OVERVIEW:'overview.read', USERS:'users.read', PLANS:'plans.read', VOICES:'voices.read', CONTENT:'content.read', JOBS:'jobs.read', DEVELOPERS:'developer.read', CREDITS:'billing.read', PAYMENTS:'billing.read', ORDERS:'billing.read', CASHFLOW:'billing.read', ADMINS:'admins.manage', AUDIT:'audit.read', SETTINGS:'settings.manage' };
export function adminRouteId(pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/';
  return Object.keys(adminRoutes).find(id => adminRoutes[id] === path);
}
export const discardChangesDialog = {
  title: 'Hủy thay đổi chưa lưu?',
  content: 'Các thay đổi chưa lưu sẽ bị mất. Bạn có muốn tiếp tục?',
  okText: 'Hủy thay đổi', cancelText: 'Tiếp tục chỉnh sửa',
  okButtonProps: { danger: true }, mask: { closable: false },
};
