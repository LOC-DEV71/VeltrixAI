// Provisioning worker: generates cached system samples, never runs from HTTP requests.
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { resolve, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { seedSystemVoices } from '../scripts/seedSystemVoices';
import { Voice } from '../models/Voice';
import { TtsProvider, getTtsConfiguration } from '../providers/TtsProvider';

const root = resolve(__dirname, '../../../..');
const ids = ['Hải Đăng', 'Mai Anh', 'Thùy Dung', 'Quang Sơn', 'Thái Sơn', 'Ngọc Trân'];
const text = 'Đây là Veltrix TTS, ứng dụng chuyển đổi văn bản thành giọng nói và sáng tạo nội dung. Biến ý tưởng của bạn thành những câu chuyện sống động, với giọng đọc tự nhiên và truyền cảm.';
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
async function freePort(): Promise<number> {
  const server = createServer(); await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as any).port; await new Promise<void>(done => server.close(() => done())); return port;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await new Promise(done => killer.once('exit', done));
  } else child.kill('SIGTERM');
}
async function run() {
  dotenv.config({ path: resolve(__dirname, '../../.env'), quiet: true });
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_NOT_CONFIGURED');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const port = await freePort();
  process.env.TTS_SERVICE_URL = `http://127.0.0.1:${port}`;
  process.env.TTS_SERVICE_TOKEN = randomBytes(32).toString('hex');
  const python = process.platform === 'win32' ? join(root, 'services/tts/.venv/Scripts/python.exe') : join(root, 'services/tts/.venv/bin/python');
  const child = spawn(python, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(port), '--no-access-log'], {
    cwd: join(root, 'services/tts'), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, PYTHONUTF8: '1', TTS_BUNDLE_PATH: join(root, 'services/tts/artifacts') },
  });
  let spawnFailed = false; child.on('error', () => { spawnFailed = true; });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (spawnFailed || child.exitCode !== null) throw new Error('TTS_STARTUP_FAILED');
      try { ready = (await fetch(`${process.env.TTS_SERVICE_URL}/health/ready`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
      if (ready) break; await sleep(1000);
    }
    if (!ready) throw new Error('TTS_STARTUP_TIMEOUT');
    await seedSystemVoices(ids);
    const provider = new TtsProvider(getTtsConfiguration());
    const output = join(root, 'services/tts/preview-audio'); await mkdir(output, { recursive: true });
    const evidence = [];
    for (const id of ids) {
      const voice = await Voice.findOne({ provider: 'VIENEU_LOCAL', providerVoiceId: id, isSystem: true, status: 'ACTIVE' });
      if (!voice) continue; // Never reactivate a revoked voice.
      const wav = await provider.synthesize(text, voice.providerVoiceId);
      const sha256 = createHash('sha256').update(wav.audio).digest('hex'); const fileName = `${sha256}.wav`;
      await writeFile(join(output, fileName), wav.audio);
      const saved = await Voice.updateOne({ _id: voice._id, status: 'ACTIVE', providerVoiceId: id }, { $set: { preview: { fileName, sha256, duration: wav.duration, text } } });
      if (!saved.matchedCount) throw new Error('VOICE_REVOKED_DURING_PREVIEW');
      evidence.push({ name: id, voiceId: voice._id, fileName, sha256, duration: wav.duration, bytes: wav.bytes });
      console.log(JSON.stringify({ voice: id, duration: wav.duration, previewSaved: true }));
    }
    await writeFile(join(output, 'acceptance.json'), JSON.stringify({ text, voices: evidence }, null, 2));
  } finally { await stop(child); }
}
run().catch(() => { console.error('VOICE_PREVIEW_GENERATION_FAILED'); process.exitCode = 1; }).finally(() => mongoose.disconnect());
