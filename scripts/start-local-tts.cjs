// Local-only supervisor. Secrets stay in a private runtime file/process environments, not .env.
const path = require('node:path'); const fs = require('node:fs/promises');
const crypto = require('node:crypto'); const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
require(path.join(root, 'apps/backend-api/node_modules/dotenv')).config({ path: path.join(root, 'apps/backend-api/.env'), quiet: true });
const directory = path.join(root, 'services/tts/.runtime'); const configFile = path.join(directory, 'connection.json');
const children = []; let ownToken;
const delay = ms => new Promise(done => setTimeout(done, ms));
async function freePort() { const s = net.createServer(); await new Promise(done => s.listen(0, '127.0.0.1', done)); const port = s.address().port; await new Promise(done => s.close(done)); return port; }
async function stop() {
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (process.platform === 'win32') { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {} }
    else child.kill('SIGTERM');
  }
  try { const saved = JSON.parse(await fs.readFile(configFile, 'utf8')); if (saved.token === ownToken) await fs.unlink(configFile); } catch {}
}
async function run() {
  try {
    const saved = JSON.parse(await fs.readFile(configFile, 'utf8'));
    process.kill(saved.workerPid, 0);
    if ((await fetch(saved.url + '/health/ready', { signal: AbortSignal.timeout(1000) })).ok) { console.log('LOCAL_TTS_ALREADY_RUNNING'); return; }
  } catch {}
  await fs.mkdir(directory, { recursive: true });
  const url = `http://127.0.0.1:${await freePort()}`; ownToken = crypto.randomBytes(32).toString('hex');
  const env = { ...process.env, TTS_SERVICE_URL: url, TTS_SERVICE_TOKEN: ownToken, PYTHONUTF8: '1', TTS_BUNDLE_PATH: path.join(root, 'services/tts/artifacts') };
  const pythonPath = path.join(root, process.platform === 'win32' ? 'services/tts/.venv/Scripts/python.exe' : 'services/tts/.venv/bin/python');
  const python = spawn(pythonPath, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', new URL(url).port, '--no-access-log'], { cwd: path.join(root, 'services/tts'), env, windowsHide: true, stdio: 'ignore' }); children.push(python);
  let failed = false; python.on('error', () => { failed = true; });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (failed || python.exitCode !== null) throw new Error();
    try { ready = (await fetch(url + '/health/ready', { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break; await delay(1000);
  }
  if (!ready) throw new Error();
  const worker = spawn(process.execPath, [path.join(root, 'apps/backend-api/dist/workers/tts.js')], { cwd: path.join(root, 'apps/backend-api'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(worker);
  let workerReady = false; worker.on('error', () => { failed = true; });
  worker.stdout.on('data', chunk => { if (String(chunk).includes('TTS worker ready')) workerReady = true; });
  worker.stderr.on('data', () => {});
  for (let i = 0; i < 30 && !workerReady; i++) { if (failed || worker.exitCode !== null) throw new Error(); await delay(1000); }
  if (!workerReady) throw new Error();
  await fs.writeFile(configFile, JSON.stringify({ url, token: ownToken, supervisorPid: process.pid, workerPid: worker.pid }), { mode: 0o600 });
  if (process.platform === 'win32') execFileSync('icacls.exe', [configFile, '/inheritance:r', '/grant:r', `${process.env.USERDOMAIN}\\${process.env.USERNAME}:(F)`], { windowsHide: true, stdio: 'ignore' });
  console.log('LOCAL_TTS_AND_WORKER_READY');
  process.once('SIGINT', () => stop().finally(() => process.exit())); process.once('SIGTERM', () => stop().finally(() => process.exit()));
  for (const child of children) child.once('exit', () => stop().finally(() => process.exit(1)));
}
run().catch(() => { console.error('LOCAL_TTS_START_FAILED'); return stop().finally(() => { process.exitCode = 1; }); });
