import { api } from '../api';

export async function downloadCombinedAudio(paths: string[]) {
  let format: Uint8Array | undefined; const chunks: Uint8Array[] = []; let total = 0;
  for (const path of paths) {
    const response = await api.get(path.replace(/^\/api/, ''), { responseType: 'arraybuffer' });
    const data = new Uint8Array(response.data); const view = new DataView(data.buffer);
    const name = (i: number) => String.fromCharCode(...data.slice(i, i + 4));
    if (name(0) !== 'RIFF' || name(8) !== 'WAVE') throw new Error('INVALID_WAV');
    let pcm: Uint8Array | undefined; let current: Uint8Array | undefined;
    for (let offset = 12; offset + 8 <= data.length;) {
      const size = view.getUint32(offset + 4, true); if (offset + 8 + size > data.length) throw new Error('INVALID_WAV');
      if (name(offset) === 'fmt ') current = data.slice(offset + 8, offset + 24);
      if (name(offset) === 'data') pcm = data.slice(offset + 8, offset + 8 + size);
      offset += 8 + size + size % 2;
    }
    if (!current || !pcm || current.length !== 16 || new DataView(current.buffer).getUint16(0, true) !== 1) throw new Error('INVALID_WAV');
    if (format && current.some((value, i) => value !== format![i])) throw new Error('INCOMPATIBLE_WAV');
    format = current; chunks.push(pcm); total += pcm.length;
    if (total > 256 * 1024 * 1024) throw new Error('EXPORT_TOO_LARGE');
  }
  if (!format) throw new Error('NO_AUDIO');
  const audio = new Uint8Array(44 + total); const view = new DataView(audio.buffer);
  const label = (offset: number, text: string) => [...text].forEach((c, i) => audio[offset + i] = c.charCodeAt(0));
  label(0, 'RIFF'); view.setUint32(4, 36 + total, true); label(8, 'WAVE'); label(12, 'fmt '); view.setUint32(16, 16, true);
  audio.set(format, 20); label(36, 'data'); view.setUint32(40, total, true);
  let offset = 44; for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.length; }
  const url = URL.createObjectURL(new Blob([audio.buffer], { type: 'audio/wav' })); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'veltrix-toan-bo-canh.wav'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
