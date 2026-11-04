// Design system. Six themes, each a full visual language (palette, fonts, card kind, background
// pattern, caption style, transition rhythm), not just a recolor. One theme per video, picked by the
// backend from the topic (or by the user), and a per-video seed picks a variant inside the theme.
//
// The values below are live ES-module bindings: `applyTheme()` runs at the top of the composition,
// before any scene renders, so every module reads the current theme. A render only ever shows one
// video, so this is deterministic across Remotion's parallel tabs.
import type React from 'react';
import { THEME_IDS, type ThemeId } from './schema';

export { THEME_IDS, type ThemeId };

export type CardKind = 'glass' | 'paper' | 'ledger' | 'neon' | 'soft' | 'sticker';
export type PatternKind = 'stars' | 'paper' | 'chart' | 'circuit' | 'bokeh' | 'halftone';
export type CaptionKind = 'pill' | 'underline' | 'bracket' | 'ledger' | 'soft' | 'sticker';
export type IconShape = 'circle' | 'seal' | 'square' | 'hex' | 'leaf' | 'sticker';
export type TransitionKind = 'slide' | 'zoom' | 'wipe' | 'blur' | 'fade' | 'push' | 'glitch' | 'iris' | 'spin';

type Palette = { bg: string; primary: string; accent: string; secondary: string; text: string };

interface ThemeSpec {
  label: string;
  palettes: [Palette, Palette];
  fonts: { display: string; body: string; caption: string };
  weight: { heavy: number; bold: number; medium: number };
  titleCase: 'none' | 'upper';
  letterSpacing: string;
  card: CardKind;
  pattern: PatternKind;
  caption: CaptionKind;
  icon: IconShape;
  transitions: TransitionKind[];
  /** Overlap between scenes. Slow themes dissolve, fast themes cut. */
  transitionFrames: number;
  /** How much the brand glow tints the frame (0..1). */
  glow: number;
  /** Darkening over photo/video backgrounds. */
  scrim: number;
  /** Text outline color (dark themes use the background; bright pop uses black). */
  outline: string;
}

export const THEMES: Record<ThemeId, ThemeSpec> = {
  // Space, physics, sci-fi: deep navy, violet glow, glass cards, starfield.
  cosmic: {
    label: 'Vũ trụ',
    palettes: [
      { bg: '#0B0B1A', primary: '#7C5CFF', accent: '#FFD23F', secondary: '#3DE0FF', text: '#FFFFFF' },
      { bg: '#070B1F', primary: '#4C6BFF', accent: '#FF9DE2', secondary: '#7CF5FF', text: '#FFFFFF' },
    ],
    fonts: { display: 'Be Vietnam Pro', body: 'Be Vietnam Pro', caption: 'Be Vietnam Pro' },
    weight: { heavy: 800, bold: 700, medium: 500 }, titleCase: 'none', letterSpacing: '-0.01em',
    card: 'glass', pattern: 'stars', caption: 'pill', icon: 'circle',
    transitions: ['slide', 'zoom', 'wipe', 'blur'], transitionFrames: 10, glow: 1, scrim: 0.55, outline: '#0B0B1A',
  },
  // History, philosophy, politics, biographies: sepia paper, serif type, slow dissolves.
  documentary: {
    label: 'Tư liệu',
    palettes: [
      { bg: '#1A120B', primary: '#B07A3B', accent: '#E9C46A', secondary: '#C8553D', text: '#F5EBDC' },
      { bg: '#141210', primary: '#9C8462', accent: '#D9A35F', secondary: '#7D2E22', text: '#F1E7D6' },
    ],
    fonts: { display: 'Playfair Display', body: 'Lora', caption: 'Lora' },
    weight: { heavy: 800, bold: 700, medium: 500 }, titleCase: 'none', letterSpacing: '0em',
    card: 'paper', pattern: 'paper', caption: 'underline', icon: 'seal',
    transitions: ['fade', 'blur', 'iris'], transitionFrames: 18, glow: 0.25, scrim: 0.5, outline: '#120C07',
  },
  // Money, economy, investing, business: navy and gold, ledger cards, rising chart, snappy pushes.
  finance: {
    label: 'Tài chính',
    palettes: [
      { bg: '#06142B', primary: '#F2B705', accent: '#22C55E', secondary: '#38BDF8', text: '#FFFFFF' },
      { bg: '#0A1A33', primary: '#E8B04B', accent: '#F43F5E', secondary: '#5EEAD4', text: '#FFFFFF' },
    ],
    fonts: { display: 'Montserrat', body: 'Montserrat', caption: 'Montserrat' },
    weight: { heavy: 800, bold: 700, medium: 500 }, titleCase: 'none', letterSpacing: '-0.02em',
    card: 'ledger', pattern: 'chart', caption: 'ledger', icon: 'square',
    transitions: ['push', 'slide', 'wipe'], transitionFrames: 8, glow: 0.35, scrim: 0.62, outline: '#04101F',
  },
  // AI, software, internet, robots: black, neon cyan, outlined clipped cards, circuit grid, glitch cuts.
  tech: {
    label: 'Công nghệ',
    palettes: [
      { bg: '#030507', primary: '#00E5FF', accent: '#B6FF00', secondary: '#FF2E88', text: '#EFFFFF' },
      // Second palette is magenta, not blue: blue would collide with finance's navy.
      { bg: '#050307', primary: '#FF2E88', accent: '#00E5FF', secondary: '#B6FF00', text: '#FFF0F7' },
    ],
    fonts: { display: 'Space Grotesk', body: 'JetBrains Mono', caption: 'Space Grotesk' },
    weight: { heavy: 700, bold: 700, medium: 500 }, titleCase: 'upper', letterSpacing: '0.01em',
    card: 'neon', pattern: 'circuit', caption: 'bracket', icon: 'hex',
    transitions: ['glitch', 'wipe', 'push'], transitionFrames: 6, glow: 0.45, scrim: 0.7, outline: '#000000',
  },
  // Nature, animals, environment, biology, health: forest greens, soft rounded cards, drifting bokeh.
  nature: {
    label: 'Thiên nhiên',
    palettes: [
      { bg: '#0B2016', primary: '#5FD38D', accent: '#FFB347', secondary: '#B8F2C9', text: '#FFFFFF' },
      { bg: '#0B1F1E', primary: '#7BC96F', accent: '#F6D365', secondary: '#4FD1C5', text: '#FFFFFF' },
    ],
    fonts: { display: 'Nunito', body: 'Nunito', caption: 'Nunito' },
    weight: { heavy: 900, bold: 800, medium: 600 }, titleCase: 'none', letterSpacing: '-0.005em',
    card: 'soft', pattern: 'bokeh', caption: 'soft', icon: 'leaf',
    transitions: ['iris', 'fade', 'zoom'], transitionFrames: 16, glow: 0.4, scrim: 0.45, outline: '#08170F',
  },
  // Lifestyle, psychology, tips, entertainment, food: bright coral, chunky type, sticker cards, bouncy pops.
  pop: {
    label: 'Đời sống',
    palettes: [
      { bg: '#F2545B', primary: '#FFE14D', accent: '#FFE14D', secondary: '#3DDCF7', text: '#FFFFFF' },
      { bg: '#FF6B35', primary: '#FFF275', accent: '#FFF275', secondary: '#2EC4B6', text: '#FFFFFF' },
    ],
    fonts: { display: 'Baloo 2', body: 'Baloo 2', caption: 'Baloo 2' },
    weight: { heavy: 800, bold: 700, medium: 600 }, titleCase: 'none', letterSpacing: '0em',
    card: 'sticker', pattern: 'halftone', caption: 'sticker', icon: 'sticker',
    transitions: ['spin', 'zoom', 'slide'], transitionFrames: 9, glow: 0.15, scrim: 0.4, outline: '#111111',
  },
};

/** Layout variant inside a theme, from the video's seed, so two videos of one theme still differ. */
export type Variant = { palette: 0 | 1; align: 'center' | 'left'; justify: 'center' | 'upper'; tilt: number; patternPhase: number; flip: boolean; hook: 'stack' | 'side' | 'watermark' };

export function variantFor(seed: number): Variant {
  const r = (k: number) => { const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  return {
    palette: r(1) < 0.5 ? 0 : 1,
    align: r(2) < 0.35 ? 'left' : 'center',
    justify: r(3) < 0.4 ? 'upper' : 'center',
    tilt: (r(4) - 0.5) * 4,
    patternPhase: Math.floor(r(5) * 1000),
    flip: r(6) < 0.5,
    hook: r(7) < 0.34 ? 'stack' : r(7) < 0.67 ? 'side' : 'watermark',
  };
}

// ---- Live values (updated by applyTheme) ----
export const COLORS: Palette = { ...THEMES.cosmic.palettes[0] };
export const WEIGHT = { ...THEMES.cosmic.weight };
export let THEME_ID: ThemeId = 'cosmic';
export let STYLE: ThemeSpec = THEMES.cosmic;
export let VARIANT: Variant = variantFor(1);
/** Display face: titles, numbers, buttons. */
export let FONT_FAMILY = "'Be Vietnam Pro', sans-serif";
export let BODY_FONT = "'Be Vietnam Pro', sans-serif";
export let CAPTION_FONT = "'Be Vietnam Pro', sans-serif";
export let GLASS: React.CSSProperties = {};
export let TEXT_SHADOW = '';

const stack = (family: string, fallback: string) => `'${family}', ${fallback}`;

/** Hex (#RRGGBB) to rgba() with alpha. */
export const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** Readable ink on a solid color: near-black on light colors (gold, yellow), white on dark ones. */
export const onColor = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.35 ? '#111111' : '#FFFFFF';
};

/** Button / tag shape for the theme. */
export const buttonRadius = () => ({ glass: 999, paper: 4, ledger: 10, neon: 0, soft: 999, sticker: 24 } as const)[STYLE.card];

export function applyTheme(id: ThemeId | undefined, seed = 1) {
  const theme = THEMES[id && id in THEMES ? id : 'cosmic'];
  THEME_ID = (id && id in THEMES ? id : 'cosmic') as ThemeId;
  STYLE = theme;
  VARIANT = variantFor(seed);
  Object.assign(COLORS, theme.palettes[VARIANT.palette]);
  Object.assign(WEIGHT, theme.weight);
  const serif = theme.fonts.display === 'Playfair Display' ? 'serif' : 'sans-serif';
  FONT_FAMILY = stack(theme.fonts.display, serif);
  BODY_FONT = stack(theme.fonts.body, theme.fonts.body === 'Lora' ? 'serif' : theme.fonts.body === 'JetBrains Mono' ? 'monospace' : 'sans-serif');
  CAPTION_FONT = stack(theme.fonts.caption, 'sans-serif');
  GLASS = cardBase(theme.card);
  const o = theme.outline;
  TEXT_SHADOW = theme.card === 'sticker'
    // Pop: hard black outline plus an offset drop, like a sticker.
    ? [`4px 4px 0 ${o}`, `-3px 3px 0 ${o}`, `3px -3px 0 ${o}`, `-3px -3px 0 ${o}`, `0 6px 0 ${o}`].join(', ')
    : [
      `0 6px 24px ${alpha('#000000', 0.55)}`, `0 2px 0 ${alpha('#000000', 0.35)}`,
      `2px 2px 0 ${alpha(o, 0.6)}`, `-2px 2px 0 ${alpha(o, 0.6)}`, `2px -2px 0 ${alpha(o, 0.6)}`, `-2px -2px 0 ${alpha(o, 0.6)}`,
    ].join(', ');
}

/** Base surface of a card for each kind. Templates spread this and add their own layout. */
function cardBase(kind: CardKind): React.CSSProperties {
  const c = COLORS;
  switch (kind) {
    case 'paper':
      return {
        background: `linear-gradient(180deg, ${alpha('#2A1E12', 0.88)}, ${alpha('#1C140C', 0.9)})`,
        border: `2px solid ${alpha(c.primary, 0.85)}`, outline: `1px solid ${alpha(c.primary, 0.45)}`, outlineOffset: -12,
        borderRadius: 6, boxShadow: `0 18px 40px ${alpha('#000000', 0.55)}`,
      };
    case 'ledger':
      return {
        background: `linear-gradient(180deg, ${alpha('#0E2244', 0.94)}, ${alpha(c.bg, 0.96)})`,
        borderLeft: `12px solid ${c.primary}`, borderTop: `1px solid ${alpha('#FFFFFF', 0.12)}`,
        borderRadius: 14, boxShadow: `0 20px 44px ${alpha('#000000', 0.5)}`,
      };
    case 'neon':
      return {
        background: alpha('#000000', 0.62), border: `2px solid ${c.primary}`, borderRadius: 0,
        clipPath: 'polygon(28px 0, 100% 0, 100% calc(100% - 28px), calc(100% - 28px) 100%, 0 100%, 0 28px)',
        boxShadow: `0 0 0 1px ${alpha(c.primary, 0.3)}, inset 0 0 40px ${alpha(c.primary, 0.12)}`,
      };
    case 'soft':
      return {
        background: alpha('#FFFFFF', 0.13), backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        border: 'none', borderRadius: 56, boxShadow: `0 30px 60px ${alpha('#000000', 0.25)}`,
      };
    case 'sticker':
      return {
        background: '#141414', border: `6px solid ${c.primary}`, borderRadius: 30,
        boxShadow: `12px 12px 0 ${alpha('#000000', 0.9)}`,
      };
    default:
      return {
        background: 'rgba(255, 255, 255, 0.08)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        border: '2px solid rgba(255, 255, 255, 0.15)', borderRadius: 32, boxShadow: `0 24px 60px ${alpha(c.bg, 0.45)}`,
      };
  }
}

applyTheme('cosmic', 1);

/** Glow around a card. Neon glows hard, paper and sticker cast no colored light. */
export const cardGlow = (tint: string, glow: number) => {
  const k = STYLE.card;
  if (k === 'paper' || k === 'sticker') return '';
  if (k === 'neon') return `0 0 ${18 + glow * 40}px ${alpha(tint, 0.35 + glow * 0.4)}`;
  return `0 0 ${40 + glow * 50}px ${alpha(tint, (0.18 + glow * 0.35) * (k === 'ledger' ? 0.5 : 1))}`;
};

/** Minimum sizes at 1080 px width. Scaled by `unit()` for other widths. */
export const SIZE = { titleMin: 72, title: 96, hero: 132, caption: 60, captionMin: 56, body: 44, small: 36 } as const;

/** Content and captions are laid out on this canvas, then scaled to fit the real frame (any size or 16:9). */
export const DESIGN = { width: 1080, height: 1920 } as const;

/** Safe area: 12% top and 20% bottom stay clear of TikTok/Shorts UI. */
export const SAFE = { top: 0.12, bottom: 0.2, side: 0.074 } as const;

export const titleStyle = (fontSize: number): React.CSSProperties => ({
  fontFamily: FONT_FAMILY, fontWeight: WEIGHT.heavy, fontSize: Math.max(SIZE.titleMin, fontSize), color: COLORS.text,
  lineHeight: STYLE.fonts.display === 'Baloo 2' ? 1.08 : 1.22, letterSpacing: STYLE.letterSpacing, textShadow: TEXT_SHADOW,
  textAlign: VARIANT.align, textTransform: STYLE.titleCase === 'upper' ? 'uppercase' : 'none',
});

export const bodyStyle = (fontSize: number = SIZE.body): React.CSSProperties => ({
  fontFamily: BODY_FONT, fontWeight: WEIGHT.medium, fontSize: STYLE.fonts.body === 'JetBrains Mono' ? Math.round(fontSize * 0.86) : fontSize,
  color: alpha(COLORS.text, 0.92), lineHeight: 1.4,
  textShadow: STYLE.card === 'sticker' ? `3px 3px 0 ${STYLE.outline}` : `0 3px 14px ${alpha('#000000', 0.6)}`, textAlign: VARIANT.align,
});

/**
 * Picks a title size that keeps long Vietnamese titles within ~3 lines,
 * never below the 72 px minimum. Wide faces (Montserrat, uppercase tech) get a little less.
 */
export const fitTitle = (value: string, max: number = SIZE.title) => {
  const wide = STYLE.titleCase === 'upper' || STYLE.fonts.display === 'Montserrat' ? 0.9 : 1;
  const length = [...value].length;
  const size = length <= 14 ? max + 24 : length <= 24 ? max : length <= 36 ? Math.max(SIZE.titleMin, max - 12) : SIZE.titleMin;
  return Math.max(SIZE.titleMin, Math.round(size * wide));
};
