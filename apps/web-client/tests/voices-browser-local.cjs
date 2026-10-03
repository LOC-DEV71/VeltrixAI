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
    await call('Page.navigate',{url:'http://localhost:5173/'},sessionId);
    let count=0;for(let i=0;i<120;i++){count=await evaluate('document.querySelectorAll("#voices audio").length').catch(()=>0);if(count)break;await sleep(200);}
    assert.ok(count>0,'Landing must show real voice previews');
    const audio=await evaluate('(async()=>{const a=document.querySelector("#voices audio");await a.play();a.pause();return {duration:a.duration,ready:a.readyState};})()');assert.ok(audio.duration>0);assert.ok(audio.ready>=2);
    const link=await evaluate('Array.from(document.querySelectorAll("#voices a")).find(a=>a.getAttribute("href")==="/voices#clone")?.getAttribute("href")');assert.equal(link,'/voices#clone');
    await evaluate('Array.from(document.querySelectorAll("#voices a")).find(a=>a.getAttribute("href")==="/voices#clone").click()');
    let page;for(let i=0;i<100;i++){page=await evaluate('({path:location.pathname,clone:!!document.querySelector("#clone"),audio:document.querySelectorAll("audio").length})');if(page.clone&&page.audio)break;await sleep(150);}
    assert.equal(page.path,'/voices');assert.equal(page.clone,true);assert.ok(page.audio>0);
    await evaluate('Array.from(document.querySelectorAll("#clone a")).find(a=>a.getAttribute("href")==="/login").click()');await sleep(250);assert.equal(await evaluate('location.pathname'),'/login');
    console.log(JSON.stringify({passed:true,anonymousLandingVoices:count,playableSeconds:audio.duration,publicVoiceLibrary:true,cloneLoginLink:true}));
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
run().catch(error => { console.error('VOICES_BROWSER_CHECK_FAILED: ' + error.message); process.exitCode = 1; });
