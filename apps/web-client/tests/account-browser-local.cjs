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

    await call('Page.navigate',{url:'http://localhost:5173/login'},sessionId);await sleep(1200);
    await evaluate(`(async()=>{
      window.fixtureErrors=[];window.addEventListener('error',e=>window.fixtureErrors.push(e.message));
      const source=await (await fetch('/src/main.tsx')).text();
      const dep=name=>source.match(new RegExp('from \"([^\"]*'+name+'\\.js[^\"]*)\"'))[1];
      const React=(await import(dep('react'))).default;
      const {createRoot}=(await import(dep('react-dom_client'))).default;
      const {BrowserRouter,Routes,Route}=await import((await (await fetch('/src/App.tsx')).text()).match(/from \"([^\"]*react-router-dom\\.js[^\"]*)\"/)[1]);
      const appSource=await (await fetch('/src/App.tsx')).text();
      const authPath=appSource.match(new RegExp('from "([^"]*AuthContext[^"]*)"'))[1];
      const {AuthProvider}=await import(authPath);
      const {AppLayout}=await import('/src/components/layout/AppLayout.tsx');
      const {AccountPage}=await import('/src/pages/AccountPage.tsx');
      const {ContentEditorPage}=await import('/src/pages/ContentEditorPage.tsx');
      const authSource=await(await fetch(authPath)).text();
      const {api}=await import(authSource.match(new RegExp('from "([^"]*/api[^"]*)"'))[1]);
      window.fixtureAccount={id:'account-test',email:'fixture@example.invalid',displayName:'Account fixture',credits:{total:42},accountRevision:0,plan:'PRO',subscriptionPeriod:{billingCycle:'YEARLY',remainingPercent:91.67,monthlyRemainingPercent:100,remainingDays:334,status:'ACTIVE',startsAt:'2026-01-01T00:00:00+07:00',endsAt:'2027-01-01T00:00:00+07:00',monthStartsAt:'2026-02-01T00:00:00+07:00',monthEndsAt:'2026-03-01T00:00:00+07:00'},profile:{bio:'',occupation:''},preferences:{platform:'tiktok',audience:'Default',tone:'funny'}};
      window.fixtureTokens=[];
      api.defaults.adapter=async config=>{
        if(['/billing/subscriptions','/notifications','/billing/orders'].includes(config.url)) return {status:200,statusText:'OK',headers:{},config,data:{success:true,data:{items:[],total:0,unread:0,page:1,limit:10}}};
        const data=typeof config.data==='string'?JSON.parse(config.data):config.data;
        if(config.url==='/users/me' && config.method==='patch') {window.fixtureAccount={...window.fixtureAccount,...data,accountRevision:window.fixtureAccount.accountRevision+1};}
        if(config.url.startsWith('/developer/tokens')) {
          let result;
          if(config.method==='post') {const t={id:'fixture-token',name:data.name,prefix:'vtx_fixture',scopes:data.scopes,expiresAt:new Date(Date.now()+86400000).toISOString(),revokedAt:null,lastUsedAt:null};window.fixtureTokens=[t];result={...t,token:'test-only-secret-one-time'};}
          else if(config.method==='delete') {window.fixtureTokens[0].revokedAt=new Date().toISOString();result=window.fixtureTokens[0];}
          else result={items:window.fixtureTokens,total:window.fixtureTokens.length,page:1,limit:10};
          return {status:200,statusText:'OK',headers:{},config,data:{success:true,data:result}};
        }
        const result=config.url==='/users/me'?window.fixtureAccount:config.url==='/billing/config'?{available:false,savedCardsAvailable:false}:config.url==='/billing/payment-methods'?{methods:[]}:config.url==='/plans/me'?{config:{overview:{name:'Free'}}}:config.url==='/contents/generation-config'?{languages:['vi-VN'],durations:[30,60],defaultDuration:30,maxScenes:4,advanced:false,creativeDirection:false}:{};
        return {status:200,statusText:'OK',headers:{},config,data:{success:true,data:result}};
      };
      document.getElementById('root').style.display='none';
      history.replaceState({},'', '/account/profile');
      window.fixtureContainer=document.createElement('div');document.body.append(window.fixtureContainer);
      window.mountTour=()=>{window.fixtureRoot=createRoot(window.fixtureContainer);window.fixtureRoot.render(React.createElement(AuthProvider,null,React.createElement(BrowserRouter,null,React.createElement(Routes,null,React.createElement(Route,{element:React.createElement(AppLayout)},...['/account/profile','/account/preferences','/account/settings'].map(path=>React.createElement(Route,{key:path,path,element:React.createElement(AccountPage)})),React.createElement(Route,{path:'/content',element:React.createElement(ContentEditorPage)}))))));};
      window.mountTour();
    })()`);

    await sleep(500);
    assert.equal(await evaluate('!!document.querySelector("main form")'),true,'Profile renders');
    const change=async(index,value)=>{await evaluate('(()=>{const input=document.querySelectorAll("main form input")[ '+index+' ];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,'+JSON.stringify(value)+');input.dispatchEvent(new Event("input",{bubbles:true}));})()');};
    await change(0,'Saved creator');await evaluate('document.querySelector("main form").requestSubmit()');await sleep(400);
    assert.equal(await evaluate('window.fixtureAccount.displayName'),'Saved creator');assert.equal(await evaluate('window.fixtureAccount.accountRevision'),1);
    await evaluate('document.querySelector("aside button[aria-expanded]").click()');await sleep(150);
    assert.equal(await evaluate('Array.from(document.querySelectorAll("aside a")).filter(a=>a.getAttribute("href").startsWith("/account/")).length'),5);
    await evaluate('Array.from(document.querySelectorAll("aside a")).find(a=>a.getAttribute("href")==="/account/preferences").click()');await sleep(300);
    await evaluate('(()=>{const s=document.querySelectorAll("main form select");s[0].value="reels";s[0].dispatchEvent(new Event("change",{bubbles:true}));s[1].value="pro";s[1].dispatchEvent(new Event("change",{bubbles:true}));})()');await change(0,'Adults');
    await evaluate('document.querySelector("main form").requestSubmit()');await sleep(400);
    assert.equal(await evaluate('window.fixtureAccount.preferences.platform'),'reels');assert.equal(await evaluate('window.fixtureAccount.preferences.audience'),'Adults');assert.equal(await evaluate('window.fixtureAccount.preferences.tone'),'pro');
    await evaluate('Array.from(document.querySelectorAll("aside a")).find(a=>a.getAttribute("href")==="/content").click()');await sleep(400);
    const editor=await evaluate('({platform:document.querySelectorAll("main select")[0].value,tone:document.querySelectorAll("main select")[1].value,audience:Array.from(document.querySelectorAll("main input")).find(i=>i.value==="Adults")?.value})');
    assert.equal(editor.platform,'reels');assert.equal(editor.tone,'pro');assert.equal(editor.audience,'Adults');
    await evaluate('document.querySelector("aside button[aria-expanded]").click()');await sleep(100);await evaluate('Array.from(document.querySelectorAll("aside a")).find(a=>a.getAttribute("href")==="/account/settings").click()');await sleep(300);
    assert.equal(await evaluate('location.pathname'),'/account/settings');
    const bars=await evaluate('Array.from(document.querySelectorAll("main [role=progressbar]")).map(b=>Number(b.getAttribute("aria-valuenow")))');assert.deepEqual(bars,[100,91.67]);assert.ok(await evaluate('document.querySelector("main").textContent.includes("42 Credit")'));
    await evaluate('Array.from(document.querySelectorAll("main button")).find(b=>b.textContent.includes("API token")).click()');await sleep(200);
    await evaluate('(()=>{const i=document.querySelector(".ant-modal input[maxlength]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,"Browser app");i.dispatchEvent(new Event("input",{bubbles:true}));})()');await sleep(100);
    await evaluate('document.querySelector(".ant-modal-footer .ant-btn-primary").click()');await sleep(400);
    assert.equal(await evaluate('document.querySelector(".ant-modal textarea")?.value'),'test-only-secret-one-time');
    await evaluate('document.querySelector(".ant-modal-footer button").click()');await sleep(400);assert.equal(await evaluate('!!document.querySelector(".ant-modal textarea")'),false);
    await evaluate('Array.from(document.querySelectorAll("main button")).find(b=>b.textContent==="Thu hồi").click()');await sleep(200);
    await evaluate('document.querySelector(".ant-modal-confirm-btns .ant-btn-primary").click()');await sleep(400);assert.ok(await evaluate('!!window.fixtureTokens[0].revokedAt'));
    await evaluate('Array.from(document.querySelectorAll("main section button")).find(b=>b.textContent.includes("\u0110\u0103ng xu\u1ea5t")).click()');await sleep(200);assert.ok(await evaluate('!!document.querySelector(".ant-modal")'),'Logout uses modal');
    assert.deepEqual(await evaluate('window.fixtureErrors'),[]);
    await call('Page.navigate',{url:'http://localhost:5173/developer'},sessionId);for(let i=0;i<30;i++){await sleep(200);if(await evaluate('!!document.querySelector("main h1")'))break;}
    assert.ok(await evaluate('document.querySelector("main h1")?.textContent.includes("Giọng đọc")'),'Public Developer page renders');
    await call('Page.navigate',{url:'http://localhost:5173/docs?section=developer'},sessionId);for(let i=0;i<30;i++){await sleep(200);if(await evaluate('!!document.querySelector("pre")'))break;}
    assert.ok(await evaluate('document.querySelector("pre")?.textContent.includes("Idempotency-Key")'),'Integration docs render code example: '+await evaluate('document.body.innerText.slice(0,350)'));
    console.log(JSON.stringify({passed:true,menuRoutes:true,profileSave:true,preferencesSave:true,editorUsesDefaults:true,settings:true,logoutModal:true,annualAndMonthlyProgress:true,developerTokenCreate:true,secretRemovedOnClose:true,tokenRevokeModal:true}));
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
run().catch(error => { console.error('ACCOUNT_BROWSER_CHECK_FAILED: ' + error.message); process.exitCode = 1; });
