// Scene transitions. Scenes overlap by the theme's transition length: the incoming scene is drawn on
// top and reveals itself while the outgoing scene runs its exit. Audio never overlaps (it starts on the cut).
// Each theme has its own set and rhythm: documentary dissolves slowly, tech glitch-cuts, pop spins in.
import type React from 'react';
import { interpolate, spring } from 'remotion';
import { easeInOut, progress, random } from './motion';
import type { TransitionKind } from './theme';

export type { TransitionKind };
export const TRANSITION_KINDS: TransitionKind[] = ['slide', 'zoom', 'wipe', 'blur', 'fade', 'push', 'glitch', 'iris', 'spin'];

/**
 * One kind per scene boundary from the theme's set. Walks a seeded rotation so the same kind
 * never repeats back to back when the set has more than one kind.
 */
export function pickTransitions(boundaries: number, seed = 1, kinds: TransitionKind[] = ['slide', 'zoom', 'wipe', 'blur']): TransitionKind[] {
  const order = [...kinds].sort((a, b) => random(seed * 7 + TRANSITION_KINDS.indexOf(a)) - random(seed * 7 + TRANSITION_KINDS.indexOf(b)));
  const out: TransitionKind[] = [];
  for (let i = 0; i < boundaries; i++) {
    let kind = order[i % order.length];
    if (i > 0 && kind === out[i - 1] && order.length > 1) kind = order[(i + 1) % order.length];
    out.push(kind);
  }
  return out;
}

/** Style for the incoming scene during its first `length` frames. */
export function enterStyle(kind: TransitionKind | null, frame: number, fps: number, length: number): React.CSSProperties {
  if (!kind || frame >= length + 2) return {};
  const p = progress(frame, 0, length, easeInOut);
  switch (kind) {
    case 'slide': {
      const s = spring({ frame, fps, config: { damping: 15, stiffness: 160, mass: 0.6 } });
      return { transform: `translateX(${interpolate(s, [0, 1], [100, 0])}%)`, boxShadow: '-40px 0 80px rgba(0,0,0,0.5)' };
    }
    case 'push': {
      // Vertical push, firm and fast (finance).
      const s = spring({ frame, fps, config: { damping: 20, stiffness: 260, mass: 0.6 } });
      return { transform: `translateY(${interpolate(s, [0, 1], [100, 0])}%)`, boxShadow: '0 -30px 60px rgba(0,0,0,0.5)' };
    }
    case 'zoom': {
      const s = spring({ frame, fps, config: { damping: 12, stiffness: 150, mass: 0.6 } });
      return { transform: `scale(${interpolate(s, [0, 1], [0.55, 1])})`, opacity: Math.min(1, p * 1.6) };
    }
    case 'spin': {
      // Bouncy sticker pop (pop): overshoots, small rotation.
      const s = spring({ frame, fps, config: { damping: 9, stiffness: 180, mass: 0.6 } });
      return { transform: `scale(${interpolate(s, [0, 1], [0.3, 1])}) rotate(${interpolate(s, [0, 1], [-14, 0])}deg)`, opacity: Math.min(1, p * 2.5) };
    }
    case 'wipe': {
      const x = interpolate(p, [0, 1], [-25, 125]);
      return { clipPath: `polygon(0% 0%, ${x + 25}% 0%, ${x}% 100%, 0% 100%)` };
    }
    case 'iris': {
      // Circle opening from the center (nature, documentary).
      return { clipPath: `circle(${interpolate(p, [0, 1], [0, 120])}% at 50% 45%)` };
    }
    case 'fade':
      return { opacity: p };
    case 'glitch': {
      // Hard cut with a few frames of sliced, offset, color-split jitter (tech).
      const j = (k: number) => (random(frame * 31 + k) - 0.5) * 2;
      const done = p >= 1;
      if (done) return {};
      const top = Math.round(random(frame * 7) * 70), h = 10 + Math.round(random(frame * 11) * 25);
      return {
        opacity: p < 0.15 ? 0 : 1,
        transform: `translateX(${j(1) * 40 * (1 - p)}px)`,
        clipPath: p < 0.7 ? `polygon(0 0, 100% 0, 100% ${top}%, ${j(2) * 6 + 100}% ${top}%, ${j(2) * 6 + 100}% ${top + h}%, 100% ${top + h}%, 100% 100%, 0 100%)` : undefined,
        filter: `drop-shadow(${8 * (1 - p)}px 0 0 rgba(255,46,136,0.8)) drop-shadow(${-8 * (1 - p)}px 0 0 rgba(0,229,255,0.8))`,
      };
    }
    default:
      return { filter: `blur(${interpolate(p, [0, 1], [36, 0])}px)`, opacity: p, transform: `scale(${interpolate(p, [0, 1], [1.12, 1])})` };
  }
}

/** Style for the outgoing scene while the next one comes in (frames after its own length). */
export function exitStyle(kind: TransitionKind | null, frame: number, start: number, length: number): React.CSSProperties {
  if (!kind || frame < start) return {};
  const p = progress(frame, start, start + length, easeInOut);
  switch (kind) {
    case 'slide': return { transform: `translateX(${-p * 35}%)`, opacity: 1 - p * 0.4 };
    case 'push': return { transform: `translateY(${-p * 30}%)`, opacity: 1 - p * 0.5 };
    case 'zoom': return { transform: `scale(${1 + p * 0.7})`, opacity: 1 - p };
    case 'spin': return { transform: `scale(${1 - p * 0.3}) rotate(${p * 10}deg)`, opacity: 1 - p };
    case 'wipe': return { transform: `scale(${1 + p * 0.06})` };
    case 'iris': return { transform: `scale(${1 + p * 0.04})`, filter: `brightness(${1 - p * 0.4})` };
    case 'fade': return { opacity: 1 - p * 0.6 };
    case 'glitch': return { opacity: 1 - p };
    default: return { filter: `blur(${p * 36}px)`, opacity: 1 - p * 0.7 };
  }
}

/** Position (0..100 %) of the wipe edge, used to draw a glowing seam on top of the wipe. */
export const wipeEdge = (frame: number, length: number) => interpolate(progress(frame, 0, length, easeInOut), [0, 1], [-25, 125]);
