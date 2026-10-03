// Isolated browser fixtures: never access a user session, real Credit or real account data.
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), assert = require('node:assert/strict');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'creatorai-users-browser-'));
  let browser, socket, closeBrowser, exited;
  try {
    browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    exited = new Promise(resolve => browser.once('exit', resolve));
    let port;
    for (let i = 0; i < 100; i++) { port = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => ''); if (port) break; await sleep(100); }
    assert.ok(port, 'Chrome startup failed');
    const [number, endpoint] = port.trim().split(/\r?\n/);
    socket = new WebSocket('ws://127.0.0.1:' + number + endpoint);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0; const pending = new Map();
    socket.onmessage = event => { const message = JSON.parse(event.data), entry = pending.get(message.id); if (entry) { clearTimeout(entry.timer); pending.delete(message.id); if (message.error) entry.reject(new Error(entry.method + ': ' + message.error.message)); else entry.resolve(message.result); } };
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP_TIMEOUT_' + method)); }, 15000);
      pending.set(id, { resolve, reject, timer, method }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    closeBrowser = () => call('Browser.close');
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    await call('Page.enable', {}, sessionId);
    const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId); assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description); return result.result.value; };
    const click = async (text, selector = 'button') => { assert.ok(await evaluate(`(()=>{const b=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(x=>x.innerText.trim()===${JSON.stringify(text)});if(!b)return false;b.click();return true;})()`), 'Missing button ' + text); await sleep(300); };
    const input = async (selector, value) => { await evaluate(`(()=>{const x=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(x.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(x,${JSON.stringify(value)});x.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(150); };
    const overlays = async () => { await sleep(400); assert.equal(await evaluate(`document.querySelectorAll('.ant-drawer-section').length`), 0, 'Drawer must be removed while a modal is open'); assert.equal(await evaluate(`document.querySelectorAll('.ant-modal-container').length`), 1); };
    const screenshot = async name => { const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId); await fs.mkdir(path.resolve('../../.artifacts'), { recursive: true }); await fs.writeFile(path.resolve('../../.artifacts', name), Buffer.from(result.data, 'base64')); };
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `
      const originalFetch=window.fetch.bind(window);window.fixtureErrors=[];window.fixtureRequests=[];window.fixtureReadOnly=false;window.fixtureListFailure=false;window.fixtureDetailFailure=false;window.fixtureGrantFailure=false;window.fixtureEmpty=false;
      window.addEventListener('error',e=>fixtureErrors.push(e.message));
      const rows=Array.from({length:11},(_,i)=>({_id:'user-'+i,email:'user'+i+'@example.invalid',displayName:i===0?'Người dùng kiểm thử':'Tài khoản kiểm thử '+(i+1),status:i===2?'BANNED':'ACTIVE',plan:['PRO','PLUS','FREE','BASIC_STUDENT'][i%4],createdAt:'2026-10-01T00:00:00Z',controlRevision:8,planPeriod:{billingCycle:'MONTHLY',startsAt:'2026-01-31T00:00:00+07:00',endsAt:'2026-02-28T00:00:00+07:00'}}));
      let granted=0;
      window.fetch=async(input,options={})=>{const url=new URL(typeof input==='string'?input:input.url,location.origin);const method=options.method||'GET';let data,code=200,error;
        if(url.pathname==='/api/admin/auth/me')data={displayName:'UI fixture',email:'fixture@example.invalid',roleId:{name:window.fixtureReadOnly?'SUPPORT':'OWNER'},permissions:window.fixtureReadOnly?['users.read']:['*']};
        else if(url.pathname==='/api/admin/auth/csrf')data={csrfToken:'fixture-csrf'};
        else if(url.pathname==='/api/admin/users'){
          fixtureRequests.push({url:url.pathname+url.search,method});
          if(fixtureListFailure){code=503;error='SERVICE_UNAVAILABLE';}else{const q=url.searchParams.get('search')||'',status=url.searchParams.get('status'),page=Number(url.searchParams.get('page')||1);const matches=fixtureEmpty?[]:rows.filter(r=>(!q||r.email.includes(q)||r.displayName.includes(q))&&(!status||r.status===status));data={users:matches.slice((page-1)*10,page*10),total:matches.length,page,limit:10};}
        }else if(url.pathname.match(/^\\/api\\/admin\\/users\\/user-\\d+$/)){
          if(fixtureDetailFailure){code=503;error='SERVICE_UNAVAILABLE';}else{data={user:rows.find(r=>url.pathname.endsWith('/'+r._id)),wallets:[{_id:'wallet-free',bucket:'FREE',available:30000,reserved:2400},{_id:'wallet-paid',bucket:'PAID',available:8500+granted,reserved:0}],subscriptions:[{_id:'order-plus',tier:'PLUS',status:'ACTIVE',provider:'VNPAY',billingCycle:'MONTHLY',startsAt:'2026-10-01T00:00:00Z',endsAt:'2026-11-01T00:00:00Z',selected:false},{_id:'order-pro',tier:'PRO',status:'ACTIVE',provider:'VNPAY',billingCycle:'YEARLY',startsAt:'2026-10-01T00:00:00Z',endsAt:'2027-10-01T00:00:00Z',selected:true}],subscriptionsMeta:{page:1,total:2,limit:10},recentJobs:[{_id:'job-1',type:'TTS',status:'SUCCEEDED',payload:{cost:200},createdAt:'2026-10-02T00:00:00Z'},{_id:'job-2',type:'CLONE',status:'FAILED',payload:{},createdAt:'2026-10-02T00:00:00Z'}]};}
        }else if(url.pathname.startsWith('/api/admin/users/')&&method!=='GET'){
          const body=JSON.parse(options.body);fixtureRequests.push({url:url.pathname,method,body,headers:options.headers});await new Promise(r=>setTimeout(r,200));
          if(fixtureGrantFailure&&url.pathname.endsWith('/credits')){code=503;error='SERVICE_UNAVAILABLE';}else{const row=rows.find(r=>url.pathname.includes('/'+r._id+'/'));if(url.pathname.endsWith('/credits'))granted+=body.amount;if(url.pathname.endsWith('/status')){row.status=body.status;row.controlRevision++;}if(url.pathname.endsWith('/plan')){row.plan=body.tier;row.planPeriod=body.planPeriod;}data={};}
        }else if(url.pathname==='/api/admin/control/notifications')data={items:[],total:0,unread:0,page:1,limit:10};
        else return originalFetch(input,options);
        return new Response(JSON.stringify(code===200?{success:true,data}:{success:false,error:{code:error}}),{status:code,headers:{'Content-Type':'application/json'}});
      };` }, sessionId);
    await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1050, deviceScaleFactor: 1, mobile: false }, sessionId);
    await call('Page.navigate', { url: 'http://localhost:5174/users' }, sessionId); await sleep(1400);
    assert.equal(await evaluate(`document.querySelectorAll('.um-list tbody tr.ant-table-row').length`), 10);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.admin-sidebar')).width`), '232px');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.admin-sidebar')).backgroundColor`), 'rgb(255, 255, 255)');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.users-stitch')).fontFamily.includes('Be Vietnam Pro')`), true);
    await screenshot('users-design-list-fixture.png');
    await evaluate(`document.querySelector('.um-list-footer .ant-pagination-next button').click()`); await sleep(400);
    assert.equal(await evaluate(`document.querySelectorAll('.um-list tbody tr.ant-table-row').length`), 1);
    assert.equal(await evaluate(`document.querySelector('.um-row-number').innerText`), '11');
    await input('[aria-label="Tìm người dùng"]', 'user0'); await sleep(450);
    assert.equal(await evaluate(`document.querySelectorAll('.um-list tbody tr.ant-table-row').length`), 1);
    await input('[aria-label="Tìm người dùng"]', ''); await click('Bị khóa', '.um-filter button'); await sleep(350);
    assert.equal(await evaluate(`document.querySelectorAll('.um-list tbody tr.ant-table-row').length`), 1);
    assert.ok(await evaluate(`fixtureRequests.some(r=>r.url.includes('status=BANNED')&&r.url.includes('limit=10'))`));
    await click('Tất cả', '.um-filter button'); await sleep(300);
    await click('Quản lý', '.um-manage'); await sleep(350);
    assert.ok(await evaluate(`document.querySelector('.um-wallet').innerText.includes('38.500')`));
    assert.ok(await evaluate(`document.querySelector('.stitch-user-drawer').innerText.includes('Plus Creator')&&document.querySelector('.stitch-user-drawer').innerText.includes('Pro')`));
    assert.equal(await evaluate(`document.querySelectorAll('.um-selected').length`), 1);
    assert.ok(await evaluate(`document.querySelector('.stitch-user-drawer').innerText.includes('Tác vụ gần đây')`));
    await screenshot('users-design-detail-fixture.png');
    await click('Tặng Credit'); await overlays();
    await click('+5.000', '.um-presets button');
    assert.ok(await evaluate(`document.querySelector('.um-preview').innerText.includes('43.500')`));
    await input('[aria-label="Lý do tặng Credit"]', 'Bồi hoàn tác vụ kiểm thử');
    await screenshot('users-design-grant-fixture.png');
    await evaluate(`fixtureGrantFailure=true`); await click('Cập nhật Credit'); await sleep(350);
    assert.equal(await evaluate(`document.querySelectorAll('.um-action-error').length`), 1);
    const failedKey = await evaluate(`fixtureRequests.filter(r=>r.method==='POST'&&r.url.endsWith('/credits')).at(-1).headers['Idempotency-Key']`);
    await evaluate(`fixtureGrantFailure=false;document.querySelector('.um-modal-footer .ant-btn-primary').click();document.querySelector('.um-modal-footer .ant-btn-primary').click()`); await sleep(550);
    const grants = await evaluate(`fixtureRequests.filter(r=>r.method==='POST'&&r.url.endsWith('/credits'))`);
    assert.equal(grants.length, 2, 'Retry and double-click must create only one successful request');
    assert.equal(grants[1].headers['Idempotency-Key'], failedKey);
    assert.equal(grants[1].headers['x-csrf-token'], 'fixture-csrf');
    assert.equal(grants[1].body.amount, 5000);
    assert.ok(await evaluate(`document.querySelector('.um-wallet').innerText.includes('43.500')`));
    await click('Cập nhật gói'); await overlays();
    assert.equal(await evaluate(`document.querySelector('.um-modal-footer .ant-btn-primary').disabled`), true);
    await click('Theo năm', '.ant-segmented-item-label');
    assert.ok(await evaluate(`document.querySelector('.um-preview').innerText.includes('31/1/2027')`), 'Calendar year preview');
    await screenshot('users-design-plan-fixture.png');
    await click('Theo tháng', '.ant-segmented-item-label');
    assert.ok(await evaluate(`document.querySelector('.um-preview').innerText.includes('28/2/2026')`), 'Month-end date clamps exactly like backend');
    await evaluate(`document.querySelector('.um-plan-form .ant-checkbox-input').click()`); await click('Lưu gói & thời hạn'); await sleep(400);
    const plan = await evaluate(`fixtureRequests.filter(r=>r.url.endsWith('/plan')).at(-1)`);
    assert.deepEqual(plan.body, { tier: 'PRO', planPeriod: { billingCycle: 'MONTHLY', startsAt: '2026-01-31' } });
    await click('Khóa tài khoản'); await overlays();
    await click('Khóa tài khoản', '.um-modal-footer button');
    assert.equal(await evaluate(`fixtureRequests.filter(r=>r.url.endsWith('/status')).length`), 0, 'Reason is required');
    await input('[aria-label="Lý do thay đổi trạng thái"]', 'Kiểm tra trạng thái người dùng'); await click('Khóa tài khoản', '.um-modal-footer button'); await sleep(450);
    const status = await evaluate(`fixtureRequests.filter(r=>r.url.endsWith('/status')).at(-1)`);
    assert.equal(status.body.expectedRevision, 8); assert.equal(status.body.confirmed, true); assert.equal(status.body.status, 'BANNED');
    await click('Tặng Credit'); await click('+1.000', '.um-presets button'); await click('Hủy');
    assert.ok(await evaluate(`document.querySelector('.um-discard').innerText.includes('Hủy các thay đổi chưa lưu')`));
    await overlays(); await click('Hủy thay đổi'); await click('Đóng', '.um-drawer-footer button');
    for (const width of [1280, 768, 390]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 }, sessionId); await sleep(350);
      assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), 'List overflow at ' + width);
      await click('Quản lý', '.um-manage'); await sleep(300);
      assert.ok(await evaluate(`document.querySelector('.ant-drawer-section').getBoundingClientRect().width<=innerWidth+1`), 'Drawer overflow at ' + width);
      await click('Cập nhật gói'); await overlays();
      assert.ok(await evaluate(`document.querySelector('.ant-modal-container').getBoundingClientRect().width<=innerWidth+1`), 'Modal overflow at ' + width);
      assert.ok(await evaluate(`document.querySelector('.ant-modal-container').scrollWidth<=document.querySelector('.ant-modal-container').clientWidth+1`), 'Modal content overflow at ' + width);
      if (width === 390) await screenshot('users-design-mobile-fixture.png');
      await click('Quay lại'); await click('Đóng', '.um-drawer-footer button');
    }
    await evaluate(`fixtureListFailure=true`); await click('Làm mới'); await sleep(350);
    assert.ok(await evaluate(`document.querySelector('.um-error').innerText.includes('Không thể tải người dùng')`));
    await evaluate(`fixtureListFailure=false;fixtureEmpty=true`); await click('Thử lại'); await sleep(350);
    assert.ok(await evaluate(`document.querySelector('.um-list').innerText.includes('Không tìm thấy tài khoản')`));
    await evaluate(`fixtureEmpty=false`); await click('Xóa bộ lọc'); await click('Làm mới'); await sleep(350);
    await evaluate(`fixtureDetailFailure=true`); await click('Quản lý', '.um-manage'); await sleep(350);
    assert.ok(await evaluate(`!!document.querySelector('.stitch-user-drawer .um-error')`));
    await evaluate(`fixtureDetailFailure=false`); await click('Thử lại'); await sleep(300); await click('Đóng', '.um-drawer-footer button');
    assert.equal(await evaluate(`fixtureErrors.length`), 0);
    await call('Page.addScriptToEvaluateOnNewDocument', { source: 'window.fixtureReadOnly=true;' }, sessionId);
    await call('Page.reload', {}, sessionId); await sleep(900);
    await click('Chi tiết', '.um-manage'); await sleep(350);
    assert.equal(await evaluate(`document.querySelectorAll('.um-access,.um-plan-picker').length`), 0);
    assert.ok(!await evaluate(`Array.from(document.querySelectorAll('.stitch-user-drawer button')).some(b=>b.innerText==='Tặng Credit'||b.innerText==='Cập nhật gói')`));
    assert.equal(await evaluate(`fixtureErrors.length`), 0);
    console.log('USERS_DESIGN_BROWSER_OK: 10-row server pagination, search/status, two owned plans, Credit preview/CSRF/idempotent retry, plan calendar dates, status revision/reason, discard confirmation, read-only permission, empty/error retry, 1600/1280/768/390 layouts, unchanged sidebar. Screenshots use isolated fixtures.');
  } finally {
    if (closeBrowser) await closeBrowser().catch(() => {});
    socket?.close();
    if (browser?.exitCode === null) await Promise.race([exited, sleep(3000)]);
    if (browser?.exitCode === null) browser.kill();
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('creatorai-users-browser-'));
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }).catch(() => {});
  }
}
run().catch(error => { console.error('USERS_DESIGN_BROWSER_FAILED: ' + error.stack); process.exitCode = 1; });
