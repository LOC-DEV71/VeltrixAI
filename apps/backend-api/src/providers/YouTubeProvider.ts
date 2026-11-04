import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

export const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];

export class YouTubeError extends Error {
  constructor(public readonly code: string, public readonly status = 502) { super(code); }
}

export interface YouTubeConfig { clientId: string; clientSecret: string; redirectUri: string; encryptionKey: Buffer; clientUrl: string; dailyUploads: number }

export interface YouTubeEnvCheck {
  ok: boolean;
  missing: string[];
  config: YouTubeConfig | null;
}

export function checkYouTubeEnv(env: NodeJS.ProcessEnv = process.env): YouTubeEnvCheck {
  const missing: string[] = [];
  if (!env.YOUTUBE_CLIENT_ID?.trim()) missing.push('YOUTUBE_CLIENT_ID');
  if (!env.YOUTUBE_CLIENT_SECRET?.trim()) missing.push('YOUTUBE_CLIENT_SECRET');
  if (!env.YOUTUBE_REDIRECT_URI?.trim()) missing.push('YOUTUBE_REDIRECT_URI');
  if (!env.YOUTUBE_CLIENT_URL?.trim()) missing.push('YOUTUBE_CLIENT_URL');
  if (!env.YOUTUBE_DAILY_UPLOADS?.trim()) missing.push('YOUTUBE_DAILY_UPLOADS');
  const key = env.YOUTUBE_TOKEN_ENCRYPTION_KEY?.trim() || '';
  if (!key || !/^[a-f0-9]{64}$/i.test(key)) missing.push('YOUTUBE_TOKEN_ENCRYPTION_KEY');

  const config = missing.length === 0 ? getYouTubeConfig(env) : null;
  return { ok: missing.length === 0, missing, config };
}

/** Null when YouTube is not configured; the feature is then reported as unavailable. */
export function getYouTubeConfig(env: NodeJS.ProcessEnv = process.env): YouTubeConfig | null {
  const clientId = env.YOUTUBE_CLIENT_ID?.trim(), clientSecret = env.YOUTUBE_CLIENT_SECRET?.trim(), redirectUri = env.YOUTUBE_REDIRECT_URI?.trim();
  const key = env.YOUTUBE_TOKEN_ENCRYPTION_KEY?.trim() || '';
  if (!clientId || !clientSecret || !redirectUri || !/^[a-f0-9]{64}$/i.test(key)) return null;
  const rawLimit = Number(env.YOUTUBE_DAILY_UPLOADS);
  const dailyUploads = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? rawLimit : 3;
  return {
    clientId,
    clientSecret,
    redirectUri,
    encryptionKey: Buffer.from(key, 'hex'),
    clientUrl: (env.YOUTUBE_CLIENT_URL || env.VNPAY_CLIENT_URL || 'http://localhost:5173').replace(/\/$/, ''),
    dailyUploads,
  };
}

export function encryptToken(token: string, key: Buffer) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), data.toString('hex'), cipher.getAuthTag().toString('hex')].join('.');
}
export function decryptToken(value: string, key: Buffer) {
  const [iv, data, tag] = value.split('.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString('utf8');
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

export function authorizationUrl(config: YouTubeConfig, state: string, codeVerifier: string) {
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: YOUTUBE_SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
    code_challenge: pkceChallenge(codeVerifier), code_challenge_method: 'S256',
  })}`;
}

async function postForm(url: string, form: Record<string, string>) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form), signal: AbortSignal.timeout(20000) });
  const body: any = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

export async function exchangeCode(config: YouTubeConfig, code: string, codeVerifier: string) {
  const { ok, body } = await postForm('https://oauth2.googleapis.com/token', { code, code_verifier: codeVerifier, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code' });
  if (!ok || typeof body.access_token !== 'string') throw new YouTubeError('YOUTUBE_OAUTH_FAILED');
  if (typeof body.refresh_token !== 'string') throw new YouTubeError('YOUTUBE_OFFLINE_ACCESS_DENIED');
  return { accessToken: body.access_token as string, refreshToken: body.refresh_token as string, scopes: String(body.scope || '').split(' ').filter(Boolean) };
}

export async function refreshAccessToken(config: YouTubeConfig, refreshToken: string) {
  const { ok, body } = await postForm('https://oauth2.googleapis.com/token', { refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token' });
  if (!ok) throw new YouTubeError(body?.error === 'invalid_grant' ? 'YOUTUBE_REAUTH_REQUIRED' : 'YOUTUBE_OAUTH_FAILED', 401);
  return body.access_token as string;
}

export async function revokeToken(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?${new URLSearchParams({ token })}`, { method: 'POST', signal: AbortSignal.timeout(10000) }).catch(() => undefined);
}

export async function fetchOwnChannel(accessToken: string) {
  const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) });
  const body: any = await response.json().catch(() => ({}));
  const channel = body?.items?.[0];
  if (!response.ok || !channel?.id) throw new YouTubeError('YOUTUBE_CHANNEL_NOT_FOUND', 409);
  const snippet = channel.snippet || {};
  const channelAvatar = String(snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || snippet.thumbnails?.high?.url || '');
  return {
    channelId: String(channel.id),
    channelTitle: String(snippet.title || ''),
    channelAvatar,
  };
}

/** `publishAt` (ISO, future): upload as private and let YouTube make it public at that time. */
export interface UploadMetadata { title: string; description: string; tags: string[]; privacy: 'private' | 'unlisted' | 'public'; categoryId?: string; publishAt?: string }

/** Maps YouTube API error reasons to safe codes. */
export function uploadErrorCode(status: number, body: any) {
  const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
  if (status === 401) return 'YOUTUBE_REAUTH_REQUIRED';
  if (reason === 'quotaExceeded' || reason === 'rateLimitExceeded') return 'YOUTUBE_QUOTA_EXCEEDED';
  if (reason === 'uploadLimitExceeded') return 'YOUTUBE_UPLOAD_LIMIT';
  if (reason === 'youtubeSignupRequired') return 'YOUTUBE_CHANNEL_NOT_FOUND';
  if (status === 403) return 'YOUTUBE_FORBIDDEN';
  return 'YOUTUBE_UPLOAD_FAILED';
}

/**
 * Resumable upload: create a session with the metadata, then send the file in one PUT.
 * AI-generated videos are always declared as synthetic media and not made for kids.
 */
export async function uploadVideo(accessToken: string, filePath: string, metadata: UploadMetadata, onProgress?: (fraction: number) => void) {
  const size = (await stat(filePath)).size;
  const resource = {
    snippet: { title: metadata.title, description: metadata.description, tags: metadata.tags, categoryId: metadata.categoryId || '28', defaultLanguage: 'vi', defaultAudioLanguage: 'vi' },
    // YouTube only accepts publishAt on private videos; it flips them to public at that time.
    status: { privacyStatus: metadata.publishAt ? 'private' : metadata.privacy, ...(metadata.publishAt ? { publishAt: metadata.publishAt } : {}), selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
  };
  const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(size) },
    body: JSON.stringify(resource), signal: AbortSignal.timeout(30000),
  });
  if (!start.ok) throw new YouTubeError(uploadErrorCode(start.status, await start.json().catch(() => ({}))), start.status);
  const location = start.headers.get('location');
  if (!location || !location.startsWith('https://www.googleapis.com/')) throw new YouTubeError('YOUTUBE_UPLOAD_FAILED');

  let sent = 0;
  const stream = createReadStream(filePath);
  stream.on('data', (chunk) => { sent += chunk.length; onProgress?.(sent / size); });
  const upload = await fetch(location, {
    method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) },
    body: Readable.toWeb(stream) as any, duplex: 'half', signal: AbortSignal.timeout(60 * 60_000),
  } as any);
  const body: any = await upload.json().catch(() => ({}));
  if (!upload.ok || typeof body?.id !== 'string') throw new YouTubeError(uploadErrorCode(upload.status, body), upload.status);
  return { youtubeVideoId: body.id as string, privacy: String(body?.status?.privacyStatus || metadata.privacy) };
}

export async function addToPlaylist(accessToken: string, playlistId: string, videoId: string): Promise<boolean> {
  try {
    const res = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snippet: {
          playlistId,
          resourceId: { kind: 'youtube#video', videoId },
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[addToPlaylist] Response:', res.status, err?.error?.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[addToPlaylist] Error:', err?.message);
    return false;
  }
}

export async function setVideoThumbnail(accessToken: string, videoId: string, imagePath: string): Promise<boolean> {
  try {
    const { readFile, stat } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    if (!existsSync(imagePath)) return false;
    const size = (await stat(imagePath)).size;
    const bytes = await readFile(imagePath);
    const mime = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    const res = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': mime,
        'Content-Length': String(size),
      },
      body: bytes,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[setVideoThumbnail] Response:', res.status, err?.error?.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[setVideoThumbnail] Error:', err?.message);
    return false;
  }
}
