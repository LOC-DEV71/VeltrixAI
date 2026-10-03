export const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 300;

export class AudioError extends Error {
  constructor(public readonly code: string, public readonly retryable = false) { super(code); }
}

export interface WaveInfo { bytes: number; duration: number; sampleRate: number; channels: number; bitsPerSample: number; }

export function inspectWave(buffer: Buffer): WaveInfo {
  const invalid = () => { throw new AudioError('INVALID_TTS_WAV'); };
  if (buffer.length > MAX_AUDIO_BYTES) throw new AudioError('TTS_AUDIO_TOO_LARGE');
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return invalid();
  const end = buffer.readUInt32LE(4) + 8;
  if (end !== buffer.length) return invalid();
  let format: { sampleRate: number; channels: number; bits: number; alignment: number } | undefined;
  let dataBytes = 0;
  let offset = 12;
  while (offset + 8 <= end) {
    const name = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > end) return invalid();
    if (name === 'fmt ') {
      if (format || size < 16 || buffer.readUInt16LE(start) !== 1) return invalid();
      const channels = buffer.readUInt16LE(start + 2);
      const sampleRate = buffer.readUInt32LE(start + 4);
      const byteRate = buffer.readUInt32LE(start + 8);
      const alignment = buffer.readUInt16LE(start + 12);
      const bits = buffer.readUInt16LE(start + 14);
      if (channels < 1 || channels > 2 || sampleRate < 8000 || sampleRate > 96000 || ![8, 16, 24, 32].includes(bits) || alignment !== channels * bits / 8 || byteRate !== sampleRate * alignment) return invalid();
      format = { channels, sampleRate, bits, alignment };
    } else if (name === 'data') {
      if (dataBytes || !size) return invalid();
      dataBytes = size;
    }
    offset = start + size + (size % 2);
  }
  if (!format || !dataBytes || dataBytes % format.alignment || offset !== end) return invalid();
  const duration = dataBytes / (format.sampleRate * format.alignment);
  if (duration < 0.1 || duration > MAX_AUDIO_SECONDS) throw new AudioError('TTS_AUDIO_DURATION_INVALID');
  return { bytes: buffer.length, duration, sampleRate: format.sampleRate, channels: format.channels, bitsPerSample: format.bits };
}

export async function readLimitedResponse(response: Response, limit = MAX_AUDIO_BYTES): Promise<Buffer> {
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel();
    throw new AudioError('TTS_AUDIO_TOO_LARGE');
  }
  if (!response.body) throw new AudioError('INVALID_TTS_WAV');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > limit) throw new AudioError('TTS_AUDIO_TOO_LARGE');
      chunks.push(Buffer.from(next.value));
    }
    if (declared && Number(declared) !== bytes) throw new AudioError('INVALID_TTS_WAV');
    return Buffer.concat(chunks, bytes);
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}

export function requireWaveContentType(response: Response) {
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'audio/wav') throw new AudioError('INVALID_TTS_CONTENT_TYPE');
}
