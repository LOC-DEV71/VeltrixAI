// Layers 1-3 of every frame: background media (Ken Burns), color grade, animated pattern.
// Each theme has its own fallback backdrop and its own moving pattern (see theme.ts `pattern`).
import React from 'react';
import { AbsoluteFill, Img, interpolate, OffthreadVideo, useCurrentFrame, useVideoConfig } from 'remotion';
import { cameraPose, type CameraMove, type CameraPose } from './camera';
import { easeInOut, float, random } from './motion';
import type { ResolvedBackground } from './schema';
import { alpha, COLORS, STYLE, VARIANT } from './theme';

const BLUR_PX = 8; // rule: 6-10 px

/**
 * Layer 1. Video or photo moved by the scene's camera (from its videoPrompt), or the theme's animated
 * backdrop as the last fallback. Always under a scrim; media is blurred (6-10 px rule).
 */
export const BackgroundLayer: React.FC<{ background: ResolvedBackground; pose: CameraPose; seed: number }> = ({ background, pose, seed }) => {
  const frame = useCurrentFrame();
  const sepia = STYLE.pattern === 'paper';
  const real = background.kind !== 'gradient' && !!background.real;
  const media: React.CSSProperties = {
    width: '100%', height: '100%', objectFit: 'cover',
    transform: `translate(${pose.x}px, ${pose.y}px) scale(${pose.scale}) rotate(${pose.rotate}deg)`,
    filter: [background.kind !== 'gradient' && !background.blurred ? `blur(${BLUR_PX}px)` : '', sepia ? 'sepia(0.75) contrast(1.05)' : '', STYLE.pattern === 'circuit' && !real ? 'saturate(0.6) contrast(1.15)' : ''].filter(Boolean).join(' ') || undefined,
  };
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg, overflow: 'hidden' }}>
      {background.kind === 'video' ? <OffthreadVideo src={background.src} muted style={media} /> : null}
      {background.kind === 'image' ? <Img src={background.src} style={media} /> : null}
      {background.kind === 'gradient' ? <Backdrop seed={seed} frame={frame} zoom={pose.scale} /> : null}
      {/* Scrim so content always stands out. Archival photos get a lighter one so the subject stays visible. */}
      <AbsoluteFill style={{ backgroundColor: alpha(COLORS.bg, background.kind === 'gradient' ? 0.15 : real ? Math.min(0.32, STYLE.scrim) : STYLE.scrim) }} />
      {real && 'credit' in background && background.credit ? (
        <div style={{ position: 'absolute', right: 36, top: '12.5%', maxWidth: '62%', textAlign: 'right', fontFamily: "'Be Vietnam Pro', sans-serif", fontWeight: 500, fontSize: 22, color: 'rgba(255,255,255,0.72)', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
          Ảnh tư liệu: {background.credit}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** Camera pose for a scene at a frame: eased (never linear) over the scene's on-screen length. */
export function scenePose(move: CameraMove, frame: number, length: number, strong: boolean): CameraPose {
  const t = interpolate(frame, [0, Math.max(1, length)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeInOut });
  return cameraPose(move, t, strong);
}

/** The theme's fallback backdrop when there is no photo or video. Cheap: gradients only, no CSS blur. */
const Backdrop: React.FC<{ seed: number; frame: number; zoom: number }> = ({ seed, frame, zoom }) => {
  const c = COLORS;
  const drift = (amp: number, period: number, k: number) => float(frame, amp, period, seed * 31 + k * 50);
  const flip = VARIANT.flip ? -1 : 1;
  const layers: string[] = (() => {
    switch (STYLE.pattern) {
      case 'paper': // warm lamp light on old paper
        return [
          `radial-gradient(ellipse 90% 70% at ${(VARIANT.flip ? 30 : 68) + drift(6, 300, 1)}% ${(VARIANT.justify === 'upper' ? 22 : 40) + drift(4, 260, 2)}%, ${alpha('#5A3E22', 0.95)} 0%, ${alpha('#2A1C10', 0.9)} 55%, ${alpha(c.bg, 1)} 100%)`,
        ];
      case 'chart': // cool navy with a gold horizon glow
        return [
          `linear-gradient(180deg, ${alpha('#0E2A55', 1)} 0%, ${alpha(c.bg, 1)} 60%)`,
          `radial-gradient(ellipse 120% 40% at ${(VARIANT.flip ? 25 : 75) + flip * drift(10, 240, 1)}% ${VARIANT.justify === 'upper' ? 0 : 100}%, ${alpha(c.primary, 0.35)} 0%, ${alpha(c.primary, 0)} 70%)`,
        ];
      case 'circuit': // near black with a single cold spot
        return [
          `radial-gradient(circle at ${30 + flip * drift(12, 200, 1) + (VARIANT.flip ? 40 : 0)}% ${30 + drift(8, 230, 2)}%, ${alpha(c.primary, 0.22)} 0%, ${alpha(c.primary, 0)} 45%)`,
          `radial-gradient(circle at ${75 - flip * drift(10, 210, 3)}% 80%, ${alpha(c.secondary, 0.14)} 0%, ${alpha(c.secondary, 0)} 40%)`,
        ];
      case 'bokeh': // canopy light: green depth with a warm sun spot
        return [
          `radial-gradient(circle at ${VARIANT.flip ? 78 : 22}% ${14 + drift(4, 300, 1)}%, ${alpha(c.accent, 0.55)} 0%, ${alpha(c.accent, 0)} 35%)`,
          `linear-gradient(170deg, ${alpha(c.primary, 0.45)} 0%, ${alpha('#0F3B27', 0.9)} 45%, ${alpha(c.bg, 1)} 100%)`,
        ];
      case 'halftone': // flat, bright, two-tone diagonal
        return [
          `linear-gradient(${VARIANT.flip ? 135 : 45}deg, ${c.bg} 0%, ${c.bg} 55%, ${alpha('#000000', 0.12)} 55%, ${alpha('#000000', 0.12)} 100%)`,
        ];
      default: // cosmic aurora
        return [
          `radial-gradient(circle at ${25 + drift(9, 170, 1)}% ${28 + drift(7, 210, 1)}%, ${alpha(c.primary, 0.75)} 0%, ${alpha(c.primary, 0)} 62%)`,
          `radial-gradient(circle at ${78 + drift(9, 210, 2)}% ${62 + drift(7, 240, 2)}%, ${alpha(c.secondary, 0.42)} 0%, ${alpha(c.secondary, 0)} 52%)`,
          `radial-gradient(circle at ${40 + drift(9, 250, 3)}% ${88 + drift(7, 270, 3)}%, ${alpha(c.primary, 0.55)} 0%, ${alpha(c.primary, 0)} 58%)`,
        ];
    }
  })();
  return <AbsoluteFill style={{ transform: `scale(${zoom})`, background: layers.join(', ') }} />;
};

/** Layer 2. Theme color grade: drifting glow (strength per theme) plus top/bottom darkening for text contrast. */
export const ColorLayer: React.FC<{ seed: number }> = ({ seed }) => {
  const frame = useCurrentFrame();
  const gx = 50 + float(frame, 22, 240, seed * 40);
  const gy = 40 + float(frame, 12, 300, seed * 25);
  const g = STYLE.glow;
  const bright = STYLE.pattern === 'halftone';
  return (
    <AbsoluteFill>
      {g > 0.2 ? <AbsoluteFill style={{ background: `radial-gradient(ellipse 80% 55% at ${gx}% ${gy}%, ${alpha(COLORS.primary, 0.32 * g)} 0%, ${alpha(COLORS.primary, 0)} 70%)`, mixBlendMode: 'screen' }} /> : null}
      {bright ? null : <AbsoluteFill style={{ background: `linear-gradient(180deg, ${alpha(COLORS.bg, 0.65)} 0%, ${alpha(COLORS.bg, 0.05)} 26%, ${alpha(COLORS.bg, 0.1)} 58%, ${alpha(COLORS.bg, 0.86)} 100%)` }} />}
      {STYLE.pattern === 'paper' ? <AbsoluteFill style={{ background: `radial-gradient(ellipse 75% 65% at 50% 45%, transparent 55%, ${alpha('#000000', 0.7)} 100%)` }} /> : null}
    </AbsoluteFill>
  );
};

type PatternProps = { seed: number; density?: number; offset?: { x: number; y: number } };

/** Layer 3. The theme's moving texture. */
export const PatternLayer: React.FC<PatternProps> = (props) => {
  const offset = props.offset ?? { x: 0, y: 0 };
  const Pattern = PATTERNS[STYLE.pattern] ?? Stars;
  return (
    <AbsoluteFill style={{ overflow: 'hidden', transform: `translate(${offset.x}px, ${offset.y}px)` }}>
      <Pattern seed={props.seed} density={props.density ?? 1} />
    </AbsoluteFill>
  );
};

type P = { seed: number; density: number };

/** cosmic: perspective grid, rising twinkling particles and a periodic light streak. */
const Stars: React.FC<P> = ({ seed, density }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const count = Math.round(28 * density);
  const gridOffset = (((frame * 0.9 + float(frame, 26, 150)) % 90) + 90) % 90;
  const cycle = Math.round(fps * 3.3);
  const local = (frame + Math.round(random(seed) * cycle)) % cycle;
  const sweep = interpolate(local, [0, cycle * 0.45], [-0.6, 1.6], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeInOut });
  return (
    <>
      <AbsoluteFill style={{
        backgroundImage: `linear-gradient(${alpha(COLORS.text, 0.07)} 2px, transparent 2px), linear-gradient(90deg, ${alpha(COLORS.text, 0.07)} 2px, transparent 2px)`,
        backgroundSize: '90px 90px', backgroundPosition: `0px ${gridOffset}px`,
        maskImage: 'linear-gradient(180deg, transparent 0%, black 55%, black 80%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, black 55%, black 80%, transparent 100%)',
        transform: 'perspective(900px) rotateX(38deg) scale(1.6)', transformOrigin: '50% 100%', opacity: 0.9,
      }} />
      {Array.from({ length: count }, (_, i) => {
        const r = (k: number) => random(seed * 97 + i * 13 + k);
        const size = 3 + r(1) * 7;
        const speed = 0.6 + r(2) * 1.6;
        const travel = frame * speed + float(frame, 30 * speed, 100 + r(10) * 80, r(11) * 100);
        const y = (((r(3) * height - travel) % (height + 40)) + height + 40) % (height + 40) - 20;
        const x = r(4) * width + float(frame, 14, 120 + r(5) * 120, r(6) * 200);
        const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin((frame + r(7) * 100) / (10 + r(8) * 14)));
        const color = r(9) > 0.82 ? COLORS.accent : r(9) > 0.45 ? COLORS.secondary : COLORS.text;
        return <div key={i} style={{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: 99, background: color, opacity: twinkle * 0.75, boxShadow: `0 0 ${size * 3}px ${color}` }} />;
      })}
      <AbsoluteFill style={{
        background: `linear-gradient(105deg, transparent 0%, transparent 42%, ${alpha(COLORS.text, 0.1)} 48%, ${alpha(COLORS.secondary, 0.16)} 50%, ${alpha(COLORS.text, 0.1)} 52%, transparent 58%, transparent 100%)`,
        transform: `translateX(${sweep * 100}%)`, mixBlendMode: 'screen',
      }} />
    </>
  );
};

/** documentary: paper grain, ruled lines, drifting dust and flickering film scratches. */
const Paper: React.FC<P> = ({ seed, density }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const flicker = 0.9 + 0.1 * random(frame * 3 + seed);
  return (
    <>
      {/* Grain: two offset dot screens read as paper fibre at video size. */}
      <AbsoluteFill style={{
        backgroundImage: `radial-gradient(${alpha('#F5E6C8', 0.07)} 1px, transparent 1.5px), radial-gradient(${alpha('#000000', 0.18)} 1px, transparent 1.5px)`,
        backgroundSize: '7px 7px, 11px 11px', backgroundPosition: `${frame % 7}px 0, 3px ${frame % 11}px`, opacity: flicker,
      }} />
      {/* Faint ruled lines like an old ledger or manuscript. */}
      <AbsoluteFill style={{ backgroundImage: `repeating-linear-gradient(180deg, transparent 0 62px, ${alpha(COLORS.primary, 0.08)} 62px 64px)`, opacity: 0.8 }} />
      {/* Film scratches: a few thin vertical lines that jump every few frames. */}
      {Array.from({ length: 3 }, (_, i) => {
        const hop = Math.floor(frame / 4);
        const x = random(hop * 13 + i * 7 + seed) * width;
        const visible = random(hop * 5 + i) > 0.45;
        return visible ? <div key={i} style={{ position: 'absolute', left: x, top: 0, width: 2, height, background: alpha('#F5E6C8', 0.12) }} /> : null;
      })}
      {/* Dust specks drifting down slowly. */}
      {Array.from({ length: Math.round(18 * density) }, (_, i) => {
        const r = (k: number) => random(seed * 53 + i * 17 + k);
        const y = ((r(1) * height + frame * (0.3 + r(2) * 0.6)) % height);
        const x = r(3) * width + float(frame, 10, 160 + r(4) * 100, r(5) * 100);
        const s = 2 + r(6) * 4;
        return <div key={`d${i}`} style={{ position: 'absolute', left: x, top: y, width: s, height: s, borderRadius: 99, background: alpha('#F5E6C8', 0.25 + r(7) * 0.3) }} />;
      })}
    </>
  );
};

/** finance: price grid, a line chart drawing itself, faint candles and a ticker tape. */
const Chart: React.FC<P> = ({ seed }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const points = 24;
  const series = Array.from({ length: points }, (_, i) => {
    const trend = i / (points - 1);
    return 0.78 - trend * 0.38 + (random(seed * 11 + i) - 0.5) * 0.16;
  });
  const reveal = interpolate(frame, [0, fps * 2.2], [0, 1], { extrapolateRight: 'clamp', easing: easeInOut });
  const path = series.map((v, i) => `${i ? 'L' : 'M'}${(i / (points - 1)) * width},${v * height}`).join(' ');
  const len = width * 1.6;
  const tape = 'VNINDEX +1,24%  •  USD/VND 25.410  •  BTC +3,8%  •  VÀNG 8,9 TR  •  S&P 500 +0,6%  •  LÃI SUẤT 4,5%  •  ';
  return (
    <>
      <AbsoluteFill style={{
        backgroundImage: `linear-gradient(${alpha('#FFFFFF', 0.06)} 1px, transparent 1px), linear-gradient(90deg, ${alpha('#FFFFFF', 0.04)} 1px, transparent 1px)`,
        backgroundSize: `${width / 6}px ${height / 12}px`,
      }} />
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
        {series.map((v, i) => {
          const x = (i / (points - 1)) * width, up = i === 0 || v < series[i - 1];
          const h = 40 + random(seed + i * 3) * 90;
          return <rect key={i} x={x - 9} y={v * height - h / 2 + 60} width={18} height={h} fill={alpha(up ? COLORS.accent : '#F43F5E', 0.13)} />;
        })}
        <path d={`${path} L${width},${height} L0,${height} Z`} fill={alpha(COLORS.primary, 0.08 * reveal)} />
        <path d={path} fill="none" stroke={COLORS.primary} strokeWidth={6} strokeOpacity={0.55} strokeDasharray={len} strokeDashoffset={len * (1 - reveal)} strokeLinejoin="round" />
      </svg>
      <div style={{
        position: 'absolute', left: 0, top: height * 0.075, whiteSpace: 'nowrap', fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 30,
        color: alpha(COLORS.primary, 0.55), letterSpacing: '0.04em', transform: `translateX(${-((frame * 3) % 1600)}px)`,
      }}>{tape.repeat(4)}</div>
    </>
  );
};

/** tech: flat neon grid, traces with running pulses, code rain columns and scanlines. */
const Circuit: React.FC<P> = ({ seed, density }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const cols = Math.round(7 * density);
  const glyphs = '01{}<>/=;:[]#$*+ABCDEF0123456789';
  return (
    <>
      <AbsoluteFill style={{
        backgroundImage: `linear-gradient(${alpha(COLORS.primary, 0.1)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(COLORS.primary, 0.1)} 1px, transparent 1px)`,
        backgroundSize: '60px 60px', backgroundPosition: `0 ${(frame * 0.5) % 60}px`,
      }} />
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
        {Array.from({ length: 6 }, (_, i) => {
          const r = (k: number) => random(seed * 41 + i * 19 + k);
          const x0 = Math.round(r(1) * 16) * 60, y0 = Math.round(r(2) * 30) * 60, x1 = x0 + (r(3) > 0.5 ? 1 : -1) * Math.round(2 + r(4) * 5) * 60, y1 = y0 + Math.round(2 + r(5) * 6) * 60;
          const d = `M${x0},${y0} L${x0},${(y0 + y1) / 2} L${x1},${(y0 + y1) / 2} L${x1},${y1}`;
          const total = Math.abs(y1 - y0) + Math.abs(x1 - x0);
          const run = ((frame * 9 + r(6) * total) % (total + 200)) - 100;
          return (
            <g key={i}>
              <path d={d} fill="none" stroke={alpha(COLORS.primary, 0.28)} strokeWidth={3} />
              <circle cx={x0} cy={y0} r={7} fill={alpha(COLORS.primary, 0.6)} />
              <circle cx={x1} cy={y1} r={7} fill={alpha(COLORS.secondary, 0.6)} />
              <path d={d} fill="none" stroke={COLORS.primary} strokeWidth={4} strokeDasharray={`60 ${total + 400}`} strokeDashoffset={-run} />
            </g>
          );
        })}
      </svg>
      {Array.from({ length: cols }, (_, i) => {
        const r = (k: number) => random(seed * 29 + i * 23 + k);
        const x = (i + 0.5) * (width / cols) + (r(1) - 0.5) * 60;
        const speed = 4 + r(2) * 6;
        const y = ((frame * speed + r(3) * height) % (height + 600)) - 600;
        const text = Array.from({ length: 14 }, (_, k) => glyphs[Math.floor(random(i * 101 + k + Math.floor(frame / 3)) * glyphs.length)]).join('\n');
        return <div key={i} style={{ position: 'absolute', left: x, top: y, whiteSpace: 'pre', fontFamily: "'JetBrains Mono', monospace", fontSize: 30, lineHeight: '40px', color: alpha(COLORS.accent, 0.22 + r(4) * 0.15) }}>{text}</div>;
      })}
      <AbsoluteFill style={{ backgroundImage: `repeating-linear-gradient(180deg, ${alpha('#000000', 0.22)} 0 2px, transparent 2px 5px)` }} />
    </>
  );
};

/** nature: large soft bokeh discs drifting up and a few falling leaves. */
const Bokeh: React.FC<P> = ({ seed, density }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  return (
    <>
      {Array.from({ length: Math.round(11 * density) }, (_, i) => {
        const r = (k: number) => random(seed * 61 + i * 7 + k);
        const size = 90 + r(1) * 260;
        const y = height - (((frame * (0.25 + r(2) * 0.5)) + r(3) * height) % (height + size)) ;
        const x = r(4) * width + float(frame, 30, 220 + r(5) * 160, r(6) * 200) - size / 2;
        const color = r(7) > 0.6 ? COLORS.accent : r(7) > 0.25 ? COLORS.secondary : COLORS.primary;
        return <div key={i} style={{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: '50%', background: `radial-gradient(circle, ${alpha(color, 0.28)} 0%, ${alpha(color, 0.12)} 55%, ${alpha(color, 0)} 70%)` }} />;
      })}
      {Array.from({ length: 5 }, (_, i) => {
        const r = (k: number) => random(seed * 71 + i * 11 + k);
        const y = ((frame * (1 + r(1) * 1.2) + r(2) * height) % (height + 100)) - 100;
        const x = r(3) * width + float(frame, 60, 140 + r(4) * 80, r(5) * 100);
        const rot = frame * (1 + r(6) * 2) + r(7) * 360;
        return <div key={`l${i}`} style={{ position: 'absolute', left: x, top: y, width: 34, height: 18, borderRadius: '0 100% 0 100%', background: alpha(COLORS.primary, 0.55), transform: `rotate(${rot}deg)` }} />;
      })}
    </>
  );
};

/** pop: halftone dots, bold stripes and spinning confetti shapes. */
const Halftone: React.FC<P> = ({ seed, density }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const shapes = ['circle', 'tri', 'squiggle', 'plus'] as const;
  return (
    <>
      <AbsoluteFill style={{
        backgroundImage: `radial-gradient(${alpha('#000000', 0.16)} 22%, transparent 24%)`, backgroundSize: '34px 34px',
        backgroundPosition: `${(frame * 0.6) % 34}px ${(frame * 0.6) % 34}px`,
        maskImage: `linear-gradient(${VARIANT.flip ? 200 : 160}deg, black 0%, transparent 55%)`, WebkitMaskImage: `linear-gradient(${VARIANT.flip ? 200 : 160}deg, black 0%, transparent 55%)`,
      }} />
      <AbsoluteFill style={{ background: `repeating-linear-gradient(${VARIANT.flip ? -45 : 45}deg, transparent 0 80px, ${alpha('#FFFFFF', 0.07)} 80px 110px)` }} />
      {Array.from({ length: Math.round(12 * density) }, (_, i) => {
        const r = (k: number) => random(seed * 83 + i * 5 + k);
        const kind = shapes[Math.floor(r(1) * shapes.length)];
        const x = r(2) * width, y = r(3) * height + float(frame, 24, 90 + r(4) * 60, r(5) * 100);
        const rot = frame * (2 + r(6) * 3) * (r(7) > 0.5 ? 1 : -1);
        const color = r(8) > 0.5 ? COLORS.primary : r(8) > 0.2 ? COLORS.secondary : '#FFFFFF';
        const s = 40 + r(9) * 40;
        const base: React.CSSProperties = { position: 'absolute', left: x, top: y, transform: `rotate(${rot}deg)`, filter: 'drop-shadow(4px 4px 0 rgba(0,0,0,0.85))' };
        if (kind === 'circle') return <div key={i} style={{ ...base, width: s * 0.7, height: s * 0.7, borderRadius: '50%', border: `8px solid ${color}` }} />;
        if (kind === 'tri') return <div key={i} style={{ ...base, width: 0, height: 0, borderLeft: `${s / 2}px solid transparent`, borderRight: `${s / 2}px solid transparent`, borderBottom: `${s * 0.85}px solid ${color}` }} />;
        if (kind === 'plus') return <div key={i} style={{ ...base, width: s, height: s, background: `linear-gradient(${color}, ${color}) center/30% 100% no-repeat, linear-gradient(${color}, ${color}) center/100% 30% no-repeat` }} />;
        return <svg key={i} width={s * 1.6} height={s} style={base}><path d={`M4,${s / 2} q${s * 0.2},-${s * 0.4} ${s * 0.4},0 t${s * 0.4},0 t${s * 0.4},0`} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" /></svg>;
      })}
    </>
  );
};

const PATTERNS: Record<string, React.FC<P>> = { stars: Stars, paper: Paper, chart: Chart, circuit: Circuit, bokeh: Bokeh, halftone: Halftone };
