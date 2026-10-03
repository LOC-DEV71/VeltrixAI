import { createHash } from 'node:crypto';
import { AudioError, inspectWave, readLimitedResponse, requireWaveContentType } from './AudioValidation';

export interface CloudinaryConfiguration { cloud: string; key: string; secret: string; }
export interface CloudinaryAudio { publicId: string; assetId: string; format: 'wav'; deliveryType: 'authenticated'; }

export function getCloudinaryConfiguration(): CloudinaryConfiguration {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !/^[\w-]+$/.test(cloud) || !key || !/^\d+$/.test(key) || !secret) throw new AudioError('CLOUDINARY_NOT_CONFIGURED');
  return { cloud, key, secret };
}

export function signCloudinaryParameters(params: Record<string, string | number>, secret: string) {
  const serialized = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
  return createHash('sha1').update(serialized + secret).digest('hex');
}

export class CloudinaryAudioProvider {
  constructor(private readonly config: CloudinaryConfiguration) {}
  private endpoint(operation: string) { return `https://api.cloudinary.com/v1_1/${this.config.cloud}/video/${operation}`; }
  private signed(params: Record<string, string | number>) {
    return { ...params, api_key: this.config.key, signature: signCloudinaryParameters(params, this.config.secret) };
  }
  private async downloadFromDelivery(publicId: string) {
    // Cloudinary's authenticated delivery signature stays exclusively on the server.
    const suffix = publicId + '.wav';
    const signature = createHash('sha1').update(suffix + this.config.secret).digest('base64url').slice(0,8);
    const assetPath = publicId.split('/').map(encodeURIComponent).join('/') + '.wav';
    const response = await fetch(`https://res.cloudinary.com/${this.config.cloud}/video/authenticated/s--${signature}--/${assetPath}`, {redirect:'error', signal:AbortSignal.timeout(20_000)});
    if (!response.ok) {await response.body?.cancel();throw new AudioError(response.status===404?'CLOUDINARY_AUDIO_NOT_FOUND':[401,403].includes(response.status)?'CLOUDINARY_DELIVERY_DENIED':'CLOUDINARY_DELIVERY_FAILED');}
    requireWaveContentType(response);
    const audio = await readLimitedResponse(response);
    return {audio,...inspectWave(audio)};
  }
  async upload(audio: Buffer, publicId: string): Promise<CloudinaryAudio> {
    inspectWave(audio);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const parameters = this.signed({ public_id: publicId, type: 'authenticated', overwrite: 'false', timestamp: Math.floor(Date.now() / 1000) });
        const form = new FormData();
        for (const [key, value] of Object.entries(parameters)) form.set(key, String(value));
        form.set('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'audio.wav');
        const response = await fetch(this.endpoint('upload'), { method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(60_000) });
        if (!response.ok) {
          await response.body?.cancel();
          throw new AudioError('CLOUDINARY_UPLOAD_FAILED', response.status === 429 || response.status >= 500);
        }
        const data = JSON.parse((await readLimitedResponse(response, 128 * 1024)).toString('utf8'));
        if (data.public_id !== publicId || data.resource_type !== 'video' || data.type !== 'authenticated' || data.format !== 'wav' || typeof data.asset_id !== 'string' || !data.asset_id) throw new AudioError('CLOUDINARY_INVALID_ASSET');
        return { publicId, assetId: data.asset_id, format: 'wav', deliveryType: 'authenticated' };
      } catch (error) {
        const safe = error instanceof AudioError ? error : new AudioError('CLOUDINARY_UPLOAD_FAILED', true);
        if (!safe.retryable || attempt === 2) throw safe;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    throw new AudioError('CLOUDINARY_UPLOAD_FAILED');
  }
  async download(publicId: string) {
    // A short-lived URL stays on the backend; clients receive only our owned-media route.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const timestamp = Math.floor(Date.now() / 1000);
      const parameters = this.signed({ public_id: publicId, format: 'wav', type: 'authenticated', timestamp, expires_at: timestamp + 60, attachment: 'false' });
      const query = new URLSearchParams(Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, String(value)])));
      try {
        const response = await fetch(`${this.endpoint('download')}?${query}`, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) {
          await response.body?.cancel();
          if ([401,403].includes(response.status)) throw new AudioError('CLOUDINARY_DELIVERY_DENIED');
          if (response.status === 404) throw new AudioError('CLOUDINARY_AUDIO_NOT_FOUND', true);
          throw new AudioError('CLOUDINARY_DELIVERY_FAILED', response.status === 429 || response.status >= 500);
        }
        requireWaveContentType(response);
        const audio = await readLimitedResponse(response);
        return { audio, ...inspectWave(audio) };
      } catch (error) {
        const safe = error instanceof AudioError ? error : new AudioError(error instanceof Error && ['TimeoutError','AbortError'].includes(error.name) ? 'CLOUDINARY_DELIVERY_TIMEOUT' : 'CLOUDINARY_DELIVERY_FAILED', true);
        if (!safe.retryable) throw safe;
        if (attempt === 2) {
          try {return await this.downloadFromDelivery(publicId);}
          catch (fallbackError) {throw fallbackError instanceof AudioError ? fallbackError : safe;}
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    throw new AudioError('CLOUDINARY_DELIVERY_FAILED');
  }
  async destroy(publicId: string) {
    const parameters = this.signed({ public_id: publicId, type: 'authenticated', timestamp: Math.floor(Date.now() / 1000), invalidate: 'true' });
    try {
      const response = await fetch(this.endpoint('destroy'), { method: 'POST', body: new URLSearchParams(Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, String(value)]))), redirect: 'error', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new AudioError('CLOUDINARY_CLEANUP_FAILED');
      const body = JSON.parse((await readLimitedResponse(response, 128 * 1024)).toString('utf8'));
      if (!['ok', 'not found'].includes(body.result)) throw new AudioError('CLOUDINARY_CLEANUP_FAILED');
    } catch { throw new AudioError('CLOUDINARY_CLEANUP_FAILED'); }
  }
}
