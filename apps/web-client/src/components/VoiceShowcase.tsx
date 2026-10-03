import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../api';
import { audioUrl } from '../hooks/useTtsData';
import { SystemVoiceCard } from '../pages/voices/components/SystemVoiceCard';

export function VoiceShowcase() {
  const [voices, setVoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(false);
    api.get('/voices/catalogue', { signal: controller.signal })
      .then(r => { if (!controller.signal.aborted) setVoices(r.data.data.systemVoices); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef(false);

  const scrollBy = (offset: number) => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  const update3DEffect = () => {
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    const centerX = container.scrollLeft + container.clientWidth / 2;
    const cards = container.querySelectorAll('.voice-card-wrapper');
    cards.forEach((c) => {
      const card = c as HTMLElement;
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const distance = cardCenter - centerX;
      
      const maxDistance = container.clientWidth / 2;
      let ratio = distance / maxDistance;
      // Soft clamp
      ratio = Math.max(-1.5, Math.min(1.5, ratio));
      
      // Dramatic curve: up to 55 degrees inward rotation
      const rotateY = ratio * -55; 
      
      // Push back significantly based on distance from center
      const translateZ = Math.abs(ratio) * -200;
      
      // Keep scale close to 1, let translateZ handle the size reduction naturally via perspective
      const scale = 1 - (Math.abs(ratio) * 0.05);
      
      // Stronger perspective (800px) gives a more dramatic 3D effect
      card.style.transform = `perspective(800px) translateZ(${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`;
    });
  };

  useEffect(() => {
    if (voices.length === 0) return;
    update3DEffect();
    
    let animationFrameId: number;
    const scroll = () => {
      if (!hoverRef.current && scrollRef.current) {
        scrollRef.current.scrollLeft += 1;
        // Reset when halfway through (since we duplicate the list)
        if (scrollRef.current.scrollLeft >= scrollRef.current.scrollWidth / 2) {
          scrollRef.current.scrollLeft = 0;
        }
        update3DEffect();
      }
      animationFrameId = requestAnimationFrame(scroll);
    };
    animationFrameId = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(animationFrameId);
  }, [voices.length]);

  const displayVoices = [...voices, ...voices];

  return <section id="voices" className="py-20 bg-slate-50 overflow-hidden scroll-mt-24"><div className="max-w-[1400px] mx-auto px-6">
    <div className="flex flex-wrap items-end justify-between gap-6 mb-8">
      <div>
        <p className="text-sm font-semibold text-indigo-600 mb-2">THƯ VIỆN GIỌNG ĐỌC</p>
        <h2 className="text-3xl font-bold text-slate-900">Nghe giọng thật, tìm phong cách của bạn</h2>
        <p className="text-slate-600 mt-3">Nghe thử miễn phí các giọng hệ thống, không cần đăng nhập. Quyền tạo audio phụ thuộc gói bạn chọn.</p>
      </div>
      <div className="flex items-center gap-4">
        <Link to="/voices#clone" className="rounded-xl bg-indigo-600 text-white px-5 py-3 font-semibold shadow-md hover:bg-indigo-700 transition-colors shadow-indigo-200">Clone giọng ngay →</Link>
      </div>
    </div>
    {loading ? <p role="status">Đang tải các giọng nghe thử...</p> : error ? <p role="alert">Không tải được thư viện. <button className="underline" onClick={() => setRetry(v => v + 1)}>Thử lại</button></p> : voices.length ? 
      <div 
        className="relative group -mx-6 px-6"
        onMouseEnter={() => hoverRef.current = true}
        onMouseLeave={() => hoverRef.current = false}
        onTouchStart={() => hoverRef.current = true}
        onTouchEnd={() => hoverRef.current = false}
      >
        <button 
          onClick={() => scrollBy(-370)} 
          className="absolute left-8 top-[40%] -translate-y-1/2 z-10 p-4 rounded-full bg-white/90 backdrop-blur-sm border border-slate-200 text-slate-800 hover:bg-white hover:text-indigo-600 hover:scale-110 hover:shadow-lg transition-all shadow-md opacity-0 group-hover:opacity-100 disabled:opacity-0"
        >
          <ChevronLeft size={28} />
        </button>
        
        <button 
          onClick={() => scrollBy(370)} 
          className="absolute right-8 top-[40%] -translate-y-1/2 z-10 p-4 rounded-full bg-white/90 backdrop-blur-sm border border-slate-200 text-slate-800 hover:bg-white hover:text-indigo-600 hover:scale-110 hover:shadow-lg transition-all shadow-md opacity-0 group-hover:opacity-100 disabled:opacity-0"
        >
          <ChevronRight size={28} />
        </button>

        <div 
          className="flex gap-5 overflow-x-hidden pb-16 pt-12 px-8 -mt-12" 
          ref={scrollRef}
          onScroll={update3DEffect}
          onPlayCapture={e => e.currentTarget.querySelectorAll('audio').forEach(a => { if (a !== e.target) a.pause(); })}
          style={{ scrollBehavior: 'smooth', WebkitOverflowScrolling: 'touch', maskImage: 'linear-gradient(to right, transparent, black 15%, black 85%, transparent)', WebkitMaskImage: 'linear-gradient(to right, transparent, black 15%, black 85%, transparent)' }}
        >
          {displayVoices.map((v, idx) => (
            <div key={`${v.id}-${idx}`} className="voice-card-wrapper flex-shrink-0 w-[350px] relative origin-center" style={{ transformStyle: 'preserve-3d' }}>
              <div className="transition-all duration-300 hover:scale-110 hover:-translate-y-2 hover:shadow-[0_20px_50px_rgba(99,102,241,0.25)] relative rounded-2xl h-full bg-white z-10 hover:z-50" style={{ transform: 'translateZ(1px)' }}>
                <SystemVoiceCard name={v.name} gender={v.gender} avatarUrl={v.avatarUrl || undefined} tags={[v.language?.startsWith('vi') ? 'Tiếng Việt' : v.language, v.gender === 'male' ? 'Nam' : v.gender === 'female' ? 'Nữ' : 'Khác', ...(v.tags || [])]} previewUrl={v.previewUrl ? audioUrl(v.previewUrl) : undefined} previewText={v.previewText} />
              </div>
            </div>
          ))}
        </div>
      </div> 
      : <p>Thư viện giọng đang được cập nhật.</p>}
    <Link to="/voices" className="inline-block mt-6 font-semibold text-indigo-600">Khám phá thư viện & quản lý giọng →</Link>
  </div></section>;
}
