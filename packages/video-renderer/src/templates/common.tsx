// Shared pieces for scene templates: content area inside the safe zone, glass card, icon badge, SFX.
import React, { createContext, useContext } from 'react';
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useVideoConfig } from 'remotion';
import { DESIGN } from '../theme';
import { Icon } from '../icons';
import { easeOut, pulse } from '../motion';
import type { StoryboardScene, WordTiming } from '../schema';
import { alpha, cardGlow, COLORS, GLASS, SAFE, STYLE, VARIANT } from '../theme';

export type TemplateProps = {
  scene: StoryboardScene;
  frame: number;
  /** Frames this scene is on screen before its exit (audio + padding). */
  length: number;
  words: WordTiming[];
};

/** Height reserved above the bottom safe area for captions. */
export const CAPTION_BAND = 250;

/** The region templates lay out in: below the top 12%, above captions and the bottom 20%. */
export const ContentArea: React.FC<{ children: React.ReactNode; justify?: React.CSSProperties['justifyContent']; gap?: number }> = ({ children, justify = 'center', gap = 36 }) => {
  const { width, height } = DESIGN;
  // Seeded variant: some videos sit content higher, some align it left.
  const j = justify === 'center' && VARIANT.justify === 'upper' ? 'flex-start' : justify;
  return (
    <AbsoluteFill style={{
      paddingTop: Math.round(height * SAFE.top) + 24 + (j === 'flex-start' && justify === 'center' ? 120 : 0), paddingBottom: Math.round(height * SAFE.bottom) + CAPTION_BAND,
      paddingLeft: Math.round(width * SAFE.side), paddingRight: Math.round(width * SAFE.side),
      display: 'flex', flexDirection: 'column', alignItems: VARIANT.align === 'left' ? 'flex-start' : 'center', justifyContent: j, gap,
    }}>
      {children}
    </AbsoluteFill>
  );
};

/** The theme's card (glass, paper, ledger, neon, soft or sticker). */
export const Glass: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; glow?: number; tint?: string }> = ({ children, style, glow = 0, tint = COLORS.primary }) => {
  const extra = cardGlow(tint, glow);
  const tilt = STYLE.card === 'sticker' ? { transform: `rotate(${VARIANT.tilt}deg)` } : {};
  // Neon cards are clipped, so a box-shadow glow would be cut off: glow with a drop-shadow on a wrapper instead.
  if (STYLE.card === 'neon') {
    return (
      <div style={{ filter: `drop-shadow(0 0 ${8 + glow * 18}px ${alpha(tint, 0.45 + glow * 0.4)})`, ...(style?.width ? { width: style.width } : {}), ...(style?.flex ? { flex: style.flex } : {}) }}>
        <div style={{ ...GLASS, ...style, borderColor: tint }}>{children}</div>
      </div>
    );
  }
  return <div style={{ ...GLASS, boxShadow: [GLASS.boxShadow, extra].filter(Boolean).join(', '), ...tilt, ...style }}>{children}</div>;
};

const SHAPES: Record<string, { radius: string; clip?: string }> = {
  circle: { radius: '50%' },
  seal: { radius: '50%' },
  square: { radius: '22%' },
  hex: { radius: '0', clip: 'polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)' },
  leaf: { radius: '50% 6% 50% 6%' },
  sticker: { radius: '50%' },
};

/** Icon in the theme's badge shape. The ring pulses outward continuously. */
export const IconBadge: React.FC<{ name: string; size: number; frame: number; color?: string; ring?: boolean }> = ({ name, size, frame, color = COLORS.secondary, ring = true }) => {
  const p = pulse(frame, 40);
  const wave = easeOut((frame % 40) / 40);
  const shape = SHAPES[STYLE.icon] ?? SHAPES.circle;
  const face: React.CSSProperties = (() => {
    switch (STYLE.icon) {
      case 'seal': // engraved medallion: bronze rim, dark center, double ring
        return { background: `radial-gradient(circle at 40% 35%, ${alpha('#3A2816', 1)}, ${alpha('#140D07', 1)} 75%)`, border: `6px double ${COLORS.primary}`, boxShadow: `0 10px 30px ${alpha('#000000', 0.6)}` };
      case 'square': // gold coin tile
        return { background: `linear-gradient(145deg, ${COLORS.primary}, ${alpha(COLORS.primary, 0.7)})`, boxShadow: `0 14px 36px ${alpha('#000000', 0.5)}, inset 0 2px 0 ${alpha('#FFFFFF', 0.4)}` };
      case 'hex':
        return { background: alpha('#000000', 0.7), boxShadow: `inset 0 0 0 4px ${color}, inset 0 0 40px ${alpha(color, 0.35)}` };
      case 'leaf':
        return { background: `linear-gradient(160deg, ${alpha(COLORS.primary, 0.95)}, ${alpha(COLORS.secondary, 0.6)})`, boxShadow: `0 20px 44px ${alpha('#000000', 0.3)}` };
      case 'sticker':
        return { background: COLORS.primary, border: '7px solid #111111', boxShadow: '10px 10px 0 #111111' };
      default:
        return {
          background: `radial-gradient(circle at 35% 30%, ${alpha(COLORS.primary, 0.95)}, ${alpha(COLORS.bg, 0.9)} 78%)`,
          border: `3px solid ${alpha(color, 0.55)}`, boxShadow: `0 0 ${30 + p * 40}px ${alpha(color, 0.35 + p * 0.3)}, inset 0 0 30px ${alpha(COLORS.secondary, 0.25)}`,
        };
    }
  })();
  const ink = STYLE.icon === 'square' || STYLE.icon === 'sticker' ? '#111111' : STYLE.icon === 'seal' ? COLORS.accent : STYLE.icon === 'hex' ? color : COLORS.text;
  const glowIcon = STYLE.icon === 'circle' || STYLE.icon === 'hex';
  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', filter: shape.clip ? `drop-shadow(0 0 ${14 + p * 16}px ${alpha(color, 0.5)})` : undefined }}>
      {ring && !shape.clip ? <div style={{ position: 'absolute', inset: 0, borderRadius: shape.radius, border: `4px solid ${alpha(STYLE.icon === 'sticker' ? '#111111' : color, 0.6 * (1 - wave))}`, transform: `scale(${1 + wave * 0.55})` }} /> : null}
      <div style={{ position: 'absolute', inset: 0, borderRadius: shape.radius, clipPath: shape.clip, ...face }} />
      <Icon name={name} size={Math.round(size * 0.5)} color={ink} strokeWidth={STYLE.icon === 'sticker' ? 2.8 : 2.2} style={{ position: 'relative', filter: glowIcon ? `drop-shadow(0 0 12px ${alpha(color, 0.8)})` : undefined }} />
    </div>
  );
};

/** Fixed 1080x1920 canvas, scaled and centered in the frame. Backgrounds stay full-bleed outside it. */
export const DesignCanvas: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { width, height } = useVideoConfig();
  const scale = Math.min(width / DESIGN.width, height / DESIGN.height);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: DESIGN.width, height: DESIGN.height, flexShrink: 0, transform: `scale(${scale})` }}>{children}</div>
    </AbsoluteFill>
  );
};

// ---- Sound effects ----
const SfxContext = createContext(true);
export const SfxProvider = SfxContext.Provider;
export type SfxName = 'pop' | 'whoosh' | 'tick';
const VOLUME: Record<SfxName, number> = { pop: 0.2, whoosh: 0.16, tick: 0.07 };

/** Plays a short effect at a frame relative to the enclosing sequence. Volume is kept low by design. */
export const Sfx: React.FC<{ at: number; name: SfxName; volume?: number }> = ({ at, name, volume }) => {
  const enabled = useContext(SfxContext);
  if (!enabled) return null;
  return (
    <Sequence from={Math.max(0, Math.round(at))} durationInFrames={24} layout="none">
      <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume ?? VOLUME[name]} />
    </Sequence>
  );
};

/** Vietnamese number format: 1.234.567 and 3,5. Huge values use words, then powers of ten. */
export function formatViNumber(value: number, decimals = 0): string {
  const fmt = (v: number, d: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(v);
  if (value >= 1e18) return `10${String(Math.round(Math.log10(value))).split('').map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]).join('')}`;
  const units: Array<[number, string]> = [[1e15, 'triệu tỷ'], [1e12, 'nghìn tỷ'], [1e9, 'tỷ'], [1e6, 'triệu']];
  for (const [size, word] of units) if (value >= size) return `${fmt(value / size, value / size < 10 ? 1 : 0)} ${word}`;
  return fmt(value, decimals);
}

export const fadeUp = (s: number, distance = 30): React.CSSProperties => ({ opacity: Math.min(1, s * 1.3), transform: `translateY(${interpolate(s, [0, 1], [distance, 0])}px)` });
