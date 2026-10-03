import { VoiceShowcase } from '../components/VoiceShowcase';
import React, { useRef, useState, useEffect } from 'react';
import { motion, useScroll, useTransform, AnimatePresence, useSpring } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Mic, Video, Layout, ArrowRight, Layers, Type, Image as ImageIcon, Play, CheckCircle2, Wand2, Frame, MonitorPlay, Code2, ShieldCheck, Lock, FileCheck, Server, Heart } from 'lucide-react';
import { cn } from '../utils/cn';
import { useAuth } from '../contexts/AuthContext';
import { PlanCards } from '../components/PlanCards';
import { Button } from '../components/ui/Button';
import { useSEO } from '../hooks/useSEO';

const useLandingActions = () => {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  const openApp = (path: string) => {
    if (!loading) navigate(user ? path : '/login');
  };

  const openStudio = () => {
    if (loading) return;
    if (user) navigate('/workspace');
    else document.getElementById('studio-preview')?.scrollIntoView({ behavior: 'smooth' });
  };

  return { user, loading, openApp, openStudio, navigate };
};

// --- SHARED COMPONENTS ---
const GradientText = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <span className={cn("bg-clip-text text-transparent bg-gradient-to-r from-slate-900 via-indigo-600 to-cyan-500", className)}>
    {children}
  </span>
);

const FlowLine = ({ progress, className }: { progress: any, className?: string }) => (
  <motion.div 
    className={cn("h-[2px] bg-gradient-to-r from-cyan-400 via-blue-500 to-violet-500 shadow-[0_0_12px_rgba(99,102,241,0.5)]", className)}
    style={{ scaleX: progress, transformOrigin: 'left' }}
  />
);

// --- 01. BRAND INTRO ---
const Intro = ({ onComplete }: { onComplete: () => void }) => {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 1800);
    const t2 = setTimeout(onComplete, 2600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onComplete]);

  return (
    <AnimatePresence>
      {stage === 0 && (
        <motion.div 
          className="fixed inset-0 z-[100] bg-white flex items-center justify-center pointer-events-none"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
        >
          <div className="flex flex-col items-center relative">
            <motion.div 
               layoutId="brand-logo"
               initial={{ filter: 'blur(20px)', scale: 1.1, opacity: 0 }}
               animate={{ filter: 'blur(0px)', scale: 1, opacity: 1 }}
               transition={{ duration: 1.2, ease: "easeOut" }}
               className="relative z-10"
            >
              <img src="/logo-full.png" alt="Veltrix AI" className="h-[180px]" />
            </motion.div>
            <motion.div 
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               transition={{ delay: 0.6, duration: 0.8 }}
               className="text-lg md:text-xl font-medium tracking-[0.2em] text-slate-500 mt-2 z-10"
            >
              AI CREATOR
            </motion.div>
            
            {/* Thin cyan/blue light passing through */}
            <motion.div 
              initial={{ x: '-150%', opacity: 0 }}
              animate={{ x: '150%', opacity: 1 }}
              transition={{ delay: 0.4, duration: 1.5, ease: "easeInOut" }}
              className="absolute top-1/2 -translate-y-1/2 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent blur-[1px] z-20"
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// --- 02. NAVBAR ---
const Navbar = () => {
  const { user, loading, openApp, navigate } = useLandingActions();
  const { scrollY } = useScroll();
  const bgOpacity = useTransform(scrollY, [0, 50], [0, 0.8]);
  const blur = useTransform(scrollY, [0, 50], [0, 12]);
  const borderColor = useTransform(scrollY, [0, 50], ['rgba(226,232,240,0)', 'rgba(226,232,240,0.8)']);
  const shadow = useTransform(scrollY, [0, 50], ['none', '0 4px 20px rgba(0,0,0,0.03)']);
  
  return (
    <motion.nav 
      style={{ 
        backgroundColor: useTransform(bgOpacity, v => `rgba(255, 255, 255, ${v})`),
        backdropFilter: useTransform(blur, v => `blur(${v}px)`),
        borderColor,
        boxShadow: shadow
      }}
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-1 md:px-12 md:py-2 border-b transition-all"
    >
      <div className="flex items-center gap-2 cursor-pointer relative">
        <motion.div layoutId="brand-logo" className="flex items-center">
          <img src="/logo-full.png" alt="Veltrix AI" className="h-[58px]" />
        </motion.div>
      </div>
      <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-500">
        <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="hover:text-slate-900 transition-colors">Trang Chủ</button>
        <button onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })} className="hover:text-slate-900 transition-colors">Tính Năng</button>
        <button onClick={() => document.getElementById('voices')?.scrollIntoView({ behavior: 'smooth' })} className="hover:text-slate-900 transition-colors">Giọng Đọc</button>
        <button onClick={() => document.getElementById('workflow')?.scrollIntoView({ behavior: 'smooth' })} className="hover:text-slate-900 transition-colors">Quy Trình</button>
        <button onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })} className="hover:text-slate-900 transition-colors">Bảng Giá</button>
        <button onClick={() => document.getElementById('policies')?.scrollIntoView({ behavior: 'smooth' })} className="hover:text-slate-900 transition-colors">Chính Sách</button>
        <button onClick={() => document.getElementById('developer')?.scrollIntoView({ behavior: 'smooth' })} className="hover:text-slate-900 transition-colors">Developer</button>
      </div>
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/docs')} className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors hidden sm:block">Tài Liệu</button>
        <button onClick={() => openApp('/workspace')} disabled={loading} className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors hidden sm:block disabled:opacity-50">{loading ? 'Đang kiểm tra...' : user ? 'Workspace của tôi' : 'Đăng Nhập'}</button>
        <button onClick={() => openApp('/content')} disabled={loading} className="px-5 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-full hover:bg-indigo-600 transition-colors shadow-md disabled:opacity-50 disabled:cursor-wait">
          {loading ? 'Đang kiểm tra...' : user ? 'Tạo nội dung' : 'Bắt Đầu Sáng Tạo'}
        </button>
      </div>
    </motion.nav>
  );
};

// --- 03 & 04. HERO ---
const Hero = () => {
  const { user, loading, openApp, openStudio } = useLandingActions();
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef, offset: ["start start", "end start"] });
  const springProgress = useSpring(scrollYProgress, { stiffness: 100, damping: 30, restDelta: 0.001 });

  // Animations based on 150vh sticky scroll
  // 0-20%: Static
  // 20-45%: Layers move inward
  // 45-65%: Converge to center
  // 65-85%: Generated image emerges
  // 85-100%: Generated image expands

  const coreOpacity = useTransform(springProgress, [0, 0.2, 0.45], [0.5, 0.8, 1]);
  const coreScale = useTransform(springProgress, [0, 0.45, 0.65], [1, 1.2, 0]);
  
  const layerRadius = useTransform(springProgress, [0.2, 0.65], [200, 0]);
  const layerOpacity = useTransform(springProgress, [0.45, 0.65], [1, 0]);

  const frameOpacity = useTransform(springProgress, [0.65, 0.85], [0, 1]);
  const frameScale = useTransform(springProgress, [0.65, 0.85, 1], [0.5, 1, 1.5]);

  const layers = [
    { icon: <Type />, label: "NỘI DUNG", angle: 0 },
    { icon: <Mic />, label: "GIỌNG NÓI", angle: 72 },
    { icon: <ImageIcon />, label: "HÌNH ẢNH", angle: 144 },
    { icon: <Layers />, label: "PHÂN CẢNH", angle: 216 },
    { icon: <Video />, label: "VIDEO", angle: 288 },
  ];

  return (
    <section ref={containerRef} className="h-[150vh] relative bg-white">
      <div className="sticky top-0 h-screen overflow-hidden flex items-center justify-center px-6 md:px-12">
        
        {/* Background Ambience */}
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="absolute top-1/2 left-3/4 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[radial-gradient(circle,rgba(99,102,241,0.08)_0%,transparent_60%)] rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-[radial-gradient(circle,rgba(45,212,191,0.05)_0%,transparent_60%)] rounded-full blur-3xl" />
        </div>

        <div className="w-full max-w-7xl mx-auto grid md:grid-cols-2 gap-12 items-center relative z-10">
          {/* LEFT: Typography */}
          <div className="space-y-8">
            <h1 className="text-6xl md:text-8xl font-medium tracking-tighter leading-[1.05] text-slate-900">
              SÁNG TẠO <br/>
              KHÔNG <br/>
              <GradientText>GIỚI HẠN.</GradientText>
            </h1>
            <p className="text-xl text-slate-500 font-light max-w-md leading-relaxed">
              Biến ý tưởng thành nội dung, giọng nói, phân cảnh, hình ảnh, ảnh thu nhỏ và video thông qua một quy trình thông minh.
            </p>
            <div className="flex gap-4">
              <button onClick={() => openApp('/content')} disabled={loading} className="px-8 py-4 bg-slate-900 text-white rounded-full font-medium shadow-xl hover:-translate-y-0.5 transition-transform disabled:opacity-50 disabled:cursor-wait">{loading ? 'Đang kiểm tra...' : user ? 'Viết nội dung bằng AI' : 'Bắt Đầu Cùng AI'}</button>
              <button onClick={openStudio} disabled={loading} className="px-8 py-4 bg-white text-slate-900 border border-slate-200 rounded-full font-medium hover:bg-slate-50 transition-colors disabled:opacity-50">{user ? 'Vào Workspace' : 'Khám Phá Studio'}</button>
            </div>
          </div>

          {/* RIGHT: Creative Core Visual */}
          <div className="relative h-[500px] w-full flex items-center justify-center">
            {/* Luminous Core */}
            <motion.div 
              style={{ opacity: coreOpacity, scale: coreScale }}
              className="absolute w-24 h-24 bg-white rounded-full border border-indigo-100 shadow-[0_0_50px_rgba(99,102,241,0.3)] flex items-center justify-center z-20"
            >
               <Sparkles className="text-indigo-500" size={32} />
            </motion.div>

            {/* Orbiting Layers */}
            {layers.map((layer) => (
              <motion.div
                key={layer.label}
                className="absolute z-10"
                style={{
                  opacity: layerOpacity,
                  x: useTransform(layerRadius, r => r * Math.cos((layer.angle * Math.PI) / 180)),
                  y: useTransform(layerRadius, r => r * Math.sin((layer.angle * Math.PI) / 180)),
                }}
              >
                <div className="flex flex-col items-center gap-2">
                  <div className="w-14 h-14 bg-white/80 backdrop-blur-md rounded-2xl border border-slate-200 shadow-lg flex items-center justify-center text-slate-600">
                    {layer.icon}
                  </div>
                  <span className="text-[10px] font-bold tracking-widest text-slate-400">{layer.label}</span>
                </div>
              </motion.div>
            ))}

            {/* Generated Image Frame */}
            <motion.div 
              style={{ opacity: frameOpacity, scale: frameScale }}
              className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
            >
               <div className="w-[400px] aspect-[4/3] bg-gradient-to-br from-indigo-100 via-white to-cyan-50 rounded-3xl border border-white shadow-2xl overflow-hidden relative">
                 <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000&auto=format&fit=crop')] bg-cover bg-center mix-blend-overlay opacity-40" />
                 <div className="absolute inset-0 border border-indigo-500/20 rounded-3xl" />
               </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
};

// --- 06. AI GENERATION SECTION ---
const ImageGeneration = () => {
  const { loading, openApp } = useLandingActions();
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef, offset: ["start center", "end center"] });
  
  // Custom deterministic animation for the generation
  const lineProgress = useTransform(scrollYProgress, [0.3, 0.6], [0, 1]);
  const blur = useTransform(scrollYProgress, [0.6, 0.8], [20, 0]);
  const opacity = useTransform(scrollYProgress, [0.5, 0.7], [0, 1]);

  return (
    <section id="features" ref={containerRef} className="py-32 bg-white relative scroll-mt-24">
      <div className="max-w-7xl mx-auto px-6">
        <h2 className="text-4xl md:text-5xl font-medium tracking-tight text-slate-900 mb-20 text-center">
          Khởi nguồn ý tưởng. <br/>
          <GradientText>Veltrix tạo ra nó.</GradientText>
        </h2>

        <div className="grid md:grid-cols-12 gap-8 items-center">
          {/* Left: Prompt Composer */}
          <div className="md:col-span-5 bg-white rounded-3xl border border-slate-200 shadow-xl p-8 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-slate-100">
               <FlowLine progress={lineProgress} className="h-full" />
            </div>
            
            <div className="mb-6">
              <label className="text-xs font-bold tracking-widest text-slate-400 uppercase">Câu lệnh</label>
              <p className="mt-2 text-lg text-slate-700 font-medium leading-relaxed">
                "Một thành phố tương lai đậm chất điện ảnh lơ lửng trên những đám mây lúc bình minh, chi tiết sắc nét, Unreal Engine 5"
              </p>
            </div>
            
            <div className="flex flex-wrap gap-2 mb-8">
              <span className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-medium text-slate-600">Tỉ lệ 16:9</span>
              <span className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-medium text-slate-600">Phong cách Cinematic</span>
              <span className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-medium text-slate-600">Chất lượng 8k</span>
            </div>

            <button onClick={() => openApp('/content')} disabled={loading} className="w-full py-4 bg-slate-900 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-wait">
              <Sparkles size={18} /> {loading ? 'Đang kiểm tra...' : 'Tạo nội dung & prompt'}
            </button>
          </div>

          {/* Right: Generated Preview */}
          <div className="md:col-span-7 aspect-[16/9] bg-slate-50 rounded-3xl border border-slate-200 overflow-hidden relative shadow-2xl flex items-center justify-center">
             <motion.div 
               style={{ opacity, filter: useTransform(blur, v => `blur(${v}px)`) }}
               className="absolute inset-0 bg-[url('https://res.cloudinary.com/dfzgowb54/image/upload/v1790883187/ab9xkpjecilttmighs65.jpg')] bg-cover bg-center"
             />
             {/* Scanning Line Effect */}
             <motion.div 
               style={{ top: useTransform(scrollYProgress, [0.4, 0.8], ["0%", "100%"]), opacity: useTransform(scrollYProgress, [0.4, 0.7, 0.8], [1, 1, 0]) }}
               className="absolute left-0 right-0 h-[2px] bg-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.8)] z-10"
             />
             <ImageIcon size={48} className="text-slate-300 relative z-0" />
          </div>
        </div>
      </div>
    </section>
  );
};

// --- 07, 08, 09. ONE IDEA -> OUTPUTS (WORKFLOW) ---
const Workflow = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef, offset: ["start end", "end start"] });

  const steps = [
    { id: 'idea', icon: <Type size={20} />, label: 'Ý Tưởng' },
    { id: 'content', icon: <Layout size={20} />, label: 'Nội Dung' },
    { id: 'voice', icon: <Mic size={20} />, label: 'Giọng Đọc' },
    { id: 'scenes', icon: <Layers size={20} />, label: 'Phân Cảnh' },
    { id: 'image', icon: <ImageIcon size={20} />, label: 'Hình Ảnh' },
    { id: 'video', icon: <MonitorPlay size={20} />, label: 'Video' }
  ];

  return (
    <section id="workflow" ref={containerRef} className="py-32 bg-slate-50 border-y border-slate-200 relative overflow-hidden scroll-mt-24">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-24">
          <h2 className="text-4xl font-medium text-slate-900 mb-4">Một luồng sáng tạo xuyên suốt.</h2>
          <p className="text-slate-500 font-light">Toàn bộ quy trình của bạn, được tự động hóa và kết nối hoàn hảo.</p>
        </div>

        <div className="relative max-w-5xl mx-auto">
           {/* Flow Line Background */}
           <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-slate-200 -translate-y-1/2" />
           {/* Animated Flow Line */}
           <div className="absolute top-1/2 left-0 right-0 h-[2px] -translate-y-1/2 overflow-hidden">
             <FlowLine progress={useTransform(scrollYProgress, [0.2, 0.8], [0, 1])} className="h-full" />
           </div>

           <div className="grid grid-cols-6 relative z-10">
             {steps.map((step, i) => {
               const start = 0.2 + (i * 0.1);
               const scale = useSpring(useTransform(scrollYProgress, (v): number => v > start ? 1 : 0.9), { stiffness: 300, damping: 20 });
               const opacity = useTransform(scrollYProgress, v => v > start ? 1 : 0.5);
               const bg = useTransform(scrollYProgress, v => v > start ? '#ffffff' : '#f8fafc');
               const border = useTransform(scrollYProgress, v => v > start ? '#6366f1' : '#e2e8f0');
               const color = useTransform(scrollYProgress, v => v > start ? '#4f46e5' : '#94a3b8');

               return (
                 <div key={step.id} className="flex flex-col items-center">
                   <motion.div 
                     style={{ scale, opacity, backgroundColor: bg, borderColor: border, color }}
                     className="w-14 h-14 rounded-2xl border-2 flex items-center justify-center shadow-sm relative bg-white"
                   >
                     {step.icon}
                     {/* Pulse indicator */}
                     <motion.div 
                       style={{ opacity: useTransform(scrollYProgress, v => (v > start && v < start + 0.15) ? 1 : 0) }}
                       className="absolute inset-0 border-2 border-indigo-400 rounded-2xl animate-ping opacity-20"
                     />
                   </motion.div>
                   <motion.span 
                     style={{ color: useTransform(scrollYProgress, v => v > start ? '#0f172a' : '#94a3b8') }}
                     className="mt-4 text-xs font-bold tracking-widest uppercase"
                   >
                     {step.label}
                   </motion.span>
                 </div>
               );
             })}
           </div>
        </div>
      </div>
    </section>
  );
};

// --- 10. STUDIO REVEAL ---
const StudioReveal = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef, offset: ["start end", "center center"] });
  const springProgress = useSpring(scrollYProgress, { stiffness: 100, damping: 30 });

  const scale = useTransform(springProgress, [0, 1], [0.85, 1]);
  const rotateX = useTransform(springProgress, [0, 1], [15, 0]);
  const y = useTransform(springProgress, [0, 1], [100, 0]);

  return (
    <section id="studio-preview" ref={containerRef} className="py-40 bg-[#FAFAFA] perspective-[2000px] relative scroll-mt-24">
      <div className="max-w-7xl mx-auto px-6 mb-16 text-center">
        <h2 className="text-4xl md:text-5xl font-medium text-slate-900">
          Không gian sáng tạo <GradientText>đỉnh cao.</GradientText>
        </h2>
      </div>

      <motion.div 
        style={{ scale, rotateX, y }}
        className="max-w-7xl mx-auto px-6"
      >
        <div className="rounded-3xl border border-slate-200 bg-white shadow-[0_30px_60px_rgba(0,0,0,0.08)] overflow-hidden ring-1 ring-slate-900/5 flex flex-col h-[700px]">
          {/* Fake Mac Header */}
          <div className="h-12 border-b border-slate-100 flex items-center px-4 gap-2 bg-slate-50">
            <div className="w-3 h-3 rounded-full bg-slate-300" />
            <div className="w-3 h-3 rounded-full bg-slate-300" />
            <div className="w-3 h-3 rounded-full bg-slate-300" />
            <span className="ml-4 text-xs font-medium text-slate-400">Veltrix Studio</span>
          </div>
          
          <div className="flex-1 grid grid-cols-12 bg-white">
            {/* Sidebar */}
            <div className="col-span-2 border-r border-slate-100 bg-slate-50/50 p-4 space-y-2">
              <div className="h-8 bg-indigo-50 text-indigo-600 rounded-lg flex items-center px-3 text-sm font-medium gap-2">
                <Layout size={14} /> Dự Án
              </div>
              <div className="h-8 hover:bg-slate-100 text-slate-600 rounded-lg flex items-center px-3 text-sm font-medium gap-2 transition-colors">
                <ImageIcon size={14} /> Tài Nguyên
              </div>
              <div className="h-8 hover:bg-slate-100 text-slate-600 rounded-lg flex items-center px-3 text-sm font-medium gap-2 transition-colors">
                <Wand2 size={14} /> Câu Lệnh
              </div>
            </div>
            
            {/* Canvas / Preview */}
            <div className="col-span-7 p-6 bg-slate-50/30 flex flex-col gap-4">
              <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex items-center justify-center relative overflow-hidden">
                <div className="w-16 h-16 bg-white rounded-full shadow-lg flex items-center justify-center cursor-pointer hover:scale-105 transition-transform z-10">
                  <Play className="text-indigo-600 ml-1" fill="currentColor" size={24} />
                </div>
                <div className="absolute inset-0 bg-slate-100 flex items-center justify-center text-slate-300">
                  <MonitorPlay size={48} strokeWidth={1} />
                </div>
              </div>
              
              {/* Fake Timeline */}
              <div className="h-32 bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-col gap-3">
                 <div className="h-6 bg-slate-50 rounded border border-slate-100 flex items-center px-2 gap-1">
                   {[1,2,3,4,5,6,7].map(i => <div key={i} className="h-4 w-1 bg-slate-200 rounded-full" />)}
                 </div>
                 <div className="flex-1 flex gap-2">
                   <div className="flex-[2] bg-indigo-50 border border-indigo-100 rounded-lg" />
                   <div className="flex-[1] bg-cyan-50 border border-cyan-100 rounded-lg" />
                   <div className="flex-[3] bg-violet-50 border border-violet-100 rounded-lg" />
                 </div>
              </div>
            </div>

            {/* Right Project Tree */}
            <div className="col-span-3 border-l border-slate-100 p-6 bg-white">
              <h3 className="text-xs font-bold text-slate-400 mb-6 uppercase tracking-wider">Cấu Trúc Tệp</h3>
              <div className="space-y-4">
                {['Nội Dung', 'Giọng Đọc', 'Ảnh Thu Nhỏ', 'Phân Cảnh', 'Hình Ảnh', 'Video'].map((label) => (
                  <div key={label} className="flex items-center gap-3 group cursor-pointer">
                    <div className="w-5 h-5 rounded bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
                      <CheckCircle2 size={12} />
                    </div>
                    <span className="text-sm font-medium text-slate-700">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
};

// --- 11. BENTO FEATURES ---
const BentoFeatures = () => {
  return (
    <section className="py-24 bg-white relative">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid md:grid-cols-3 gap-6 auto-rows-[250px]">
          
          {/* Large: Image Gen */}
          <div className="md:col-span-2 row-span-2 bg-slate-50 rounded-3xl border border-slate-200 p-8 flex flex-col justify-between relative overflow-hidden group">
            <div className="relative z-10 max-w-sm">
              <h3 className="text-2xl font-medium text-slate-900 mb-2">Tạo Ảnh Chuyên Nghiệp</h3>
              <p className="text-slate-500 font-light">Cho ra đời những hình ảnh đẹp mắt chỉ bằng vài dòng miêu tả.</p>
            </div>
            <div className="absolute right-0 bottom-0 w-2/3 h-2/3 bg-white border-t border-l border-slate-200 rounded-tl-3xl shadow-2xl p-6 transform translate-x-8 translate-y-8 group-hover:translate-x-4 group-hover:translate-y-4 transition-transform duration-500">
               <div className="w-full h-full bg-slate-100 rounded-xl border border-slate-200 flex items-center justify-center overflow-hidden relative">
                 <Frame className="text-slate-300" size={32} />
                 <div className="absolute top-0 bottom-0 left-1/2 w-[2px] bg-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.8)] animate-[scan_2s_ease-in-out_infinite_alternate]" />
               </div>
            </div>
          </div>

          {/* Medium: Voice */}
          <div className="bg-slate-50 rounded-3xl border border-slate-200 p-8 flex flex-col justify-between group">
            <div>
              <h3 className="text-xl font-medium text-slate-900 mb-2">Giọng Đọc Điện Ảnh</h3>
              <p className="text-slate-500 font-light text-sm">Thuyết minh AI chuẩn phòng thu chuyên nghiệp.</p>
            </div>
            <div className="h-16 flex items-center gap-1 justify-center mt-4">
              {[...Array(20)].map((_, i) => (
                <div key={i} className="w-1 bg-indigo-400 rounded-full animate-[pulse_1s_ease-in-out_infinite]" style={{ animationDelay: `${i * 0.1}s`, height: `${Math.random() * 80 + 20}%` }} />
              ))}
            </div>
          </div>

          {/* Medium: Scenes */}
          <div className="bg-slate-50 rounded-3xl border border-slate-200 p-8 flex flex-col justify-between group">
            <div>
              <h3 className="text-xl font-medium text-slate-900 mb-2">Phân Cảnh Thông Minh</h3>
              <p className="text-slate-500 font-light text-sm">Tự động chia tách và ghép nối kịch bản.</p>
            </div>
            <div className="flex gap-2 mt-4">
               <div className="flex-1 bg-white border border-slate-200 rounded-xl aspect-[9/16] shadow-sm transform group-hover:-translate-y-2 transition-transform" />
               <div className="flex-1 bg-white border border-slate-200 rounded-xl aspect-[9/16] shadow-sm transform group-hover:translate-y-2 transition-transform mt-4" />
            </div>
          </div>

        </div>
      </div>
    </section>
  );
};

// --- 12 & 13 & 14. CTA & FOOTER ---
const FinalCTA = () => {
  const { user, loading, openApp } = useLandingActions();
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef, offset: ["start end", "end end"] });
  const lineProgress = useSpring(scrollYProgress, { stiffness: 50, damping: 20 });

  return (
    <section ref={containerRef} className="py-40 bg-[#FAFAFA] border-t border-slate-200 relative overflow-hidden">
      <div className="max-w-4xl mx-auto px-6 text-center relative z-10 flex flex-col items-center">
        <h2 className="text-5xl md:text-7xl font-medium tracking-tight text-slate-900 mb-6 uppercase">
          Trí tưởng tượng của bạn.<br/>
          <GradientText>Được chắp cánh bởi AI.</GradientText>
        </h2>
        <p className="text-xl text-slate-500 mb-12 font-light max-w-2xl mx-auto">
          Tạo nội dung, giọng đọc, phân cảnh, hình ảnh và video <br/> ngay trong một không gian thông minh duy nhất.
        </p>
        
        {/* Veltrix Flow Line passes through */}
        <div className="w-full flex justify-center mb-12 h-[2px]">
           <FlowLine progress={lineProgress} className="w-64" />
        </div>

        <button onClick={() => openApp('/workspace')} disabled={loading} className="group px-10 py-5 bg-slate-900 text-white rounded-full font-medium text-lg hover:scale-105 transition-all shadow-[0_10px_30px_rgba(0,0,0,0.05)] hover:shadow-[0_15px_40px_rgba(99,102,241,0.2)] flex items-center gap-3 disabled:opacity-50 disabled:cursor-wait">
          {loading ? 'Đang kiểm tra...' : user ? 'Tiếp tục sáng tạo' : 'Bắt Đầu Miễn Phí'} <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
    </section>
  );
};

// --- 13. FOOTER ---
const Footer = () => {
  return (
    <footer className="bg-slate-50 border-t border-slate-200 pt-16 pb-8 mt-20">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 md:gap-8 mb-12">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <img src="/logo-full.png" alt="Veltrix AI" className="h-[40px]" />
            </div>
            <p className="text-slate-500 max-w-sm mb-6 leading-relaxed">
              Nền tảng sáng tạo nội dung và tổng hợp giọng nói AI hàng đầu. Biến ý tưởng của bạn thành hiện thực chỉ với vài cú click chuột.
            </p>
            <div className="flex gap-4">
              <a href="#" className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 hover:bg-indigo-100 hover:text-indigo-600 transition-colors">
                <span className="sr-only">Facebook</span>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path fillRule="evenodd" d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" clipRule="evenodd" /></svg>
              </a>
              <a href="#" className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 hover:bg-indigo-100 hover:text-indigo-600 transition-colors">
                <span className="sr-only">Twitter</span>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.29 20.251c7.547 0 11.675-6.253 11.675-11.675 0-.178 0-.355-.012-.53A8.348 8.348 0 0022 5.92a8.19 8.19 0 01-2.357.646 4.118 4.118 0 001.804-2.27 8.224 8.224 0 01-2.605.996 4.107 4.107 0 00-6.993 3.743 11.65 11.65 0 01-8.457-4.287 4.106 4.106 0 001.27 5.477A4.072 4.072 0 012.8 9.713v.052a4.105 4.105 0 003.292 4.022 4.095 4.095 0 01-1.853.07 4.108 4.108 0 003.834 2.85A8.233 8.233 0 012 18.407a11.616 11.616 0 006.29 1.84" /></svg>
              </a>
            </div>
          </div>
          <div>
            <h4 className="font-bold text-slate-900 mb-4">Sản Phẩm</h4>
            <ul className="space-y-3">
              <li><button onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })} className="text-sm text-slate-500 hover:text-indigo-600 transition-colors">Tính năng</button></li>
              <li><button onClick={() => document.getElementById('voices')?.scrollIntoView({ behavior: 'smooth' })} className="text-sm text-slate-500 hover:text-indigo-600 transition-colors">Giọng đọc</button></li>
              <li><button onClick={() => document.getElementById('workflow')?.scrollIntoView({ behavior: 'smooth' })} className="text-sm text-slate-500 hover:text-indigo-600 transition-colors">Quy trình</button></li>
              <li><button onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })} className="text-sm text-slate-500 hover:text-indigo-600 transition-colors">Bảng giá</button></li>
            </ul>
          </div>
          <div>
            <h4 className="font-bold text-slate-900 mb-4">Tài Nguyên</h4>
            <ul className="space-y-3">
              <li><a href="/developer" className="text-sm text-slate-500 hover:text-indigo-600 transition-colors">Dành cho Developer</a></li>
              <li><a href="/docs" className="text-sm text-slate-500 hover:text-indigo-600 transition-colors">Tài liệu Hướng dẫn</a></li>
              <li><a href="/chinh-sach-dieu-khoan" className="text-sm text-slate-500 hover:text-indigo-600 transition-colors">Chính sách Bảo mật</a></li>
            </ul>
          </div>
        </div>
        <div className="pt-8 border-t border-slate-200 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-slate-400">© 2026 Veltrix AI. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <span className="text-sm text-slate-400 flex items-center gap-1">Made with <Heart className="w-4 h-4 text-red-500 fill-current" /> in Vietnam</span>
          </div>
        </div>
      </div>
    </footer>
  );
};

export const LandingPage = () => {
  const baseUrl = import.meta.env.VITE_APP_URL || 'https://veltrix.ai';

  useSEO({
    title: 'Veltrix AI - Nền tảng Sáng tạo Nội dung & Trí tuệ Nhân tạo',
    description: 'Veltrix AI cung cấp các giải pháp AI hàng đầu bao gồm tạo nội dung, kịch bản tự động, tổng hợp giọng nói (TTS) chân thực và clone giọng bản quyền. Đột phá hiệu suất sáng tạo của bạn ngay hôm nay.',
    canonical: `${baseUrl}/`,
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebSite",
          "name": "Veltrix AI",
          "url": `${baseUrl}/`,
          "potentialAction": {
            "@type": "SearchAction",
            "target": `${baseUrl}/search?q={search_term_string}`,
            "query-input": "required name=search_term_string"
          }
        },
        {
          "@type": "Organization",
          "name": "Veltrix AI",
          "url": `${baseUrl}/`,
          "logo": `${baseUrl}/logo-full.png`,
          "contactPoint": {
            "@type": "ContactPoint",
            "contactType": "customer support",
            "email": "support@veltrix.ai"
          }
        }
      ]
    }
  });
  const [introDone, setIntroDone] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="bg-[#FAFAFA] min-h-screen text-slate-900 font-sans selection:bg-indigo-500/20 selection:text-indigo-900 overflow-x-hidden">
      <style>{`
        @keyframes scan {
          0% { left: 10%; }
          100% { left: 90%; }
        }
      `}</style>
      
      {/* Intro Overlay */}
      {!introDone && <Intro onComplete={() => setIntroDone(true)} />}
      
      {/* Main Content */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: introDone ? 1 : 0 }} transition={{ duration: 0.8 }}>
        <Navbar />
        <main>
          <Hero />
          <ImageGeneration />
          <Workflow />
          <StudioReveal />
          <BentoFeatures />
          <VoiceShowcase />
          <section id="developer" className="max-w-6xl mx-auto px-6 py-20 font-sans">
            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative rounded-[2.5rem] bg-white p-10 md:p-16 border border-slate-200 shadow-2xl shadow-indigo-900/5 overflow-hidden flex flex-col lg:flex-row items-center gap-12"
            >
              {/* Background Glows */}
              <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-50 rounded-full blur-3xl pointer-events-none translate-x-1/3 -translate-y-1/3"></div>
              
              <div className="relative z-10 lg:w-1/2 flex flex-col items-start text-left">
                <div className="inline-flex items-center justify-center p-3 bg-indigo-50 rounded-2xl shadow-sm border border-indigo-100 mb-6">
                  <Code2 className="w-8 h-8 text-indigo-600" />
                </div>
                <p className="text-indigo-600 text-sm font-bold tracking-widest uppercase mb-4">Veltrix Developer</p>
                <h2 className="text-4xl md:text-5xl font-bold text-slate-900 tracking-tight leading-tight">Đưa giọng đọc vào <br/><span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-cyan-500">ứng dụng của bạn</span></h2>
                <p className="text-slate-500 mt-6 max-w-xl text-lg leading-relaxed">
                  Tích hợp sức mạnh của Veltrix AI qua REST API. Sử dụng giọng hệ thống chất lượng cao hoặc giọng clone độc quyền của riêng bạn chỉ với vài dòng code.
                </p>
                <div className="mt-10 flex flex-wrap items-center gap-4">
                  <Button 
                    size="lg" 
                    onClick={() => navigate('/developer')} 
                    className="gap-2 rounded-2xl px-8 py-4 h-auto shadow-lg hover:shadow-xl transition-all hover:-translate-y-1"
                  >
                    Khám phá API
                    <ArrowRight className="w-5 h-5" />
                  </Button>
                  <Button 
                    variant="outline" 
                    size="lg" 
                    onClick={() => navigate('/docs?section=developer')} 
                    className="rounded-2xl px-8 py-4 h-auto"
                  >
                    Đọc Tài liệu
                  </Button>
                </div>
              </div>

              <div className="relative z-10 lg:w-1/2 w-full">
                {/* Code Window */}
                <div className="relative rounded-2xl bg-[#0d1117] border border-slate-800 shadow-2xl overflow-hidden group">
                  {/* Mac Window Header */}
                  <div className="flex items-center px-4 py-3 border-b border-slate-800 bg-[#161b22]">
                    <div className="flex gap-2">
                      <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                      <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                      <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                    </div>
                    <div className="mx-auto text-xs text-slate-500 font-mono">generate_audio.ts</div>
                  </div>
                  {/* Code Content */}
                  <div className="p-6 text-sm font-mono text-slate-300 overflow-x-auto leading-relaxed">
                    <pre><code className="language-typescript">
<span className="text-pink-400">const</span> response = <span className="text-pink-400">await</span> <span className="text-blue-400">fetch</span>(<span className="text-green-400">'https://api.veltrix.ai/v1/audio/speech'</span>, {'{'}
<br/>  method: <span className="text-green-400">'POST'</span>,
<br/>  headers: {'{'}
<br/>    <span className="text-green-400">'Authorization'</span>: <span className="text-green-400">'Bearer YOUR_API_KEY'</span>,
<br/>    <span className="text-green-400">'Content-Type'</span>: <span className="text-green-400">'application/json'</span>,
<br/>  {'}'},
<br/>  body: <span className="text-blue-400">JSON</span>.<span className="text-yellow-200">stringify</span>({'{'}
<br/>    text: <span className="text-green-400">'Xin chào, đây là giọng đọc từ Veltrix AI'</span>,
<br/>    voice_id: <span className="text-green-400">'vn-hn-female-1'</span>
<br/>  {'}'})
<br/>{'}'});
<br/>
<br/><span className="text-pink-400">const</span> audioBuffer = <span className="text-pink-400">await</span> response.<span className="text-yellow-200">arrayBuffer</span>();
                    </code></pre>
                  </div>
                  
                  {/* Hover flare */}
                  <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/0 via-indigo-500/0 to-cyan-400/10 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"></div>
                </div>
                
                {/* Floating Decorative element */}
                <motion.div 
                  animate={{ y: [0, -10, 0] }} 
                  transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                  className="absolute -bottom-6 -left-6 bg-white rounded-xl shadow-xl p-4 border border-slate-100 flex items-center gap-3 hidden md:flex"
                >
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                    <CheckCircle2 className="text-green-600 w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800">Status: 200 OK</p>
                    <p className="text-[10px] text-slate-500">Audio generated in 0.8s</p>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          </section>

          {/* Trust & Safety Section */}
          <section id="policies" className="max-w-6xl mx-auto px-6 py-20 font-sans">
            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative rounded-[2.5rem] bg-slate-900 p-10 md:p-16 border border-slate-800 shadow-2xl overflow-hidden flex flex-col lg:flex-row-reverse items-center gap-12"
            >
              {/* Background Glows */}
              <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-indigo-500/20 rounded-full blur-3xl pointer-events-none -translate-x-1/3 -translate-y-1/3"></div>
              
              <div className="relative z-10 lg:w-1/2 flex flex-col items-start text-left">
                <div className="inline-flex items-center justify-center p-3 bg-indigo-500/10 rounded-2xl shadow-sm border border-indigo-500/20 mb-6">
                  <ShieldCheck className="w-8 h-8 text-indigo-400" />
                </div>
                <p className="text-indigo-400 text-sm font-bold tracking-widest uppercase mb-4">Veltrix Trust & Safety</p>
                <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight leading-tight">An Toàn & <br/><span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">Bảo Mật Tuyệt Đối</span></h2>
                <p className="text-slate-400 mt-6 max-w-xl text-lg leading-relaxed">
                  Chúng tôi đặt sự an toàn dữ liệu và bản quyền lên hàng đầu. Mọi dữ liệu về giọng nói và kịch bản cá nhân của bạn đều được mã hóa chuyên sâu theo tiêu chuẩn.
                </p>
                <div className="mt-10 flex flex-wrap items-center gap-4">
                  <Button 
                    variant="secondary"
                    size="lg" 
                    onClick={() => navigate('/chinh-sach-dieu-khoan')} 
                    className="gap-2 rounded-2xl px-8 py-4 h-auto shadow-lg hover:shadow-indigo-500/20 transition-all hover:-translate-y-1"
                  >
                    Đọc Điều Khoản
                    <ArrowRight className="w-5 h-5" />
                  </Button>
                </div>
              </div>

              <div className="relative z-10 lg:w-1/2 w-full flex justify-center">
                {/* Visual Glassmorphic Elements */}
                <div className="relative w-full max-w-sm mt-10 lg:mt-0">
                  <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 to-cyan-400 rounded-3xl rotate-6 blur-xl opacity-30"></div>
                  <div className="relative bg-slate-800/80 backdrop-blur-xl border border-slate-700 p-8 rounded-3xl shadow-2xl">
                    <div className="space-y-6">
                      <div className="flex items-center gap-4 border-b border-slate-700/50 pb-6">
                         <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                           <Lock className="w-6 h-6 text-green-400" />
                         </div>
                         <div>
                           <h3 className="text-white font-bold">Bảo mật thông tin</h3>
                           <p className="text-sm text-slate-400">Dữ liệu cá nhân an toàn</p>
                         </div>
                      </div>
                      <div className="flex items-center gap-4 border-b border-slate-700/50 pb-6">
                         <div className="w-12 h-12 rounded-full bg-cyan-500/20 flex items-center justify-center shrink-0">
                           <FileCheck className="w-6 h-6 text-cyan-400" />
                         </div>
                         <div>
                           <h3 className="text-white font-bold">Cam kết bản quyền</h3>
                           <p className="text-sm text-slate-400">Giọng đọc riêng tư 100%</p>
                         </div>
                      </div>
                      <div className="flex items-center gap-4">
                         <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0">
                           <Server className="w-6 h-6 text-indigo-400" />
                         </div>
                         <div>
                           <h3 className="text-white font-bold">Lưu trữ an toàn</h3>
                           <p className="text-sm text-slate-400">Hạ tầng đám mây hiện đại</p>
                         </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Floating Shield */}
                  <motion.div 
                    animate={{ y: [0, -15, 0] }} 
                    transition={{ repeat: Infinity, duration: 5, ease: "easeInOut" }}
                    className="absolute -top-10 -right-6 lg:-right-10 bg-slate-800 rounded-2xl shadow-2xl p-5 border border-slate-700 flex items-center justify-center"
                  >
                    <ShieldCheck className="w-10 h-10 text-cyan-400" />
                  </motion.div>
                </div>
              </div>
            </motion.div>
          </section>

          <PlanCards />
          <FinalCTA />
        </main>
        <Footer />
      </motion.div>
    </div>
  );
};
