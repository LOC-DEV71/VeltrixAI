import { AudioError, inspectWave, readLimitedResponse, requireWaveContentType } from './AudioValidation';
import { isIP } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface TtsConfiguration { url: string; token: string; timeoutMs: number; attempts: number; }
export interface ClonedReference { speakerEmbedding: number[]; codes: number[][]; }
export function validateClonedReference(value: any): ClonedReference {
  if (!Array.isArray(value?.speakerEmbedding) || value.speakerEmbedding.length !== 192 || !value.speakerEmbedding.every((n: any) => typeof n === 'number' && Number.isFinite(n)) || !Array.isArray(value.codes) || value.codes.length < 1 || value.codes.length > 1000 || !value.codes.every((row: any) => Array.isArray(row) && row.length === 16 && row.every((n: any) => Number.isInteger(n) && n >= 0 && n <= 1024))) throw new AudioError('CLONE_INVALID_REFERENCE');
  return { speakerEmbedding: value.speakerEmbedding, codes: value.codes };
}

export function getTtsConfiguration(): TtsConfiguration {
  let url = process.env.TTS_SERVICE_URL;
  let token = process.env.TTS_SERVICE_TOKEN;
  // Local supervisor configuration is private, ignored by Git and never used in production.
  if (!url && !token && process.env.NODE_ENV !== 'production') {
    try { const local = JSON.parse(readFileSync(resolve(__dirname, '../../../../services/tts/.runtime/connection.json'), 'utf8')); url = local.url; token = local.token; } catch {}
  }
  if (!url || !token || !/^[\x21-\x7e]{32,}$/.test(token)) throw new AudioError('TTS_NOT_CONFIGURED');
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error();
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const internalIp = isIP(host) === 4 && (/^(?:127\.|10\.|192\.168\.)/.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host));
    const internalV6 = isIP(host) === 6 && (host === '::1' || /^(?:fc|fd)/.test(host));
    const internalName = !isIP(host) && (/^[a-z0-9-]+$/.test(host) || /\.(?:internal|local)$/.test(host));
    if (!internalIp && !internalV6 && !internalName) throw new Error();
  } catch { throw new AudioError('TTS_NOT_CONFIGURED'); }
  return { url: url.replace(/\/+$/, ''), token, timeoutMs: 120_000, attempts: 3 };
}

// Imported by the TTS worker only. Controllers enqueue jobs, never synthesize.
export class TtsProvider {
  constructor(private readonly config: TtsConfiguration) {}
  async enroll(audio: Buffer) {
    for (let attempt = 1; attempt <= this.config.attempts; attempt++) {
      try {
        const response = await fetch(`${this.config.url}/enroll`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.config.timeoutMs),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.token}` },
          body: JSON.stringify({ audioBase64: audio.toString('base64') }),
        });
        if (!response.ok) { await response.body?.cancel(); throw new AudioError(response.status >= 500 || response.status === 429 ? 'TTS_SERVICE_UNAVAILABLE' : 'CLONE_INPUT_REJECTED', response.status >= 500 || response.status === 429); }
        if (response.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new AudioError('CLONE_INVALID_REFERENCE');
        const value = JSON.parse((await readLimitedResponse(response, 512 * 1024)).toString('utf8'));
        return validateClonedReference(value.reference);
      } catch (error) {
        const safe = error instanceof AudioError ? error : new AudioError('TTS_SERVICE_UNAVAILABLE', true);
        if (!safe.retryable || attempt === this.config.attempts) throw safe;
        await new Promise(resolve => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
      }
    }
    throw new AudioError('TTS_SERVICE_UNAVAILABLE');
  }
  async synthesize(text: string, voice: string, reference?: ClonedReference) {
    for (let attempt = 1; attempt <= this.config.attempts; attempt++) {
      try {
        const response = await fetch(`${this.config.url}/synthesize`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.config.timeoutMs),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.token}` },
          body: JSON.stringify({ text, voice, ...(reference ? { reference: validateClonedReference(reference) } : {}) }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 429 || response.status >= 500) throw new AudioError('TTS_SERVICE_UNAVAILABLE', true);
          throw new AudioError(response.status === 401 || response.status === 403 ? 'TTS_AUTH_FAILED' : 'TTS_INPUT_REJECTED');
        }
        requireWaveContentType(response);
        const audio = await readLimitedResponse(response);
        return { audio, ...inspectWave(audio) };
      } catch (error) {
        const safe = error instanceof AudioError ? error : new AudioError('TTS_SERVICE_UNAVAILABLE', true);
        if (!safe.retryable || attempt === this.config.attempts) throw safe;
        await new Promise(resolve => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
      }
    }
    throw new AudioError('TTS_SERVICE_UNAVAILABLE');
  }
}
