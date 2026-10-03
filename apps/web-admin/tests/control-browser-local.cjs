// Exercise actual Chromium WAV decoding against the local Vite client, without user sessions.
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), assert = require('node:assert/strict');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'creatorai-clone-browser-'));
  let browser, socket, closeBrowser, exited;
  try {
    browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    exited = new Promise(resolve => browser.once('exit', resolve));
    let port;
    for (let i = 0; i < 100; i++) { port = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => ''); if (port) break; await sleep(100); }
    assert.ok(port, 'Chrome startup failed');
    const [number, endpoint] = port.trim().split(/\r?\n/);
    socket = new WebSocket('ws://127.0.0.1:' + number + endpoint);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0; const pending = new Map();
    socket.onmessage = event => { const message = JSON.parse(event.data); const entry = pending.get(message.id); if (entry) { clearTimeout(entry.timer); pending.delete(message.id); message.error ? entry.reject(new Error(entry.method + ': ' + message.error.message)) : entry.resolve(message.result); } };
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP_TIMEOUT_' + method)); }, 15000);
      pending.set(id, { resolve, reject, timer, method }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    closeBrowser = () => call('Browser.close');
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    await call('Page.enable', {}, sessionId);

    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},sessionId);assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result.value;};

    await call('Page.addScriptToEvaluateOnNewDocument',{source:
      `const originalFetch=window.fetch.bind(window);window.fixtureErrors=[];window.addEventListener('error',e=>fixtureErrors.push(e.message));window.fixtureRequests=[];
      window.fetch=async(input,options)=>{const url=new URL(typeof input==='string'?input:input.url,location.origin);let data;
      if(url.pathname==='/api/admin/auth/me')data={displayName:'Fixture',email:'fixture@example.invalid',roleId:{name:'OWNER'},permissions:['*']};
      else if(url.pathname==='/api/admin/plans')data=[];
      else if(url.pathname==='/api/admin/plans/schema')data={fields:[],tiers:[]};
      else if(url.pathname==='/api/admin/users')data={users:[],total:0,page:1};
      else if(url.pathname==='/api/admin/voices')data={items:[],total:0,summary:[],tiers:[],canManage:false};
      else if(url.pathname.startsWith('/api/admin/control/')){fixtureRequests.push(url.pathname+url.search);const p=Number(url.searchParams.get('page')||1);data=url.pathname.endsWith('/settings')?{revision:1,requestRetentionDays:90,staleJobSeconds:300,failureAlertCount:10}:url.pathname.endsWith('/roles')?[{name:'SUPPORT',permissions:['users.read']}]:url.pathname.endsWith('/overview')?{users:12,newUsers:2,api:{requests:20,errors:1},jobs:[],orders:[],wallets:{available:10,reserved:0},services:{tts:'READY',worker:'READY',storageConfigured:true},alerts:[]}:{items:Array.from({length:p===1?10:1},(_,i)=>({_id:'fixture-'+p+'-'+i,email:'fixture@example.invalid',displayName:'Fixture',metrics:{requests:1,errors:0,characters:100},payload:{cost:100},type:'TTS',status:'FAILED',createdAt:'2026-10-03T00:00:00Z',action:'FIXTURE',resource:'Job'})),total:11,page:p,limit:10};}
      else if(url.pathname==='/api/admin/billing/summary')data={rows:[]};
      else if(url.pathname==='/api/admin/billing/orders'){fixtureRequests.push(url.search);await new Promise(r=>setTimeout(r,150));const page=Number(url.searchParams.get('page')||1);data={items:Array.from({length:page===1?10:1},(_,i)=>({_id:'order-'+page+'-'+i,planName:'Fixture plan',status:'PAID',billingCycle:'monthly',mode:'sandbox',...(i%2?{amount:199000}:{}),createdAt:'2026-10-02T00:00:00Z'})),total:11,page,limit:10};}
      else if(url.pathname==='/api/admin/billing/credits')data={items:[{_id:'credit-1',transactionType:'GRANT',bucket:'FREE'}],total:1,page:1,limit:10};
      else if(url.pathname==='/api/admin/billing/payments')data={items:[],total:0,summary:{success:0,failed:0},page:1,limit:10};
      else if(url.pathname==='/api/admin/billing/cashflow')data={items:[],total:0,summary:{grossReceived:0,payments:0,averagePayment:0},series:[],byPlan:[],period:{from:'2026-09-03T00:00:00Z',to:'2026-10-03T00:00:00Z'},page:1,limit:10};
      else return originalFetch(input,options);return new Response(JSON.stringify({success:true,data}),{status:200,headers:{'Content-Type':'application/json'}});};`},sessionId);
    await call('Page.navigate',{url:'http://localhost:5174/jobs'},sessionId);await sleep(1500);
    let state=await evaluate('({rows:document.querySelectorAll("tbody tr.ant-table-row").length,errors:fixtureErrors,text:document.body.innerText})');assert.equal(state.rows,10);assert.equal(state.errors.length,0);
    await evaluate('document.querySelector(".ant-pagination-next button").click()');await sleep(500);state=await evaluate('({rows:document.querySelectorAll("tbody tr.ant-table-row").length})');assert.equal(state.rows,1);
    const allRoutes=['/reconciliation','/developers','/contents','/audit','/admins','/settings','/users','/voices','/plans','/orders','/payments','/cashflow','/credits','/jobs','/'];
    const sidebar=await evaluate(`Array.from(document.querySelectorAll('.admin-sidebar .nav-item')).map(a=>a.getAttribute('href'))`);
    assert.equal(sidebar.length,15);
    for(const path of allRoutes){
      await evaluate(`document.querySelector('[href="${path}"]').click()`);await sleep(450);
      state=await evaluate('({errors:fixtureErrors,text:document.body.innerText})');assert.equal(state.errors.length,0);assert.ok(!state.text.includes('Unexpected Application Error'));assert.ok(!state.text.includes('Module này đang được phát triển'));
      state=await evaluate(`({background:getComputedStyle(document.querySelector('.admin-sidebar')).backgroundColor,width:getComputedStyle(document.querySelector('.admin-sidebar')).width,font:getComputedStyle(document.querySelector('.admin-sidebar')).fontFamily,brand:document.querySelector('.admin-sidebar .brand').innerText,active:document.querySelector('.admin-sidebar [aria-current="page"]').getAttribute('href'),activeBackground:getComputedStyle(document.querySelector('.admin-sidebar [aria-current="page"]')).backgroundColor,routes:Array.from(document.querySelectorAll('.admin-sidebar .nav-item')).map(a=>a.getAttribute('href'))})`);
      assert.equal(state.background,'rgb(255, 255, 255)',path);assert.equal(state.width,'232px',path);assert.ok(state.font.includes('Be Vietnam Pro'));assert.ok(state.brand.includes('Veltrix AI'));assert.ok(state.brand.includes('ADMIN CORE'));assert.equal(state.active,path);assert.equal(state.activeBackground,'rgb(238, 242, 255)');assert.deepEqual(state.routes,sidebar);
    }
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);await sleep(300);
    state=await evaluate('({width:document.documentElement.scrollWidth,viewport:innerWidth})');assert.ok(state.width<=state.viewport+1,'Mobile layout overflow');
    await evaluate(`document.querySelector('[aria-label="Mở menu"]').click()`);await sleep(250);assert.equal(await evaluate(`document.querySelector('[aria-label="Mở menu"]').getAttribute('aria-expanded')`),'true');assert.ok(Math.abs(await evaluate(`document.querySelector('.admin-sidebar').getBoundingClientRect().left`))<1);
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sessionId);await sleep(250);assert.equal(await evaluate(`document.querySelector('.admin-sidebar').classList.contains('is-open')`),false);
    await evaluate(`document.querySelector('[aria-label="Mở menu"]').click();document.querySelector('.admin-sidebar [href="/users"]').click()`);await sleep(400);assert.equal(await evaluate(`location.pathname`),'/users');assert.equal(await evaluate(`document.querySelector('.admin-sidebar').classList.contains('is-open')`),false);
    console.log('CONTROL_BROWSER_OK: all 15 routes share identical white sidebar/brand/font/permission menu, correct active link, ten-row pagination, mobile menu/Escape/navigation and no runtime errors');
  } finally {
    if (closeBrowser) await closeBrowser().catch(() => {});
    socket?.close();
    if (browser && !browser.killed && browser.exitCode === null) await Promise.race([exited, sleep(3000)]);
    if (browser?.exitCode === null) browser.kill();
    // Delete only the unique, owned test profile inside the system temp directory.
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('creatorai-clone-browser-'));
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }).catch(() => {});
  }
}
run().catch(error => { console.error('BILLING_BROWSER_CHECK_FAILED: ' + error.message); process.exitCode = 1; });
