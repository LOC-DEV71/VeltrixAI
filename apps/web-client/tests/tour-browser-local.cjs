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
      const authSource=await(await fetch(authPath)).text();
      const {api}=await import(authSource.match(new RegExp('from "([^"]*/api[^"]*)"'))[1]);
      window.tourUser='tour-test-user-a';
      api.defaults.adapter=async config=>({status:200,statusText:'OK',headers:{},config,data:{success:true,data:config.url==='/users/me'?{_id:window.tourUser,displayName:'Tour fixture',credits:{total:1000}}:{}}});
      document.getElementById('root').style.display='none';
      history.replaceState({},'', '/workspace');
      window.fixtureContainer=document.createElement('div');document.body.append(window.fixtureContainer);
      window.mountTour=()=>{window.fixtureRoot=createRoot(window.fixtureContainer);window.fixtureRoot.render(React.createElement(AuthProvider,null,React.createElement(BrowserRouter,null,React.createElement(Routes,null,React.createElement(Route,{element:React.createElement(AppLayout)},React.createElement(Route,{path:'/workspace',element:React.createElement('div',null,'Workspace fixture')}))))));};
      window.mountTour();
    })()`);
    const visible=()=>evaluate('!!document.querySelector(".ant-tour:not(.ant-tour-hidden)")');
    for(let i=0;i<80&&!await visible();i++)await sleep(100);assert.equal(await visible(),true,'First visit opens tour: '+await evaluate('JSON.stringify({path:location.pathname,errors:window.fixtureErrors,text:window.fixtureContainer.innerText.slice(0,350),html:document.querySelectorAll(".ant-tour").length,storage:localStorage.getItem("veltrix:workspace-tour:v1:tour-test-user-a")})'));
    let titles=[];
    for(let i=0;i<6;i++){
      titles.push(await evaluate('document.querySelector(".ant-tour-title").textContent'));
      const mask=await evaluate('!!document.querySelector(".ant-tour-mask")');assert.ok(mask);
      await evaluate('document.querySelector(".ant-tour-next-btn").click()');await sleep(200);
    }
    assert.equal(new Set(titles).size,6);await sleep(400);assert.equal(await visible(),false);
    assert.equal(await evaluate('localStorage.getItem("veltrix:workspace-tour:v1:tour-test-user-a")'),'done');
    await evaluate('window.fixtureRoot.unmount();window.mountTour()');await sleep(400);assert.equal(await visible(),false,'Finished tutorial stays dismissed');
    await evaluate('window.dispatchEvent(new Event("veltrix:open-workspace-tour"))');await sleep(250);assert.equal(await visible(),true,'Replay opens tutorial');
    await evaluate('document.querySelector(".ant-tour-description button").click()');await sleep(300);assert.equal(await visible(),false,'Skip closes tutorial');
    await evaluate('window.fixtureRoot.unmount();window.tourUser="tour-test-user-b";window.mountTour()');await sleep(400);assert.equal(await visible(),true,'New account gets own tutorial');
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);await sleep(300);
    const bounds=await evaluate('(()=>{const r=document.querySelector(".ant-tour").getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth}})()');assert.ok(bounds.left>=0&&bounds.right<=bounds.width,'Tour fits mobile viewport');
    await evaluate('document.querySelector(".ant-tour-description button").click()');await sleep(200);
    await evaluate('window.fixtureRoot.unmount();window.mountTour()');await sleep(300);assert.equal(await visible(),false,'Skipped tutorial stays dismissed');
    console.log(JSON.stringify({passed:true,steps:titles.length,firstVisit:true,replay:true,skipPersists:true,perAccount:true,mobileFits:true}));
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
run().catch(error => { console.error('TOUR_BROWSER_CHECK_FAILED: ' + error.message); process.exitCode = 1; });
