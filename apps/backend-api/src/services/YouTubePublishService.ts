import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Job, type IJob } from '../models/Job';
import { Video } from '../models/Video';
import { Scene } from '../models/Scene';
import { YouTubeConnection, YouTubeOAuthState } from '../models/YouTubeConnection';
import { forOwner, claimPlanJob } from './EntitlementService';
import { setJobProgress } from './JobProgress';
import {
  YouTubeError, getYouTubeConfig, checkYouTubeEnv, authorizationUrl, exchangeCode, fetchOwnChannel, encryptToken, decryptToken,
  refreshAccessToken, revokeToken, uploadVideo, addToPlaylist, setVideoThumbnail, sha256, type YouTubeConfig, type UploadMetadata,
} from '../providers/YouTubeProvider';

export const PUBLISH_STAGES = [
  { stage: 'PREPARING', message: 'Đang kiểm tra kết nối YouTube' },
  { stage: 'UPLOADING', message: 'Đang tải video lên YouTube' },
  { stage: 'SAVING', message: 'Đang lưu liên kết YouTube' },
];

export function getStartOfDayInVietnam(now = new Date()): Date {
  const vnTime = new Date(now.getTime() + 7 * 3600 * 1000);
  const year = vnTime.getUTCFullYear();
  const month = vnTime.getUTCMonth();
  const date = vnTime.getUTCDate();
  return new Date(Date.UTC(year, month, date) - 7 * 3600 * 1000);
}

export const youtubeDailyLimit = (env: NodeJS.ProcessEnv = process.env) => {
  const value = Number(env.YOUTUBE_DAILY_UPLOADS);
  return Number.isSafeInteger(value) && value > 0 ? value : 3;
};
const PRIVACY = ['private', 'unlisted', 'public'] as const;

const requireConfig = () => {
  const config = getYouTubeConfig();
  if (!config) throw new YouTubeError('YOUTUBE_NOT_CONFIGURED', 503);
  return config;
};

/** Starts OAuth. The state is single use, bound to this user and expires in 10 minutes. */
export async function startConnect(ownerId: mongoose.Types.ObjectId, returnPath: unknown) {
  const config = requireConfig();
  const path = typeof returnPath === 'string' && /^\/[A-Za-z0-9/_-]{0,100}$/.test(returnPath) ? returnPath : '/auto-video';
  const state = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(48).toString('base64url');
  await YouTubeOAuthState.create({ stateHash: sha256(state), ownerId, codeVerifier, returnPath: path, expiresAt: new Date(Date.now() + 10 * 60_000) });
  return { url: authorizationUrl(config, state, codeVerifier) };
}

/** OAuth callback. Returns the client URL to redirect the browser to. */
export async function completeConnect(state: unknown, code: unknown, oauthError: unknown) {
  const config = getYouTubeConfig();
  const clientUrl = config?.clientUrl || process.env.YOUTUBE_CLIENT_URL || 'http://localhost:5173';
  const fallback = (reason: string) => `${clientUrl}/auto-video?youtube=error&reason=${encodeURIComponent(reason)}`;

  if (!config) return fallback('not_configured');
  if (typeof state !== 'string' || !state) return fallback('invalid_state');

  const pending = await YouTubeOAuthState.findOneAndDelete({ stateHash: sha256(state), expiresAt: { $gt: new Date() } });
  if (!pending) return fallback('invalid_state');

  const backSuccess = () => `${config.clientUrl}${pending.returnPath}?youtube=connected`;
  const backError = (reason: string) => `${config.clientUrl}${pending.returnPath}?youtube=error&reason=${encodeURIComponent(reason)}`;

  if (oauthError === 'access_denied') return backError('access_denied');
  if (oauthError || typeof code !== 'string' || !code) return backError(typeof oauthError === 'string' ? oauthError : 'access_denied');

  try {
    const tokens = await exchangeCode(config, code, pending.codeVerifier);
    if (!tokens.scopes.includes('https://www.googleapis.com/auth/youtube.upload')) {
      await revokeToken(tokens.refreshToken);
      return backError('missing_scope');
    }
    const channel = await fetchOwnChannel(tokens.accessToken);
    const previous = await YouTubeConnection.findOne({ ownerId: pending.ownerId }).select('+refreshTokenEncrypted');
    await YouTubeConnection.updateOne(
      { ownerId: pending.ownerId },
      {
        $set: {
          ...channel,
          refreshTokenEncrypted: encryptToken(tokens.refreshToken, config.encryptionKey),
          scopes: tokens.scopes,
          status: 'ACTIVE',
          connectedAt: new Date(),
        },
      },
      { upsert: true },
    );
    if (previous) {
      try {
        await revokeToken(decryptToken(previous.refreshTokenEncrypted, config.encryptionKey));
      } catch {
        /* old token unreadable: nothing to revoke */
      }
    }
    return backSuccess();
  } catch (error) {
    if (error instanceof YouTubeError) {
      if (error.code === 'YOUTUBE_CHANNEL_NOT_FOUND') return backError('no_channel');
      if (error.code === 'YOUTUBE_OFFLINE_ACCESS_DENIED') return backError('offline_denied');
    }
    return backError('oauth_failed');
  }
}

export async function getConnection(ownerId: mongoose.Types.ObjectId) {
  const envCheck = checkYouTubeEnv();
  const connection = await YouTubeConnection.findOne({ ownerId }).lean();
  const today = getStartOfDayInVietnam();
  const dailyLimit = youtubeDailyLimit();
  const usedToday = await Job.countDocuments({ ownerId, type: 'YOUTUBE_PUBLISH', status: { $ne: 'FAILED' }, createdAt: { $gte: today } });
  const remainingToday = Math.max(0, dailyLimit - usedToday);

  let status: 'NOT_CONFIGURED' | 'NOT_CONNECTED' | 'CONNECTED' | 'NEEDS_REAUTH' = 'NOT_CONNECTED';
  if (!envCheck.ok) {
    status = 'NOT_CONFIGURED';
  } else if (!connection) {
    status = 'NOT_CONNECTED';
  } else if (connection.status === 'NEEDS_REAUTH') {
    status = 'NEEDS_REAUTH';
  } else if (connection.status === 'ACTIVE') {
    status = 'CONNECTED';
  }

  return {
    configured: envCheck.ok,
    status,
    connected: status === 'CONNECTED',
    needsReauth: status === 'NEEDS_REAUTH',
    channelTitle: connection?.channelTitle ?? null,
    channelAvatar: connection?.channelAvatar ?? null,
    channelId: connection?.channelId ?? null,
    connectedAt: connection?.connectedAt ?? null,
    dailyLimit,
    usedToday,
    remainingToday,
    missingEnv: envCheck.ok ? [] : envCheck.missing,
  };
}

export async function disconnect(ownerId: mongoose.Types.ObjectId) {
  const connection = await YouTubeConnection.findOneAndDelete({ ownerId }).select('+refreshTokenEncrypted');
  const config = getYouTubeConfig();
  if (connection && config) {
    try {
      await revokeToken(decryptToken(connection.refreshTokenEncrypted, config.encryptionKey));
    } catch {
      /* ignore */
    }
  }
  return { connected: false };
}

export const YOUTUBE_CATEGORIES = [
  { id: '28', title: 'Khoa học & Công nghệ' },
  { id: '27', title: 'Giáo dục' },
  { id: '24', title: 'Giải trí' },
  { id: '22', title: 'Mọi người & Blog' },
  { id: '23', title: 'Hài kịch' },
  { id: '25', title: 'Tin tức & Chính trị' },
  { id: '20', title: 'Trò chơi (Gaming)' },
  { id: '26', title: 'Hướng dẫn & Phong cách' },
  { id: '1', title: 'Phim & Hoạt ảnh' },
  { id: '10', title: 'Âm nhạc' },
  { id: '17', title: 'Thể thao' },
  { id: '19', title: 'Du lịch & Sự kiện' },
];

export async function getPlaylistsAndCategories(ownerId: mongoose.Types.ObjectId) {
  const playlists = await getPlaylists(ownerId);
  return {
    playlists,
    categories: YOUTUBE_CATEGORIES,
  };
}

export async function getPlaylists(ownerId: mongoose.Types.ObjectId) {
  const connection = await YouTubeConnection.findOne({ ownerId, status: 'ACTIVE' }).select('+refreshTokenEncrypted');
  if (!connection) return [];
  const config = getYouTubeConfig();
  if (!config) return [];
  try {
    const refreshToken = decryptToken(connection.refreshTokenEncrypted, config.encryptionKey);
    const accessToken = await refreshAccessToken(config, refreshToken);
    const res = await fetch('https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map((item: any) => ({
      id: String(item.id),
      title: String(item.snippet?.title || 'Không tên'),
      description: String(item.snippet?.description || ''),
      itemCount: Number(item.contentDetails?.itemCount || 0),
    }));
  } catch (err: any) {
    console.warn('[getPlaylists]', err?.message);
    return [];
  }
}

const clip = (value: string, max: number) => [...value.replace(/[<>]/g, '').replace(/[^\S\r\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()].slice(0, max).join('');

/** Default title/description for an AI video, using AI generation when available. */
export async function defaultMetadata(video: any, title?: string): Promise<Omit<UploadMetadata, 'privacy'>> {
  const scenes = await Scene.find({ projectId: video.projectId }).sort({ order: 1 }).select('narration title').lean();
  const videoTitle = clip(title || scenes[0]?.title || 'Video Veltrix AI', 100) || 'Video Veltrix AI';
  const fullNarration = scenes.map((s) => s.narration).filter(Boolean).join(' ');
  const credits = (video.scenes || []).filter((s: any) => s.imageSource === 'PEXELS' && s.credit?.photographer).map((s: any) => s.credit.photographer);
  // CC BY / BY-SA photos must be attributed: author / Wikimedia Commons (license) + file page.
  const realCredits = (video.scenes || []).filter((s: any) => s.imageSource === 'WIKIMEDIA' && s.credit?.photographer).map((s: any) => `${s.credit.photographer}${s.credit.pageUrl ? ` ${s.credit.pageUrl}` : ''}`);

  let aiDesc = '';
  let aiTags: string[] = [];

  try {
    const { createContentAiProvider } = await import('../providers/AiProvider');
    const ai = createContentAiProvider();
    const prompt = `Bạn là chuyên gia sáng tạo nội dung YouTube và YouTube Shorts hàng đầu.
Hãy viết một phần mô tả hấp dẫn và tạo danh sách thẻ tag (tags) chuẩn SEO cho video:
- Tiêu đề / Chủ đề: ${videoTitle}
- Nội dung tóm tắt: ${clip(fullNarration, 1500)}
- Định dạng: ${video.aspectRatio === '9:16' ? 'YouTube Shorts (dọc 9:16)' : 'Video YouTube thông thường'}

Yêu cầu định dạng JSON:
{
  "description": "Mô tả cuốn hút từ 2-4 câu giới thiệu sự kịch tính hoặc thông điệp của chủ đề, đặt câu hỏi gợi mở cho khán giả bình luận. Đính kèm 3-5 hashtag ở cuối (ví dụ: #shorts #vutru #khoahoc...). Không lặp lại nguyên văn kịch bản.",
  "tags": ["danh sách 8-12 thẻ tag liên quan nhất, dạng từ khóa ngắn gọn, ví dụ: vũ trụ, người ngoài hành tinh, khoa học..."]
}`;

    const schema = {
      type: 'object',
      properties: {
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } }
      },
      required: ['description', 'tags']
    };

    const res = await ai.generate({
      instruction: 'Chuyên gia tối ưu hóa mô tả và thẻ tag YouTube tiếng Việt.',
      prompt,
      schema,
      maxOutputTokens: 1024,
      timeoutMs: 10000
    });

    const parsed = JSON.parse(res.text);
    if (typeof parsed?.description === 'string' && parsed.description.trim()) {
      aiDesc = parsed.description.trim();
    }
    if (Array.isArray(parsed?.tags)) {
      aiTags = parsed.tags.map((t: any) => String(t || '').trim()).filter((t: string) => t.length > 1 && t.length < 50);
    }
  } catch {
    // Fallback if AI provider is unavailable
  }

  if (!aiDesc) {
    aiDesc = clip(fullNarration, 300);
    if (aiDesc && !aiDesc.endsWith('.')) aiDesc += '...';
  }

  const lines = [
    aiDesc,
    '',
    '📌 Cần tool làm video tự động 100% liên hệ email: lamchilocwork5@gmail.com (giá 399k vĩnh viễn không tốn credit).',
    '',
    'Video được tạo với sự hỗ trợ của AI (Veltrix AI): kịch bản, giọng đọc và dựng hình.',
    ...(credits.length ? [`Ảnh: ${[...new Set(credits)].join(', ')} (Pexels).`] : []),
    ...(realCredits.length ? ['Ảnh tư liệu:', ...[...new Set(realCredits)].map((c) => `- ${c}`)] : []),
    ...(video.aspectRatio === '9:16' && !aiDesc.toLowerCase().includes('#shorts') ? ['#Shorts'] : []),
  ];

  const tags = Array.from(new Set([
    ...aiTags,
    'Veltrix AI',
    'AI',
    ...(video.aspectRatio === '9:16' ? ['Shorts'] : []),
  ])).slice(0, 15);

  return {
    title: videoTitle,
    description: clip(lines.join('\n'), 4900).replace(/ (?=\n)/g, ''),
    tags,
  };
}

/** Scheduled publish time: ISO date at least 10 minutes and at most 180 days ahead. Empty = publish now. */
export function parsePublishAt(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  const now = Date.now();
  if (Number.isNaN(date.getTime()) || date.getTime() < now + 10 * 60_000 || date.getTime() > now + 180 * 86_400_000) throw new YouTubeError('YOUTUBE_PUBLISH_AT_INVALID');
  return date;
}

export async function createYouTubePublishJob(ownerId: mongoose.Types.ObjectId, videoId: string, input: { privacy?: unknown; title?: unknown; playlistId?: unknown; categoryId?: unknown; publishAt?: unknown; lateOk?: boolean }) {
  requireConfig();
  if (!mongoose.isObjectIdOrHexString(videoId)) throw new YouTubeError('NOT_FOUND', 404);
  const privacy = PRIVACY.includes(input.privacy as any) ? input.privacy as UploadMetadata['privacy'] : 'private';
  // A schedule chosen when the run started may have passed while it rendered (lateOk): publish soon instead.
  let publishAt: Date | null = null;
  try { publishAt = parsePublishAt(input.publishAt); }
  catch (error) { if (!input.lateOk || Number.isNaN(new Date(String(input.publishAt)).getTime())) throw error; publishAt = new Date(Date.now() + 15 * 60_000); }
  const playlistId = typeof input.playlistId === 'string' && input.playlistId.trim() ? input.playlistId.trim() : undefined;
  const categoryId = typeof input.categoryId === 'string' && input.categoryId.trim() ? input.categoryId.trim() : undefined;
  const video = await Video.findOne({ _id: videoId, ownerId, deletedAt: null }).lean();
  if (!video) throw new YouTubeError('NOT_FOUND', 404);
  if (!await YouTubeConnection.exists({ ownerId, status: 'ACTIVE' })) throw new YouTubeError('YOUTUBE_NOT_CONNECTED', 409);
  const previous = await Job.findOne({ ownerId, type: 'YOUTUBE_PUBLISH', 'payload.videoId': video._id }).sort({ createdAt: -1 });
  if (previous && previous.status !== 'FAILED') return { job: previous, reused: true };
  const today = getStartOfDayInVietnam();
  if (await Job.countDocuments({ ownerId, type: 'YOUTUBE_PUBLISH', status: { $ne: 'FAILED' }, createdAt: { $gte: today } }) >= youtubeDailyLimit()) throw new YouTubeError('YOUTUBE_DAILY_LIMIT', 429);
  const metadata = await defaultMetadata(video, typeof input.title === 'string' ? input.title : undefined);
  const snapshot = await forOwner(ownerId);
  const job = await Job.create({
    ownerId, type: 'YOUTUBE_PUBLISH', status: 'QUEUED', idempotencyKey: `youtube:${video._id}:${previous ? Date.now() : 'first'}`,
    payload: { videoId: video._id, privacy, playlistId, categoryId, publishAt: publishAt ? publishAt.toISOString() : null, ...metadata, entitlementSnapshot: snapshot, priority: snapshot.config.limits.queuePriority },
  });
  return { job, reused: false };
}

export const claimPublishJob = (jobId?: string) => claimPlanJob({ ...(jobId ? { _id: jobId } : {}), type: 'YOUTUBE_PUBLISH' }, 70 * 60_000);

export interface PublishDeps {
  config: YouTubeConfig | null;
  storageDir: string;
  upload?: typeof uploadVideo;
  refresh?: typeof refreshAccessToken;
  thumbnail?: typeof setVideoThumbnail;
  playlist?: typeof addToPlaylist;
}

export async function processPublishJob(job: IJob, deps: PublishDeps) {
  const fence = { _id: job._id, type: 'YOUTUBE_PUBLISH', status: 'PROCESSING', executionClaim: job.executionClaim };
  const progress = (stage: string, message?: string, percent?: number) => setJobProgress(job._id as mongoose.Types.ObjectId, job.executionClaim, PUBLISH_STAGES, stage, message, percent);
  const heartbeat = setInterval(() => { Job.updateOne(fence, { $set: { leaseExpiresAt: new Date(Date.now() + 70 * 60_000) } }).catch(() => {}); }, 60_000); heartbeat.unref();
  try {
    await progress('PREPARING');
    if (!deps.config) throw new YouTubeError('YOUTUBE_NOT_CONFIGURED');
    if (job.attempts > 3) throw new YouTubeError('YOUTUBE_RETRY_EXHAUSTED');
    const video = await Video.findOne({ _id: job.payload.videoId, ownerId: job.ownerId, deletedAt: null });
    if (!video) throw new YouTubeError('NOT_FOUND');
    const connection = await YouTubeConnection.findOne({ ownerId: job.ownerId, status: 'ACTIVE' }).select('+refreshTokenEncrypted');
    if (!connection) throw new YouTubeError('YOUTUBE_NOT_CONNECTED');
    let accessToken: string;
    try { accessToken = await (deps.refresh ?? refreshAccessToken)(deps.config, decryptToken(connection.refreshTokenEncrypted, deps.config.encryptionKey)); }
    catch (error) {
      if (error instanceof YouTubeError && error.code === 'YOUTUBE_REAUTH_REQUIRED') await YouTubeConnection.updateOne({ _id: connection._id }, { $set: { status: 'NEEDS_REAUTH' } });
      throw error;
    }
    await progress('UPLOADING', 'Đang tải video lên YouTube 0%');
    let last = -1;
    const uploaded = await (deps.upload ?? uploadVideo)(accessToken, join(deps.storageDir, video.storageKey), {
      title: job.payload.title,
      description: job.payload.description,
      tags: job.payload.tags,
      privacy: job.payload.privacy,
      categoryId: job.payload.categoryId,
      // Queued for a while? A publish time that has passed would be rejected: move it 15 minutes ahead.
      ...(job.payload.publishAt ? { publishAt: new Date(Math.max(Date.parse(job.payload.publishAt), Date.now() + 15 * 60_000)).toISOString() } : {}),
    }, (fraction) => {
      const percent = Math.floor(fraction * 20) * 5;
      if (percent !== last) { last = percent; void progress('UPLOADING', `Đang tải video lên YouTube ${percent}%`, percent); }
    });

    // Auto-set thumbnail (from Scene 1 hook or custom thumbnail)
    try {
      const { SceneImage } = await import('../models/SceneImage');
      const dedicatedThumb = await SceneImage.findOne({ projectId: video.projectId, order: 0, status: 'READY' }).select('file').lean();
      const scene1Image = await SceneImage.findOne({ projectId: video.projectId, order: 1, status: 'READY' }).select('file').lean();
      const thumbFile = job.payload.thumbnailFile || dedicatedThumb?.file || scene1Image?.file;
      if (thumbFile) {
        console.log('[youtube-publish] Uploading thumbnail for video:', uploaded.youtubeVideoId, 'path:', thumbFile);
        const ok = await (deps.thumbnail ?? setVideoThumbnail)(accessToken, uploaded.youtubeVideoId, thumbFile);
        console.log('[youtube-publish] Thumbnail upload result:', ok ? 'SUCCESS' : 'FAILED/SKIPPED');
      } else {
        console.log('[youtube-publish] No thumbnail file found for video:', uploaded.youtubeVideoId);
      }
    } catch (err: any) {
      console.warn('[youtube-publish] Thumbnail set error:', err?.message);
    }

    // Add to playlist if specified
    if (job.payload.playlistId) {
      try {
        console.log('[youtube-publish] Adding video to playlist:', job.payload.playlistId);
        const ok = await (deps.playlist ?? addToPlaylist)(accessToken, String(job.payload.playlistId), uploaded.youtubeVideoId);
        console.log('[youtube-publish] Playlist addition result:', ok ? 'SUCCESS' : 'FAILED/SKIPPED');
      } catch (err: any) {
        console.warn('[youtube-publish] Playlist add error:', err?.message);
      }
    }

    await progress('SAVING');
    const url = `https://www.youtube.com/watch?v=${uploaded.youtubeVideoId}`;
    await Video.updateOne({ _id: video._id }, { $set: { youtube: { videoId: uploaded.youtubeVideoId, url, privacy: uploaded.privacy, channelId: connection.channelId, uploadedAt: new Date() } } });
    await Job.updateOne(fence, { $set: { status: 'COMPLETED', result: { youtubeVideoId: uploaded.youtubeVideoId, url, privacy: uploaded.privacy }, leaseExpiresAt: undefined } });
  } catch (error) {
    if (error instanceof YouTubeError && error.code === 'YOUTUBE_REAUTH_REQUIRED') await YouTubeConnection.updateOne({ ownerId: job.ownerId }, { $set: { status: 'NEEDS_REAUTH' } });
    const code = error instanceof YouTubeError ? error.code : 'YOUTUBE_UPLOAD_FAILED';
    if (code === 'YOUTUBE_UPLOAD_FAILED') console.error('[youtube-publish]', (error as any)?.message);
    await Job.updateOne(fence, { $set: { status: 'FAILED', error: code, leaseExpiresAt: undefined } });
  } finally { clearInterval(heartbeat); }
}
