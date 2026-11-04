import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Pagination } from 'antd';
import { Wand2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../api';
import { Button } from '../components/ui/Button';
import { Dropdown } from '../components/ui/Dropdown';
import { Input } from '../components/ui/Input';
import { VoiceSelect } from '../components/ui/VoiceSelect';
import { WorkflowCard } from '../components/workflow/WorkflowCard';
import { IdeaSuggestions } from '../components/IdeaSuggestions';
import { ImageQualityPicker, rememberedPreset, useImagePresets } from '../components/ImageQualityPicker';
import { rememberedTheme, ThemePicker, type VideoThemeId } from '../components/ThemePicker';
import { YouTubeConnect, useYouTube, parseYouTubeErrorMessage } from '../components/YouTubeConnect';
import { errorMessage } from '../utils/userMessages';
import { useAuth } from '../contexts/AuthContext';

interface Run {
  id: string; status: 'RUNNING' | 'COMPLETED' | 'FAILED'; step: string; message: string;
  error: string | null; failedStep: string | null; canRetry: boolean; topic: string; aspectRatio: '9:16' | '16:9';
  publishYoutube: boolean; contentId: string | null; videoId: string | null; videoUrl: string | null; createdAt: string;
}

export const AutoVideoPage: React.FC = () => {
  if (typeof document !== 'undefined') document.title = 'Veltrix AI - Video tự động';
  const { refreshUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const { youtube, reloadYouTube } = useYouTube();
  const [topic, setTopic] = useState('');
  const [platform, setPlatform] = useState('shorts');
  const [audience, setAudience] = useState('Người xem Việt Nam');
  const [tone, setTone] = useState('pro');
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [voiceId, setVoiceId] = useState('');
  const [voices, setVoices] = useState<any[]>([]);
  const [capabilities, setCapabilities] = useState<any>(null);
  const [publishMode, setPublishMode] = useState<'none' | 'immediate' | 'scheduled'>('none');
  const [scheduledAt, setScheduledAt] = useState('');
  const [youtubePrivacy, setYoutubePrivacy] = useState<'private' | 'unlisted' | 'public'>('private');
  const [playlists, setPlaylists] = useState<Array<{ id: string; title: string; itemCount: number }>>([]);
  const [categories, setCategories] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('28');
  const [submitting, setSubmitting] = useState(false);
  const imagePresets = useImagePresets();
  const [imagePreset, setImagePreset] = useState<string | null>(null);
  const chosenPreset = imagePreset ?? rememberedPreset(imagePresets);
  const [videoTheme, setVideoTheme] = useState<VideoThemeId>(rememberedTheme);
  const [pollKey, setPollKey] = useState(0);
  const onRunChanged = useCallback(() => setPollKey((k) => k + 1), []);
  const [runs, setRuns] = useState<Run[]>([]);
  const [page, setPage] = useState(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Result of the Google OAuth redirect.
  useEffect(() => {
    const result = params.get('youtube');
    if (!result) return;
    const reason = params.get('reason');
    if (result === 'connected') {
      toast.success('Đã kết nối tài khoản YouTube thành công!');
    } else {
      toast.error(parseYouTubeErrorMessage(reason));
    }
    void reloadYouTube();
    const next = new URLSearchParams(params);
    next.delete('youtube');
    next.delete('reason');
    setParams(next, { replace: true });
  }, [params, setParams, reloadYouTube]);

  useEffect(() => {
    if (youtube?.connected) {
      api.get('/youtube/playlists')
        .then((r) => {
          if (r.data?.data) {
            setPlaylists(r.data.data.playlists || []);
            setCategories(r.data.data.categories || []);
          }
        })
        .catch(() => {});
    } else {
      setPlaylists([]);
      setCategories([]);
    }
  }, [youtube?.connected]);

  useEffect(() => {
    api.get('/contents/generation-config').then((r) => setCapabilities(r.data.data)).catch(() => undefined);
    api.get('/voices', { params: { page: 1, limit: 50 } }).then((r) => {
      const list = [...r.data.data.systemVoices, ...r.data.data.cloneVoices];
      setVoices(list);
      setVoiceId((current) => current || list.find((v: any) => v.canUse !== false)?.id || '');
    }).catch(() => toast.error('Không tải được danh sách giọng đọc.'));
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const data: Run[] = (await api.get('/auto-videos')).data.data;
      setRuns(data);
      return data.some((r) => r.status === 'RUNNING');
    } catch { return false; }
  }, []);

  // refreshUser changes identity on every user update; keep it out of effect deps
  // so refreshing the balance cannot restart polling in a loop.
  const refreshUserRef = useRef(refreshUser);
  refreshUserRef.current = refreshUser;

  // Poll while any run is still going. Re-armed only after submitting a new run.
  useEffect(() => {
    let cancelled = false, wasRunning = false;
    const tick = async () => {
      const running = await loadRuns();
      if (cancelled) return;
      if (running) { wasRunning = true; timer.current = setTimeout(tick, 3000); }
      else if (wasRunning) void refreshUserRef.current(); // a run just finished: update the Credit balance once
    };
    void tick();
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, [loadRuns, submitting, pollKey]);

  const effectiveDuration = capabilities?.durations?.includes(durationSeconds) ? durationSeconds : capabilities?.defaultDuration || 0;
  // Scripts run about one scene per 6 seconds of narration.
  const sceneEstimate = Math.max(3, Math.round((effectiveDuration || 60) / 6));
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(runs.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRuns = runs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const start = async () => {
    if (topic.trim().length < 5) { toast.error('Hãy nhập một câu chủ đề (ít nhất 5 ký tự).'); return; }
    if (!voiceId) { toast.error('Hãy chọn giọng đọc.'); return; }
    const shouldPublish = publishMode !== 'none';
    if (publishMode === 'scheduled' && (!scheduledAt || new Date(scheduledAt).getTime() < Date.now() + 10 * 60_000)) {
      toast.error('Giờ đăng phải sau hiện tại ít nhất 10 phút.');
      return;
    }
    if (shouldPublish && !youtube?.connected) {
      toast.error('Cần kết nối YouTube để tự động xuất bản video.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auto-videos', {
        topic: topic.trim(),
        platform,
        audience,
        tone,
        voiceId,
        durationSeconds: effectiveDuration || undefined,
        aspectRatio: platform === 'video' ? '16:9' : '9:16',
        publishYoutube: shouldPublish && Boolean(youtube?.connected),
        youtubePrivacy,
        youtubePlaylistId: shouldPublish && selectedPlaylistId ? selectedPlaylistId : undefined,
        youtubeCategoryId: shouldPublish && selectedCategoryId ? selectedCategoryId : undefined,
        // datetime-local has no time zone: send an absolute ISO time.
        scheduledAt: publishMode === 'scheduled' && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        imagePreset: imagePresets?.installed || chosenPreset === 'cloud' ? chosenPreset : 'off',
        theme: videoTheme,
      });
      toast.success('Đã bắt đầu tạo video. Bạn có thể rời trang, hệ thống vẫn tiếp tục chạy.');
      setTopic('');
      setPage(1);
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="flex-1 bg-gradient-to-br from-[#F7F8FC] to-indigo-50/30">
      <div className="max-w-[1480px] mx-auto p-8 grid xl:grid-cols-[400px_minmax(0,1fr)] gap-8 items-start">
        <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-6 space-y-5 self-start xl:sticky xl:top-6" aria-labelledby="auto-video-title">
          <div>
            <h1 id="auto-video-title" className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Wand2 className="text-indigo-600" /> Video tự động</h1>
            <p className="text-sm text-slate-500 mt-1">Nhập một câu, AI viết kịch bản, tạo giọng đọc, dựng video và có thể tự đăng YouTube.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="auto-topic" className="text-sm font-medium text-slate-700">Chủ đề <span className="text-indigo-600">*</span></label>
            <textarea id="auto-topic" value={topic} maxLength={500} onChange={(e) => setTopic(e.target.value)} disabled={submitting}
              placeholder="VD: Điều gì sẽ xảy ra khi Trái Đất ngừng quay?"
              className="w-full h-[100px] px-3 py-2 border border-slate-200 rounded-lg text-[15px] focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none" />
            <IdeaSuggestions seed={topic} disabled={submitting} onApply={(idea) => {
              setTopic(idea.topic); setPlatform(idea.platform); setAudience(idea.audience); setTone(idea.tone);
              if (capabilities?.durations?.includes(idea.durationSeconds)) setDurationSeconds(idea.durationSeconds);
            }} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Dropdown label="Nền tảng" value={platform} onChange={(e) => setPlatform(e.target.value)} options={[
              { label: 'YouTube Shorts', value: 'shorts' }, { label: 'TikTok', value: 'tiktok' }, { label: 'Facebook Reels', value: 'reels' }, { label: 'YouTube (ngang)', value: 'video' },
            ]} />
            <Dropdown label="Tone" value={tone} onChange={(e) => setTone(e.target.value)} options={[
              { label: 'Chuyên gia', value: 'pro' }, { label: 'Hài hước', value: 'funny' }, { label: 'Kịch tính', value: 'drama' },
            ]} />
          </div>
          <Input label="Người xem" value={audience} onChange={(e) => setAudience(e.target.value)} />
          {capabilities && (
            <Dropdown label="Thời lượng mục tiêu" value={String(effectiveDuration)} onChange={(e) => setDurationSeconds(Number(e.target.value))}
              options={capabilities.durations.map((s: number) => ({ label: s >= 60 ? `${Math.floor(s / 60)} phút${s % 60 ? ` ${s % 60} giây` : ''}` : `${s} giây`, value: String(s) }))} />
          )}
          <VoiceSelect label="Giọng đọc" voices={voices} value={voiceId} onChange={setVoiceId} disabled={submitting} />
          <ThemePicker value={videoTheme} onChange={setVideoTheme} disabled={submitting} />
          <ImageQualityPicker value={chosenPreset} onChange={setImagePreset} sceneCount={sceneEstimate} disabled={submitting} presets={imagePresets} />

          <fieldset className="rounded-xl border border-slate-200 p-4 space-y-3.5">
            <legend className="px-1 text-sm font-semibold text-slate-700">Xuất bản YouTube</legend>
            <YouTubeConnect state={youtube} onChange={reloadYouTube} variant="inline" />

            <Dropdown
              label="Đăng sau khi xong"
              value={publishMode}
              onChange={(e) => setPublishMode(e.target.value as 'none' | 'immediate' | 'scheduled')}
              options={[
                { label: 'Không đăng', value: 'none' },
                { label: 'Đăng ngay', value: 'immediate' },
                { label: 'Đăng vào giờ đã chọn', value: 'scheduled' },
              ]}
            />

            {publishMode !== 'none' && !youtube?.connected && (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
                <span><strong className="font-medium">Cần kết nối YouTube</strong> để video được đăng sau khi hoàn thành.</span>
                <Link to="/account/settings" className="font-semibold text-red-600 hover:underline shrink-0">
                  Cài đặt →
                </Link>
              </div>
            )}

            {publishMode === 'scheduled' && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Giờ đăng video</label>
                <input
                  type="datetime-local"
                  disabled={submitting}
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            )}

            {publishMode !== 'none' && youtube?.connected && (
              <>
                {publishMode === 'scheduled' ? (
                  <p className="text-xs text-slate-500">Video được tải lên ở chế độ riêng tư khi làm xong, YouTube tự công khai đúng giờ đã chọn. Nếu video làm xong sau giờ đó, nó sẽ được công khai sau 15 phút.</p>
                ) : <Dropdown
                  label="Chế độ hiển thị"
                  value={youtubePrivacy}
                  onChange={(e) => setYoutubePrivacy(e.target.value as any)}
                  options={[
                    { label: 'Riêng tư (khuyên dùng để duyệt trước)', value: 'private' },
                    { label: 'Không công khai', value: 'unlisted' },
                    { label: 'Công khai', value: 'public' },
                  ]}
                />}

                <Dropdown
                  label="Danh sách phát (Playlists)"
                  value={selectedPlaylistId}
                  onChange={(e) => setSelectedPlaylistId(e.target.value)}
                  options={[
                    { label: 'Không thêm vào danh sách phát', value: '' },
                    ...playlists.map((p) => ({ label: `${p.title} (${p.itemCount} video)`, value: p.id })),
                  ]}
                />

                <Dropdown
                  label="Danh mục video (Category)"
                  value={selectedCategoryId}
                  onChange={(e) => setSelectedCategoryId(e.target.value)}
                  options={categories.map((c) => ({ label: c.title, value: c.id }))}
                />

                <p className="text-[11px] text-slate-500">
                  Video được tự khai báo nội dung AI, tự động tải lên ảnh bìa Thumbnail từ cảnh Hook và thêm vào danh sách phát đã chọn.
                </p>
              </>
            )}
          </fieldset>

          <Button className="w-full gap-2 py-3" disabled={submitting || !voiceId} onClick={start}>
            <Wand2 size={18} /> {submitting ? 'Đang gửi...' : 'Tạo video tự động'}
          </Button>
          <p className="text-xs text-slate-500">Credit được trừ theo từng bước như khi làm thủ công: viết kịch bản, giọng đọc theo số ký tự, và dựng video. Bước nào lỗi do hệ thống sẽ được hoàn Credit.</p>
        </section>

        <section className="space-y-4" aria-label="Các video gần đây">
          <h2 className="text-lg font-bold text-slate-800">Video gần đây</h2>
          {!runs.length && <p className="text-sm text-slate-500">Chưa có video nào. Nhập một câu chủ đề để bắt đầu.</p>}
          {pagedRuns.map((run, index) => (
            <WorkflowCard
              key={run.id}
              runId={run.id}
              onChanged={onRunChanged}
              defaultExpanded={currentPage === 1 && index === 0}
            />
          ))}
          <Pagination
            current={currentPage}
            total={runs.length}
            pageSize={pageSize}
            showSizeChanger={false}
            onChange={setPage}
            hideOnSinglePage
          />
        </section>
      </div>
    </div>
  );
};
