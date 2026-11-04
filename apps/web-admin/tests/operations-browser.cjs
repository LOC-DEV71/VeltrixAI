/* Read-only API fixtures for UI acceptance; never loaded by the application. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('../../web-client/node_modules/playwright');
const id='600000000000000000000001', jobId='600000000000000000000002', orderId='600000000000000000000003';
const stamp=new Date(Date.now()-5*60*1000).toISOString();
const owner={_id:id,displayName:'Khách kiểm thử',email:'customer@example.invalid',plan:'PRO',status:'ACTIVE',createdAt:stamp};
const admin={_id:'600000000000000000000004',displayName:'Admin kiểm thử',email:'admin@example.invalid',roleId:{name:'OWNER'},permissions:['*']};
let currentAdmin=admin;
const job={_id:jobId,ownerId:id,owner,type:'AI_CONTENT',status:'FAILED',createdAt:stamp,updatedAt:stamp,elapsedSeconds:3,error:'CONTENT_PROVIDER_UNAVAILABLE',payload:{cost:100,source:'PROJECT'}};
const order={_id:orderId,ownerId:id,owner,planName:'Pro',tier:'PRO',billingCycle:'monthly',amount:599000,status:'PAID',fulfillment:'ACTIVE',selected:true,mode:'production',createdAt:stamp,paidAt:stamp,startsAt:stamp,endsAt:'2027-01-01T00:00:00Z'};
const receipt={_id:orderId,ownerId:id,owner,orderId,providerTransactionId:'TEST123',recordSource:'VERIFIED_IPN',amount:599000,outcome:'SUCCESS',confirmedAt:stamp,providerPaidAt:stamp,mode:'production',channel:'CHECKOUT',bankCode:'NCB',cardType:'ATM'};
function list(items,query){return {items,total:11,page:Number(query.get('page')||1),limit:10};}
function fixture(url){
  const p=url.pathname,q=url.searchParams;
  if(p.endsWith('/auth/me'))return currentAdmin;
  if(p.endsWith('/auth/csrf'))return {csrfToken:'fixture-csrf'};
  if(p.endsWith('/notifications'))return {items:[],total:0,unread:0};
  if(p.endsWith('/overview'))return {users:12,newUsers:2,jobs:[{_id:'FAILED',count:1},{_id:'COMPLETED',count:4}],api:{requests:5,errors:1},orders:[{_id:'production',amount:599000}],wallets:{available:200000,reserved:100},services:{tts:'READY',ai:{provider:'local',status:'READY',probe:'HTTP_READINESS'},worker:'READY',workerSeenAt:stamp,storageConfigured:true},alerts:[],period:'LAST_24_HOURS'};
  if(p.endsWith('/settings'))return {revision:3,requestRetentionDays:90,staleJobSeconds:300,failureAlertCount:10};
  if(p.endsWith('/roles'))return [{name:'SUPPORT',permissions:['overview.read','users.read','jobs.read']},{name:'ADMIN',permissions:['users.read','users.manage','jobs.retry']}];
  if(p.endsWith('/staff'))return list([{...admin,role:'ADMIN',controlRevision:2,status:'ACTIVE',updatedAt:stamp}],q);
  if(p.endsWith('/sessions'))return list([{_id:orderId,adminId:admin._id,admin,createdAt:stamp,expiresAt:'2027-01-01T00:00:00Z'}],q);
  if(p.endsWith('/audit'))return list([{_id:orderId,createdAt:stamp,adminId:admin._id,admin,action:'OPERATIONS_SETTINGS_CHANGED',resource:'SystemSettings',resourceId:'ADMIN_OPERATIONS',reason:'Kiểm thử giao diện'}],q);
  if(p.endsWith('/reconciliation'))return list([{...job,issue:'TERMINAL_JOB_CREDIT_HELD'}],q);
  if(p.endsWith('/storage'))return list([{_id:id,owner,files:2,bytes:1048576,seconds:90}],q);
  if(p.endsWith('/contents'))return list([{_id:orderId,ownerId:id,owner,projectName:'Dự án thử',characters:400,revision:2,updatedAt:stamp}],q);
  if(p.endsWith('/jobs/'+jobId))return {...job,id:jobId,credits:100,reservationStatus:'RELEASED',plan:'PRO',planRevision:5,attempts:1,retryAllowed:false};
  if(p.endsWith('/jobs'))return list([job],q);
  if(p.endsWith('/developers/'+id))return {_id:id,owner:{...owner,controlRevision:1,developerApiDisabled:false},limits:{tier:'PRO',revision:5,maxTextChars:5000,monthlyChars:100000,requestsPerMinute:20,concurrentJobs:2},usage:{period:'2026-10',ttsChars:1000},tokens:{...list([{id:jobId,name:'Token thử',prefix:'vtx_test',expiresAt:'2027-01-01T00:00:00Z',lastUsedAt:stamp}],q)},requests:list([{_id:jobId,createdAt:stamp,method:'POST',endpoint:'/api/v1/tts',status:200,durationMs:100,jobId}],q)};
  if(p.endsWith('/developers'))return list([{...owner,developerApiDisabled:false,metrics:{requests:2,errors:0,characters:100,averageMs:100}}],q);
  if(p.endsWith('/orders/'+orderId))return {order:{...order,planRevision:5,monthlyCreditGrant:1000000},owner,payment:receipt,grants:[{createdAt:stamp,deltaAvailable:1000000,referenceId:orderId}],grantCount:1};
  if(p.endsWith('/orders'))return {...list([order],q),summary:{paid:1,pending:0,failed:0}};
  if(p.endsWith('/payments'))return {...list([receipt],q),summary:{success:1,failed:0}};
  if(p.endsWith('/cashflow'))return {...list([{...receipt,planName:'Pro',billingCycle:'monthly',occurredAt:stamp,recordSource:'CASH_LEDGER'}],q),summary:{grossReceived:599000,payments:1,averagePayment:599000},series:[{_id:'2026-10-04',amount:599000,payments:1}],byPlan:[{_id:'PRO',name:'Pro',amount:599000,payments:1}],granularity:'DAY',period:{from:stamp,to:stamp}};
  if(p.endsWith('/credits'))return list([{_id:orderId,ownerId:id,owner,createdAt:stamp,transactionType:'GRANT',bucket:'PAID',deltaAvailable:100,deltaReserved:0,referenceId:orderId}],q);
  if(p.endsWith('/users/'+id))return {user:owner,wallets:[],subscriptions:[],subscriptionsMeta:{page:1,total:0},recentJobs:[job]};
  if(p.endsWith('/users'))return {users:[owner],total:1,page:1,limit:10};
  return {items:[],total:0};
}
async function main(){
  const dist=path.resolve(__dirname,'../dist');
  const server=http.createServer(async(req,res)=>{try{
    const name=new URL(req.url,'http://localhost').pathname;
    const file=name.startsWith('/assets/')||name.startsWith('/fonts/')?path.join(dist,name):path.join(dist,'index.html');
    if(!file.startsWith(dist+path.sep))throw Error('Outside dist');
    res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.ttf')?'font/ttf':'text/html');res.end(await fs.readFile(file));
  }catch{res.writeHead(404);res.end();}});
  let browser;
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:960}});const page=await context.newPage();
    const errors=[],requests=[],mutations=[];let failJobs=false,delayJob=0,emptyJobs=false;
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/socket.io/**',r=>r.abort());
    await page.route('**/api/**',async route=>{
      const request=route.request(),url=new URL(request.url());requests.push(url);
      if(request.method()!=='GET'){mutations.push({path:url.pathname,body:request.postDataJSON(),csrf:request.headers()['x-csrf-token']});await route.fulfill({json:{success:true,data:{revision:4}}});return;}
      if(url.pathname.endsWith('/jobs')&&failJobs){await route.fulfill({status:503,json:{success:false,error:{code:'ADMIN_CONTROL_UNAVAILABLE'}}});return;}
      if(url.pathname.endsWith('/jobs')&&emptyJobs){await route.fulfill({json:{success:true,data:{items:[],total:0,page:1,limit:10}}});return;}
      if(url.pathname.endsWith('/jobs/'+jobId)&&delayJob)await new Promise(r=>setTimeout(r,delayJob));
      await route.fulfill({json:{success:true,data:fixture(url)}});
    });
    const routes=['/','/jobs','/developers','/contents','/audit','/admins','/settings','/reconciliation','/orders','/payments','/cashflow','/credits'];
    for(const width of [1440,820,390]){
      await page.setViewportSize({width,height:960});
      for(const route of routes){await page.goto(origin+route);await page.locator('.operations-page h1').waitFor();await page.locator('.operations-page .ant-skeleton').first().waitFor({state:'hidden'});assert.equal(await page.getByText('Unexpected Application Error!',{exact:true}).count(),0);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2);assert.equal(overflow,false,`Layout overflow: ${route} at ${width}`);}
      console.log(`PASS 12 operations routes at ${width}px`);
    }
    await page.setViewportSize({width:1440,height:960});
    await page.goto(origin+'/jobs');await page.getByRole('button',{name:jobId,exact:true}).click();
    const drawer=page.locator('.operations-drawer');await drawer.getByText(owner.email,{exact:true}).waitFor();await drawer.getByText('Đã hoàn Credit',{exact:true}).waitFor();
    assert.match(await drawer.locator('time').first().innerText(),/phút trước/);
    await drawer.getByRole('link',{name:'Mở hồ sơ người dùng'}).click();await page.waitForURL(origin+'/users?userId='+id);await page.locator('.stitch-user-drawer').getByText(owner.email,{exact:true}).first().waitFor();
    await page.goto(origin+'/users');await page.getByRole('textbox',{name:'Tìm người dùng'}).fill(id);await page.waitForResponse(r=>r.url().includes('search='+id));
    assert.ok(requests.some(u=>u.pathname==='/api/admin/users'&&u.searchParams.get('search')===id));console.log('PASS job identity → exact user profile and ID search');
    await page.goto(origin+'/settings');await page.getByRole('button',{name:'Chỉnh sửa cấu hình'}).click();const modal=page.locator('.operations-modal');
    assert.equal(await modal.getByRole('button',{name:'Kiểm duyệt thay đổi'}).isDisabled(),true);
    await modal.getByRole('spinbutton',{name:'Giữ nhật ký request',exact:true}).fill('120');await modal.getByRole('button',{name:'Kiểm duyệt thay đổi'}).click();
    await modal.getByRole('heading',{name:'Giá trị sẽ thay đổi'}).waitFor();await page.screenshot({path:path.resolve(__dirname,'../../../.runtime/admin-settings-after.png'),fullPage:true,animations:'disabled'});assert.equal(await modal.getByRole('button',{name:'Xác nhận & áp dụng'}).isDisabled(),true);
    await modal.getByRole('textbox',{name:'Lý do thao tác'}).fill('Kiểm thử thay đổi thời hạn');await modal.getByRole('button',{name:'Xác nhận & áp dụng'}).click();await modal.waitFor({state:'hidden'});
    const saved=mutations.find(m=>m.path==='/api/admin/control/settings');assert.equal(saved.body.expectedRevision,3);assert.equal(saved.body.requestRetentionDays,120);assert.equal(saved.body.confirmed,true);assert.equal(saved.csrf,'fixture-csrf');console.log('PASS settings validation, before/after preview, reason and revision/CSRF');
    await page.setViewportSize({width:390,height:844});await page.goto(origin+'/settings');await page.getByRole('button',{name:'Chỉnh sửa cấu hình'}).click();await modal.getByRole('spinbutton',{name:'Giữ nhật ký request',exact:true}).fill('120');await modal.getByRole('button',{name:'Kiểm duyệt thay đổi'}).click();await page.screenshot({path:path.resolve(__dirname,'../../../.runtime/admin-settings-mobile.png'),animations:'disabled'});
    const bounds=await modal.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=391,'Mobile modal stays in viewport');for(const button of await modal.locator('.ant-modal-footer button').all()){const box=await button.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391,'Mobile footer button stays in viewport');}await modal.locator('.ant-modal-close').click();await page.setViewportSize({width:1440,height:960});console.log('PASS mobile review modal and footer actions');
    await page.goto(origin+'/admins');await page.getByRole('button',{name:'Thêm quản trị viên',exact:true}).click();assert.equal(await modal.getByRole('button',{name:'Kiểm duyệt thay đổi'}).isDisabled(),true);await modal.getByRole('textbox',{name:'Tên hiển thị',exact:true}).fill('Nhân viên kiểm thử');await modal.getByRole('textbox',{name:'Email',exact:true}).fill('support@example.invalid');await modal.getByLabel('Mật khẩu ban đầu',{exact:true}).fill('twelve-long-password');await modal.getByRole('button',{name:'Kiểm duyệt thay đổi'}).click();await modal.getByRole('heading',{name:'Giá trị sẽ thay đổi'}).waitFor();assert.equal(await modal.getByLabel('Mật khẩu ban đầu',{exact:true}).count(),0);await modal.locator('.ant-modal-close').click();console.log('PASS staff validation, grouped permissions and password excluded from review');
    await page.goto(origin+'/developers');await page.getByRole('button',{name:owner.displayName,exact:true}).click();await page.locator('.operations-drawer').getByRole('button',{name:'Tạm ngừng API',exact:true}).click();await page.locator('.operations-modal').waitFor();assert.equal(await page.locator('.operations-drawer:visible').count(),0);await page.locator('.operations-modal .ant-modal-footer').getByRole('button',{name:'Đóng',exact:true}).click();await page.locator('.operations-drawer').waitFor();await page.screenshot({path:path.resolve(__dirname,'../../../.runtime/admin-developer-after.png'),fullPage:true,animations:'disabled'});console.log('PASS drawer and mutation modal do not overlap');
    failJobs=true;await page.goto(origin+'/jobs');await page.getByRole('heading',{name:'Không tải được dữ liệu',exact:true}).waitFor();failJobs=false;await page.getByRole('button',{name:'Thử lại',exact:true}).click();await page.getByRole('button',{name:jobId,exact:true}).waitFor();
    await Promise.all([page.waitForResponse(r=>r.url().includes('/control/jobs?')&&new URL(r.url()).searchParams.get('page')==='2'),page.locator('.ant-pagination-item-2').click()]);console.log('PASS error retry and server pagination');
    delayJob=400;await page.getByRole('button',{name:jobId,exact:true}).click();await page.locator('.operations-drawer .ant-drawer-close').click();await new Promise(r=>setTimeout(r,600));assert.equal(await page.locator('.operations-drawer:visible').count(),0);console.log('PASS late detail response does not reopen closed drawer');
    await page.goto(origin+'/orders');await page.getByRole('button',{name:'Chi tiết',exact:true}).click();await page.locator('.operations-drawer').getByText('Tiến trình xử lý',{exact:true}).waitFor();await page.locator('.operations-drawer').getByText('Xác nhận thanh toán và kích hoạt quyền',{exact:true}).waitFor();
    emptyJobs=true;await page.goto(origin+'/jobs');await page.getByRole('heading',{name:'Chưa có dữ liệu phù hợp',exact:true}).waitFor();emptyJobs=false;
    currentAdmin={...admin,roleId:{name:'VIEWER'},permissions:['jobs.read','developer.read']};
    await page.goto(origin+'/settings');await page.getByText('Bạn chưa có quyền truy cập trang này',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Chỉnh sửa cấu hình'}).count(),0);
    await page.goto(origin+'/developers');await page.getByRole('button',{name:owner.displayName,exact:true}).click();await page.locator('.operations-drawer').getByRole('tab',{name:/Token/}).waitFor();assert.equal(await page.locator('.operations-drawer').getByRole('button',{name:'Tạm ngừng API',exact:true}).count(),0);assert.equal(await page.locator('.operations-drawer').getByRole('button',{name:'Thu hồi',exact:true}).count(),0);console.log('PASS empty state and read-only/permission-denied actions');
    assert.deepEqual(errors,[]);await context.close();console.log('PASS finance detail and no React runtime errors');
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
