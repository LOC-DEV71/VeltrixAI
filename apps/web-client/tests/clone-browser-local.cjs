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
    // Stay on the unauthenticated entry route; landing's session refresh redirects to login.
    await call('Page.navigate', { url: 'http://localhost:5173/login' }, sessionId);
    let ready = false;
    for (let i = 0; i < 100; i++) {
      const state = await call('Runtime.evaluate', { returnByValue: true, expression: 'location.origin === "http://localhost:5173" && location.pathname === "/login" && document.readyState === "complete"' }, sessionId).catch(error => {
        if (/navigated|context.*destroyed/i.test(error.message)) return null;
        throw error;
      });
      if (state?.result?.value === true) { ready = true; break; } await sleep(100);
    }
    assert.ok(ready, 'Local frontend did not finish loading');
    const evaluation = await call('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
      const { prepareCloneSample } = await import('/src/utils/cloneSample.ts');
      const wav = (seconds, silent = false) => {
        const frames = Math.round(seconds * 48000), buffer = new ArrayBuffer(44 + frames * 8), view = new DataView(buffer);
        const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
        text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
        view.setUint16(20, 3, true); view.setUint16(22, 2, true); view.setUint32(24, 48000, true); view.setUint32(28, 384000, true);
        view.setUint16(32, 8, true); view.setUint16(34, 32, true); text(36, 'data'); view.setUint32(40, frames * 8, true);
        for (let i = 0; i < frames; i++) for (let c = 0; c < 2; c++) view.setFloat32(44 + i * 8 + c * 4, silent ? 0 : Math.sin(i * .06) * (.3 + c * .1), true);
        return new File([buffer], 'float-stereo.wav', { type: 'audio/wav' });
      };
      const accepted = await prepareCloneSample(wav(8)), header = new DataView(await accepted.blob.arrayBuffer());
      const padded = await prepareCloneSample(wav(8.04));
      const rejected = {};
      for (const [key, file] of [['long', wav(8.06)], ['silent', wav(8, true)], ['corrupt', new File(['RIFFxxxxWAVEbroken'], 'broken.wav')]]) {
        try { await prepareCloneSample(file); rejected[key] = false; } catch { rejected[key] = true; }
      }
      return { duration: accepted.duration, bits: header.getUint16(34, true), format: header.getUint16(20, true), channels: header.getUint16(22, true), sampleRate: header.getUint32(24, true), paddedDuration: padded.duration, rejected };
    })()` }, sessionId);
    assert.equal(evaluation.exceptionDetails, undefined, evaluation.exceptionDetails?.exception?.description || 'Browser preflight failed');
    const result = evaluation.result.value;
    assert.deepEqual(result, { duration: 8, bits: 16, format: 1, channels: 1, sampleRate: 48000, paddedDuration: 8, rejected: { long: true, silent: true, corrupt: true } });
    console.log(JSON.stringify({ passed: true, browser: 'Chromium', ...result }));
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
run().catch(error => { console.error('CLONE_BROWSER_CHECK_FAILED: ' + error.message); process.exitCode = 1; });
