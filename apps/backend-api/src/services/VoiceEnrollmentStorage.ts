import { mkdir, writeFile, readFile, unlink, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectWave, AudioError } from '../providers/AudioValidation';

const root = resolve(__dirname, '../../../../services/tts/.runtime/enrollment-staging');
function path(id: string) {
  if (!/^[a-f0-9]{24}$/.test(id)) throw new AudioError('CLONE_INVALID_SAMPLE_ID');
  return resolve(root, `${id}.wav`);
}
export function inspectReferenceAudio(audio: Buffer) {
  if (audio.length > 4 * 1024 * 1024) throw new AudioError('CLONE_SAMPLE_TOO_LARGE');
  const info = inspectWave(audio);
  if (info.duration < 3 || info.duration > 8) throw new AudioError('CLONE_SAMPLE_DURATION_INVALID');
  if (info.bitsPerSample !== 16 || info.sampleRate < 16000 || info.sampleRate > 48000) throw new AudioError('CLONE_SAMPLE_FORMAT_INVALID');
  return info;
}
export async function stageReference(id: string, audio: Buffer) {
  inspectReferenceAudio(audio);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(path(id), audio, { mode: 0o600, flag: 'wx' });
}
export async function readStagedReference(id: string, sha256: string) {
  const audio = await readFile(path(id)); inspectReferenceAudio(audio);
  if (createHash('sha256').update(audio).digest('hex') !== sha256) throw new AudioError('CLONE_SAMPLE_INVALID');
  return audio;
}
export async function deleteStagedReference(id: string) {
  try { await unlink(path(id)); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
}
export async function sweepStagedReferences(retain: (id: string) => Promise<boolean>) {
  let files: string[]; try { files = await readdir(root); } catch (error: any) { if (error?.code === 'ENOENT') return; throw error; }
  for (const file of files) {
    if (!/^[a-f0-9]{24}\.wav$/.test(file)) continue;
    const id = file.slice(0, 24); const info = await stat(path(id)).catch(() => null);
    if (info && Date.now() - info.mtimeMs > 3600000 && !await retain(id)) await deleteStagedReference(id);
  }
}
