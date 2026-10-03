export async function controlApi(path:string,body?:any,method='GET') {
  let csrf='';if(body){const r=await fetch('/api/admin/auth/csrf',{credentials:'include'});const data=await r.json();if(!r.ok||!data.data?.csrfToken)throw new Error('CSRF_UNAVAILABLE');csrf=data.data.csrfToken;}
  const r=await fetch('/api/admin/control'+path,{method,credentials:'include',headers:{...(body?{'Content-Type':'application/json','x-csrf-token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error?.code||'REQUEST_FAILED'),{code:data.error?.code,status:r.status});return data.data;
}
export const controlDate=(v:any)=>v?new Date(v).toLocaleString('vi-VN',{timeZone:'Asia/Saigon'}):'—';
export const canAdmin=(user:any,permission:string)=>user?.roleId?.name==='OWNER'||user?.permissions?.includes('*')||user?.permissions?.includes(permission);
