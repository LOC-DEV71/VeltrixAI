import { errorMessage } from '../utils/userMessages';
import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Sparkles, FileText, ArrowRight, Save, Star } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Dropdown } from '../components/ui/Dropdown';
import { api } from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { waitForContentJob } from '../utils/pollContentJob';

type EditorState = 'EMPTY' | 'LOADING' | 'GENERATED';

export const ContentEditorPage: React.FC = () => {
  if (typeof document !== 'undefined') document.title = 'Veltrix AI - Studio Kịch bản';

  const [searchParams, setSearchParams] = useSearchParams();
  const contentId = searchParams.get('id');
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const preferences = useRef(user?.preferences); preferences.current = user?.preferences;
  
  const [editorState, setEditorState] = useState<EditorState>('EMPTY');
  const [scenes, setScenes] = useState<any[]>([]);
  const [generatedTarget, setGeneratedTarget] = useState<number | null>(null);
  const estimatedSeconds = Math.round(scenes.reduce((sum, scene) => sum + (Number.isFinite(scene.estimatedDuration) ? scene.estimatedDuration : 0), 0));
  const generation = useRef<{ controller: AbortController; contentId: string | null } | null>(null);
  const generating = useRef(false);

  useEffect(() => () => generation.current?.controller.abort(), []);
  
  // Form state
  const [topic, setTopic] = useState('');
  const [language,setLanguage]=useState('');
  const [platform, setPlatform] = useState(user?.preferences?.platform || 'tiktok');
  const [audience, setAudience] = useState(user?.preferences?.audience ?? 'Gen Z, thích hài hước');
  const [tone, setTone] = useState(user?.preferences?.tone || 'funny');
  const [capabilities, setCapabilities] = useState<any>(null);
  const [capabilityError, setCapabilityError] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [sceneCount, setSceneCount] = useState(0);
  const [structure, setStructure] = useState('auto');
  const [cta, setCta] = useState('');
  const [creativeBrief, setCreativeBrief] = useState('');
  const [visualStyle, setVisualStyle] = useState('');
  const effectiveDuration = capabilities?.durations.includes(durationSeconds) ? durationSeconds : capabilities?.defaultDuration || 0;
  const effectiveCount = capabilities?.advanced && sceneCount >= capabilities.minScenes && sceneCount <= capabilities.maxScenes && sceneCount * 3 <= effectiveDuration ? sceneCount : 0;
  useEffect(() => {
    const controller = new AbortController();
    api.get('/contents/generation-config', { signal: controller.signal }).then(response => setCapabilities(response.data.data))
      .catch(() => { if (!controller.signal.aborted) setCapabilityError('Không tải được cấu hình AI của gói. Hãy tải lại trang.'); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const request = new AbortController();
    if (generation.current && generation.current.contentId !== contentId) {
      generation.current.controller.abort();
      generation.current = null;
      generating.current = false;
    }
    if (!generating.current) {
      setScenes([]);
      setGeneratedTarget(null);
      setEditorState('EMPTY');
      setTopic(''); setLanguage('');
      setPlatform(preferences.current?.platform || 'tiktok');
      setAudience(preferences.current?.audience ?? 'Gen Z, thích hài hước');
      setTone(preferences.current?.tone || 'funny');
      setDurationSeconds(0); setSceneCount(0); setStructure('auto'); setCta(''); setCreativeBrief(''); setVisualStyle('');
      if (contentId) {
        api.get(`/contents/${contentId}`, { signal: request.signal })
          .then(res => {
            if (request.signal.aborted || generating.current) return;
            const settings = res.data.data.generationSettings;
            setGeneratedTarget(typeof settings?.durationSeconds === 'number' ? settings.durationSeconds : null);
            if (settings) {
              if (typeof settings.durationSeconds === 'number') setDurationSeconds(settings.durationSeconds);
              if (typeof settings.sceneCount === 'number') setSceneCount(settings.sceneCount);
              if (typeof settings.structure === 'string') setStructure(settings.structure);
              if (typeof settings.cta === 'string') setCta(settings.cta);
              if (typeof settings.creativeBrief === 'string') setCreativeBrief(settings.creativeBrief);
              if (typeof settings.visualStyle === 'string') setVisualStyle(settings.visualStyle);
              if (typeof settings.language === 'string') setLanguage(settings.language);
              if (typeof settings.topic === 'string') setTopic(settings.topic);
              if (['tiktok', 'shorts', 'reels'].includes(settings.platform)) setPlatform(settings.platform);
              if (typeof settings.audience === 'string') setAudience(settings.audience);
              if (['funny', 'pro', 'drama'].includes(settings.tone)) setTone(settings.tone);
            }
            const loaded = res.data.data.scenes || [];
            setScenes(loaded);
            setEditorState(loaded.length ? 'GENERATED' : 'EMPTY');
          })
          .catch(err => {
            if (!request.signal.aborted) toast.error('Lỗi tải nội dung: ' + errorMessage(err));
          });
      }
    }
    return () => request.abort();
  }, [contentId]);

  const handleGenerate = async () => {
    if (generating.current) return;
    if (!topic.trim()) {
      toast.error('Vui lòng nhập chủ đề trước khi tạo kịch bản!');
      return;
    }

    let currentContentId = contentId;
    const controller = new AbortController();
    const currentGeneration = { controller, contentId: currentContentId };
    generation.current = currentGeneration;
    generating.current = true;
    setEditorState('LOADING');
    const config = { signal: controller.signal, timeout: 30000 };

    try {
      // Auto-create content if missing
      if (!currentContentId) {
        const projectName = topic.trim().split(/\s+/).slice(0, 10).join(' ').slice(0, 200);
        
        const pRes = await api.post('/projects', { name: projectName }, config);
        const projectId = pRes.data.data._id;
        
        const cRes = await api.post('/contents', { projectId, rawText: '' }, config);
        currentContentId = cRes.data.data._id;
        if (!currentContentId) throw new Error('Không nhận được ID nội dung');
        currentGeneration.contentId = currentContentId;
        setSearchParams({ id: currentContentId }, { replace: true });
      }

      if (!currentContentId) throw new Error('Không tìm thấy nội dung');
      
      const res = await api.post(`/contents/${currentContentId}/generate`, {
        topic, platform, audience, tone, language: language || capabilities.languages[0], durationSeconds: effectiveDuration, sceneCount: effectiveCount,
        structure: capabilities?.advanced ? structure : 'auto', cta: capabilities?.advanced ? cta : '',
        creativeBrief: capabilities?.creativeDirection ? creativeBrief : '', visualStyle: capabilities?.creativeDirection ? visualStyle : ''
      }, config);
      const jobId = res.data.data.jobId;
      if (!jobId) throw new Error('Không nhận được ID tác vụ');
      
      // Start polling
      const job = await waitForContentJob(async () => {
        const status = await api.get(`/jobs/${jobId}`, config);
        return status.data.data;
      }, controller.signal);
      if (job.status !== 'COMPLETED') {
        throw new Error(job.failedReason || (job.status === 'CANCELLED' ? 'Tác vụ đã bị hủy' : 'Tạo kịch bản thất bại'));
      }
      const content = await api.get(`/contents/${currentContentId}`, config);
      if (controller.signal.aborted) return;
      const generatedScenes = content.data.data.scenes || [];
      if (!generatedScenes.length) throw new Error('Tác vụ hoàn tất nhưng chưa có phân cảnh. Vui lòng tải lại nội dung.');
      setScenes(generatedScenes);
      setGeneratedTarget(content.data.data.generationSettings?.durationSeconds ?? effectiveDuration);
      setEditorState('GENERATED');
      toast.success('Đã tạo kịch bản thành công!');
    } catch (err: any) {
      if (!controller.signal.aborted) {
        toast.error(err.message === 'POLL_TIMEOUT'
          ? 'Tác vụ đang xử lý lâu hơn dự kiến. Hãy tải lại nội dung sau; tránh bấm tạo lại ngay.'
          : 'Lỗi khi tạo: ' + errorMessage(err));
        setEditorState(scenes.length ? 'GENERATED' : 'EMPTY');
      }
    } finally {
      if (generation.current === currentGeneration) {
        generation.current = null;
        generating.current = false;
      }
      if (!controller.signal.aborted) await refreshUser();
    }
  };

  return (
    <div className="flex flex-1 h-full overflow-hidden relative">
      {/* Cột trái (Form AI) */}
      <div className="w-[400px] shrink-0 bg-white border-r border-[var(--color-border)] flex flex-col h-full z-10 relative">
        <div className="p-6 pb-2 shrink-0">
          <h2 className="text-xl font-bold text-[var(--color-text-main)] mb-1">Cấu hình Nội dung</h2>
          <p className="text-sm text-[var(--color-text-sub)]">Nhập thông tin để AI tối ưu hóa kịch bản hấp dẫn</p>
        </div>
        
        <fieldset disabled={editorState === 'LOADING'} className="flex-1 min-w-0 overflow-y-auto px-6 py-4 flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--color-text-main)]">Chủ đề <span className="text-[var(--color-primary)]">*</span></label>
            <textarea 
              value={topic}
              maxLength={capabilities?.maxInputChars ?? undefined}
              onChange={(e) => setTopic(e.target.value)}
              className="w-full h-[120px] px-3 py-2 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg-surface)] text-[15px] text-[var(--color-text-main)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)] transition-all resize-none"
              placeholder="VD: Review phim Kẻ trộm mặt trăng 4"
            />
          </div>

          <Dropdown 
            label="Nền tảng"
            value={platform}
            onChange={(event) => setPlatform(event.target.value)}
            options={[
              { label: 'TikTok (Video ngắn)', value: 'tiktok' },
              { label: 'Youtube Shorts', value: 'shorts' },
              { label: 'Youtube ', value: 'video' },
              { label: 'Facebook Reels', value: 'reels' }
            ]}
          />

          <Input 
            label="Đối tượng người xem" 
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
          />

          <Dropdown 
            label="Tone giọng"
            value={tone}
            onChange={(event) => setTone(event.target.value)}
            options={[
              { label: 'Hài hước, hóm hỉnh', value: 'funny' },
              { label: 'Nghiêm túc, chuyên gia', value: 'pro' },
              { label: 'Kịch tính, lôi cuốn', value: 'drama' }
            ]}
          />
          {capabilityError && <p role="alert" className="text-sm text-red-600">{capabilityError}</p>}
          {capabilities && <fieldset disabled={editorState === 'LOADING'} className="space-y-4 border-t border-slate-200 pt-5">
            <Dropdown label="Ngôn ngữ" value={language || capabilities.languages[0]} onChange={event=>setLanguage(event.target.value)} options={capabilities.languages.map((value:string)=>({label:value,value}))}/>
            <legend className="text-sm font-semibold text-indigo-700 px-1">AI {capabilities.name} ? v{capabilities.revision}</legend>
            <p className="text-xs text-slate-500">{Math.max(...capabilities.durations)} giây; tối đa {capabilities.maxScenes} cảnh theo cấu hình.</p>
            <Dropdown label="Thời lượng mục tiêu" value={effectiveDuration} onChange={event => { setDurationSeconds(Number(event.target.value)); setSceneCount(0); }} options={capabilities.durations.map((seconds: number) => ({ label: seconds >= 60 ? `${Math.floor(seconds / 60)} phút${seconds % 60 ? ` ${seconds % 60} giây` : ''}` : `${seconds} giây`, value: String(seconds) }))} />
            {capabilities.advanced && <>
              <label className="block text-sm">Số lượng cảnh (0 = tự động)<input type="number" min={0} max={capabilities.maxScenes} value={sceneCount} onChange={e=>setSceneCount(Number(e.target.value))} className="mt-2 block w-full border rounded-lg p-3"/></label>
              <Dropdown label="Cấu trúc kịch bản" value={structure} onChange={event => setStructure(event.target.value)} options={[{ label: 'AI chọn phù hợp chủ đề', value: 'auto' }, { label: 'AIDA · Thu hút → Hành động', value: 'aida' }, { label: 'PAS · Vấn đề → Giải pháp', value: 'pas' }, { label: 'Storytelling · Kể chuyện', value: 'storytelling' }].filter(option=>capabilities.structures.includes(option.value))} />
              <Input label="CTA mong muốn (tùy chọn)" value={cta} maxLength={capabilities.maxInputChars ?? undefined} placeholder="VD: Mời người xem chia sẻ trải nghiệm" onChange={event => setCta(event.target.value)} />
            </>}
            {capabilities.creativeDirection && <>
              <label className="block text-sm text-slate-700">Định hướng sáng tạo (Pro)<textarea value={creativeBrief} maxLength={capabilities.maxInputChars ?? undefined} placeholder="Góc kể, điểm nhấn, thông điệp và điều cần tránh..." onChange={event => setCreativeBrief(event.target.value)} className="mt-2 w-full min-h-24 rounded-lg border border-slate-200 p-3 text-sm" /></label>
              <Input label="Phong cách hình ảnh (Pro)" value={visualStyle} maxLength={capabilities.maxInputChars ?? undefined} placeholder="VD: Điện ảnh, ánh sáng ấm, nhân vật nhất quán" onChange={event => setVisualStyle(event.target.value)} />
            </>}
          </fieldset>}
        </fieldset>
        
        <div className="p-6 pt-4 shrink-0 bg-white">
          <Button 
            className="w-full gap-2 py-3 bg-[var(--color-primary)] hover:bg-indigo-700" 
            onClick={handleGenerate}
            disabled={editorState === 'LOADING' || !capabilities?.enabled || scenes.length > 0 && !capabilities?.regenerate}
          >
            {editorState === 'LOADING' ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Đang xử lý...
              </span>
            ) : (
              <>
                <Sparkles size={18} />
                Viết nội dung bằng AI ({capabilities?.credits ?? '—'} Credit)
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Cột phải (Editor) */}
      <div className="flex-1 min-w-0 bg-[#F7F8FC] flex flex-col h-full overflow-y-auto relative">
        <div className="max-w-[840px] mx-auto w-full p-8 md:p-10 min-h-full flex flex-col gap-6">
          
          {editorState === 'EMPTY' && (
            <div className="flex-1 flex flex-col items-center justify-center opacity-70 mt-12">
              <h2 className="text-sm font-medium text-[var(--color-text-sub)] mb-4">Nhập chủ đề và cấu hình để bắt đầu viết kịch bản</h2>
              <div className="w-full max-w-2xl bg-white rounded-xl border border-dashed border-gray-300 p-16 flex flex-col items-center justify-center">
                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center border border-gray-100 mb-4">
                  <Sparkles size={24} className="text-gray-400" />
                </div>
              </div>
            </div>
          )}

          {editorState === 'LOADING' && (
            <div className="flex-1 flex flex-col items-center justify-center text-center max-w-md mx-auto">
              <div className="relative w-20 h-20 mb-6">
                <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-[var(--color-primary)] rounded-full border-t-transparent animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles size={24} className="text-[var(--color-primary)] animate-pulse" />
                </div>
              </div>
              <h3 className="text-lg font-bold text-[var(--color-text-main)] mb-2">AI đang sáng tác...</h3>
              <p className="text-[var(--color-text-sub)] text-sm">Vui lòng đợi vài giây để hệ thống tổng hợp thông tin.</p>
            </div>
          )}

          {editorState === 'GENERATED' && (
            <div className="flex flex-col gap-6 animate-in fade-in duration-500 pb-12">
              <div className="bg-white rounded-xl border border-[var(--color-border)] p-6 shadow-sm flex items-start justify-between">
                <div className="flex gap-4">
                  <div className="w-12 h-12 bg-indigo-50 rounded-lg flex items-center justify-center shrink-0">
                    <FileText size={24} className="text-[var(--color-primary)]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-3 mb-1.5">
                      <h1 className="text-lg font-bold text-[var(--color-text-main)]">
                        Kịch bản: Bản thảo AI
                      </h1>
                      <span className="px-2 py-0.5 bg-green-50 text-green-700 text-xs font-medium rounded-full border border-green-100">Vừa tạo</span>
                    </div>
                    <p className="text-sm text-[var(--color-text-sub)]">
                      {scenes.length} phân cảnh • Định dạng {platform}
                    </p>
                    <p className="text-sm text-[var(--color-text-sub)] mt-2">
                      Lời đọc ước tính {estimatedSeconds} giây{generatedTarget ? ` • Mục tiêu ${generatedTarget} giây` : ''}.
                      {' '}Audio thực tế tùy giọng đọc và tốc độ. Bạn có thể chỉnh lời đọc ở bước tiếp theo.
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3 mt-1">
                  <Button variant="outline" className="gap-2 font-medium bg-white text-gray-700 border-gray-200">
                    <Save size={16} /> Lưu bản nháp
                  </Button>
                  <Button 
                    className="gap-2 font-medium bg-[var(--color-primary)] hover:bg-indigo-700"
                    onClick={() => navigate(`/content/scenes?id=${contentId}`)}
                  >
                    Chia cảnh & Tạo Audio <ArrowRight size={16} />
                  </Button>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-[var(--color-border)] p-6 shadow-sm">
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100">
                  <div className="flex items-center gap-2 text-[var(--color-primary)] font-semibold">
                    <Star size={18} className="fill-[var(--color-primary)]" />
                    <span>Nội dung chi tiết kịch bản</span>
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  {scenes.map((scene, i) => (
                    <div key={i} className="border border-gray-100 rounded-lg p-5 bg-gray-50/30">
                      <div className="flex items-center gap-3 mb-3">
                        <span className="font-semibold text-[13px] text-indigo-600">
                          [Cảnh {i+1} - {scene.title || 'Nội dung'}]
                        </span>
                      </div>
                      <p className="text-[15px] text-[var(--color-text-main)] leading-relaxed mb-3">
                        <strong>Thuyết minh:</strong> {scene.narration}
                      </p>
                      <p className="text-[14px] text-[var(--color-text-sub)] leading-relaxed">
                        <strong>Hình ảnh:</strong> {scene.visualDescription}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
