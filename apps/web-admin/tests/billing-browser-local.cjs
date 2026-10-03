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
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);

    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},sessionId);assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result.value;};

    await call('Page.addScriptToEvaluateOnNewDocument',{source:
      `const originalFetch=window.fetch.bind(window);window.fixtureErrors=[];window.addEventListener('error',e=>fixtureErrors.push(e.message));window.fixtureRequests=[];
      window.fetch=async(input,options)=>{const url=new URL(typeof input==='string'?input:input.url,location.origin);let data;
      if(url.pathname==='/api/admin/auth/me')data={displayName:'Fixture',email:'fixture@example.invalid',roleId:{name:'OWNER'},permissions:['*']};
      else if(url.pathname==='/api/admin/billing/summary')data={rows:[]};
      else if(url.pathname==='/api/admin/billing/orders'){fixtureRequests.push(url.pathname+url.search);await new Promise(r=>setTimeout(r,150));const page=Number(url.searchParams.get('page')||1);data={items:Array.from({length:page===1?10:1},(_,i)=>({_id:'order-'+page+'-'+i,planName:i%3?'Plus Creator':'Pro',status:i%3?'PAID':'PENDING',fulfillment:i%3?'ACTIVE':'NOT_ACTIVATED',billingCycle:'monthly',mode:'sandbox',owner:{displayName:'Khách hàng '+(i+1),email:'khach'+i+'@example.invalid'},...(i%2?{amount:199000}:{}),createdAt:'2026-10-02T00:00:00Z'})),total:11,page,limit:10,summary:{paid:8,pending:3,failed:0}};}
      else if(url.pathname==='/api/admin/billing/payments'){fixtureRequests.push(url.pathname+url.search);data={items:[{_id:'payment-1',orderId:'order-1-1',outcome:'SUCCESS',amount:199000,mode:'sandbox',providerTransactionId:'123456789',bankCode:'NCB',cardType:'ATM',responseCode:'00',transactionStatus:'00',recordSource:'VERIFIED_IPN',channel:'CHECKOUT',confirmedAt:'2026-10-02T00:00:00Z',owner:{displayName:'Nguyễn Minh',email:'minh@example.invalid'}}],total:1,page:1,limit:10,summary:{success:1,failed:0}};}
      else if(url.pathname==='/api/admin/billing/cashflow'){fixtureRequests.push(url.pathname+url.search);data={items:[{_id:'cash-1',orderId:'order-1-1',amount:199000,mode:'production',occurredAt:'2026-10-02T00:00:00Z',planName:'Plus Creator',billingCycle:'monthly',recordSource:'CASH_LEDGER',owner:{displayName:'Nguyễn Minh',email:'minh@example.invalid'}}],total:1,page:1,limit:10,summary:{grossReceived:1299000,payments:5,averagePayment:259800},byPlan:[{_id:'PLUS',name:'Plus Creator',amount:796000,payments:4},{_id:'PRO',name:'Pro',amount:503000,payments:1}],series:[{_id:'2026-09-29',amount:199000,payments:1},{_id:'2026-09-30',amount:398000,payments:2},{_id:'2026-10-01',amount:503000,payments:1},{_id:'2026-10-02',amount:199000,payments:1}],period:{from:'2026-09-03T00:00:00Z',to:'2026-10-03T00:00:00Z'},granularity:'DAY'};}
      else if(url.pathname.startsWith('/api/admin/billing/orders/'))data={order:{_id:'order-1-1',planName:'Plus Creator',planRevision:7,monthlyCreditGrant:250000,amount:199000,status:'PAID',mode:'sandbox',billingCycle:'monthly',createdAt:'2026-10-02T00:00:00Z',paidAt:'2026-10-02T00:01:00Z',startsAt:'2026-10-02T00:01:00Z',endsAt:'2026-11-02T00:01:00Z'},owner:{displayName:'Nguyễn Minh',email:'minh@example.invalid'},grants:[{deltaAvailable:250000,createdAt:'2026-10-02T00:01:00Z',referenceId:'billing_fixture_0'}],grantCount:1,payment:{outcome:'SUCCESS',channel:'CHECKOUT',providerTransactionId:'123456789',responseCode:'00',transactionStatus:'00',bankCode:'NCB'}};
      else if(url.pathname==='/api/admin/billing/credits')data={items:[{_id:'credit-1',transactionType:'GRANT',bucket:'FREE'}],total:1,page:1,limit:10};
      else return originalFetch(input,options);return new Response(JSON.stringify({success:true,data}),{status:200,headers:{'Content-Type':'application/json'}});};`},sessionId);
    await call('Page.navigate',{url:'http://localhost:5174/orders'},sessionId);await sleep(1500);
    let state=await evaluate('({rows:document.querySelectorAll("tbody tr.ant-table-row").length,errors:fixtureErrors,text:document.body.innerText})');
    assert.equal(state.rows,10);assert.equal(state.errors.length,0);assert.ok(!state.text.includes('Unexpected Application Error'));
    await evaluate('document.querySelector(".ant-pagination-next button").click()');await sleep(500);
    state=await evaluate('({rows:document.querySelectorAll("tbody tr.ant-table-row").length,requests:fixtureRequests})');assert.equal(state.rows,1);assert.ok(state.requests.some(v=>v.includes('page=2')&&v.includes('limit=10')));
    await evaluate(`document.querySelector('[href="/credits"]').click()`);await sleep(400);
    await evaluate(`document.querySelector('[href="/orders"]').click()`);await sleep(500);
    state=await evaluate('({errors:fixtureErrors,text:document.body.innerText})');assert.equal(state.errors.length,0);assert.ok(!state.text.includes('Unexpected Application Error'));
    const artifacts=path.join(__dirname,'.artifacts');await fs.mkdir(artifacts,{recursive:true});
    const screenshot=async name=>{const shot=await call('Page.captureScreenshot',{format:'png'},sessionId);await fs.writeFile(path.join(artifacts,name+'.png'),Buffer.from(shot.data,'base64'));};
    await screenshot('finance-orders');
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.innerText==='Chi tiết').click()`);await sleep(350);
    state=await evaluate('({text:document.body.innerText,errors:fixtureErrors})');assert.ok(state.text.includes('Giá chốt tại thời điểm đặt'));assert.ok(state.text.includes('Cấp 250.000 Credit'));assert.equal(state.errors.length,0);
    await evaluate(`document.querySelector('.ant-drawer-close').click()`);await sleep(300);
    await evaluate(`document.querySelector('[href="/payments"]').click()`);await sleep(450);state=await evaluate('({text:document.body.innerText,requests:fixtureRequests,errors:fixtureErrors})');assert.ok(state.text.includes('Mã phản hồi'));assert.ok(state.text.includes('NCB'));assert.ok(state.requests.some(r=>r.startsWith('/api/admin/billing/payments')));assert.equal(state.errors.length,0);await screenshot('finance-payments');
    await evaluate(`document.querySelector('[href="/cashflow"]').click()`);await sleep(450);state=await evaluate('({text:document.body.innerText,requests:fixtureRequests,errors:fixtureErrors})');assert.ok(state.text.includes('Xu hướng tiền thu'));assert.ok(state.text.includes('Tiền thu theo gói'));assert.ok(state.requests.some(r=>r.startsWith('/api/admin/billing/cashflow')));assert.equal(state.errors.length,0);await screenshot('finance-cashflow');
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);await sleep(300);state=await evaluate('({width:document.documentElement.scrollWidth,viewport:innerWidth})');assert.ok(state.width<=state.viewport+1,'Cashflow mobile overflow');await screenshot('finance-mobile');
    console.log('BILLING_BROWSER_OK: distinct APIs and columns, order details, income chart, ten-row pagination and mobile layout');
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
