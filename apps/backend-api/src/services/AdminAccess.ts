export const ROLE_PERMISSIONS: Record<string,string[]> = {
  ADMIN:['overview.read','users.read','users.manage','plans.read','plans.manage','voices.read','voices.revoke','billing.read','jobs.read','jobs.retry','developer.read','developer.manage','content.read','audit.read'],
  OPERATIONS:['overview.read','jobs.read','jobs.retry','voices.read','voices.revoke','developer.read','developer.manage','content.read'],
  FINANCE:['overview.read','billing.read','users.read','audit.read'],
  SUPPORT:['overview.read','users.read','jobs.read','developer.read'],
  VIEWER:['overview.read','billing.read','jobs.read','developer.read','content.read','audit.read','plans.read','voices.read','users.read'],
};
export function adminCan(admin:any, permission:string) {
  const role=admin?.roleId;
  if(permission==='plans.update'&&role?.permissions?.includes('plans.manage'))return true;
  if(permission==='plans.update'&&role?.name==='ADMIN')return true;
  return !!role && (role.name==='OWNER' || role.permissions?.includes(permission) || role.permissions?.includes('*') || role.name==='ADMIN' && ROLE_PERMISSIONS.ADMIN.includes(permission));
}
export const safeCode=(value:any)=>typeof value==='string'&&/^[A-Z_]{1,80}$/.test(value)?value:value?'PROCESSING_FAILED':null;
