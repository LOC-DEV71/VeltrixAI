import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat, readdir, unlink, utimes } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { inspectWave, MAX_AUDIO_BYTES } from '../providers/AudioValidation';

const root = resolve(__dirname, '../../../../services/tts/audio-cache');
const LIMIT = 256 * 1024 * 1024;
const inFlight = new Map<string, Promise<Buffer>>();
function file(hash: string) { if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('INVALID_AUDIO_HASH'); return join(root, `${hash}.wav`); }
function verify(audio: Buffer, hash: string) {
  inspectWave(audio); if (createHash('sha256').update(audio).digest('hex') !== hash) throw new Error('MEDIA_CHANGED');
}
async function trim() {
  const entries = [];
  for (const name of await readdir(root)) {
    if (!/^[a-f0-9]{64}\.wav$/.test(name)) continue;
    try { const info = await stat(join(root, name)); if (info.isFile()) entries.push({ name, ...info }); } catch {}
  }
  let bytes = entries.reduce((n, entry) => n + entry.size, 0);
  for (const entry of entries.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (bytes <= LIMIT) break;
    try { await unlink(join(root, entry.name)); bytes -= entry.size; } catch {}
  }
}
export async function storeCachedAudio(hash: string, audio: Buffer) {
  verify(audio, hash); await mkdir(root, { recursive: true });
  const destination = file(hash); const temp = `${destination}.${randomUUID()}.tmp`;
  try { await writeFile(temp, audio, { mode: 0o600 }); await rename(temp, destination); }
  finally { await unlink(temp).catch(() => {}); }
  await trim();
}
export async function getCachedAudio(hash: string, download: () => Promise<Buffer>) {
  const destination = file(hash);
  try {
    const info = await stat(destination); if (!info.isFile() || info.size > MAX_AUDIO_BYTES) throw new Error();
    const audio = await readFile(destination); verify(audio, hash);
    void utimes(destination, new Date(), new Date()).catch(() => {}); return audio;
  } catch { /* Missing or corrupt cache falls back to the protected source, never synthesis. */ }
  const previous = inFlight.get(hash); if (previous) return previous;
  const pending = (async () => {
    const audio = await download(); verify(audio, hash);
    // Cache failures do not prevent delivery of verified source audio.
    await storeCachedAudio(hash, audio).catch(() => {}); return audio;
  })();
  inFlight.set(hash, pending);
  try { return await pending; } finally { inFlight.delete(hash); }
}
