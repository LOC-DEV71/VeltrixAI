// Motion rules: springs or eased curves only (never linear), overshoot on enter, quick exit,
// staggered entrances, and continuous "alive" motion so no frame is static.
import { Easing, interpolate, spring } from 'remotion';
import type { WordTiming } from './schema';

export const STAGGER = 4; // frames between staggered elements (rule: 3-6)
export const ENTER_FRAMES = 12; // rule: enter phase <= 12 frames
/** Overlap between scenes; set per theme by the composition (see theme.ts transitionFrames). */
export let TRANSITION_FRAMES = 10;
export const setTransitionFrames = (frames: number) => { TRANSITION_FRAMES = frames; };

/** Enter with a light overshoot (~8%). Settles in about 12 frames at 30 fps. */
export const enter = (frame: number, fps: number, delay = 0) =>
  spring({ frame: frame - delay, fps, config: { damping: 11, stiffness: 170, mass: 0.55 } });

/** Firmer spring with almost no overshoot, for large surfaces such as cards. */
export const settle = (frame: number, fps: number, delay = 0) =>
  spring({ frame: frame - delay, fps, config: { damping: 16, stiffness: 190, mass: 0.6 } });

/** 0 until `start`, then accelerates out quickly to 1. Used for the exit phase. */
export const exit = (frame: number, start: number, length = 7) =>
  !Number.isFinite(frame) || !Number.isFinite(start) || !Number.isFinite(length) ? 0 : interpolate(frame, [start, start + Math.max(1, length)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.55, 0, 0.9, 0.35) });

export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

/** Smooth progress 0..1 between two frames with an eased curve. */
export const progress = (frame: number, from: number, to: number, easing = easeOut) =>
  !Number.isFinite(frame) || !Number.isFinite(from) || !Number.isFinite(to) ? 0 : interpolate(frame, [from, Math.max(from + 1, to)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing });

/** Continuous sine float, for the "alive" phase. */
export const float = (frame: number, amplitude: number, periodFrames = 90, phase = 0) =>
  Math.sin(((frame + phase) / periodFrames) * Math.PI * 2) * amplitude;

/** 0..1 breathing pulse. */
export const pulse = (frame: number, periodFrames = 45, phase = 0) => 0.5 + 0.5 * Math.sin(((frame + phase) / periodFrames) * Math.PI * 2);

/** Small decaying shake used on emphasis words right after they appear. */
export const shake = (frame: number, start: number, amplitude = 3) => {
  const t = frame - start;
  if (t < 0 || t > 14) return 0;
  return Math.sin(t * 2.4) * amplitude * (1 - t / 14);
};

/** Deterministic pseudo-random in [0, 1) from an integer seed. */
export const random = (seed: number) => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export const normalizeWord = (value: string) => value.normalize('NFC').toLocaleLowerCase('vi').replace(/[^\p{L}\p{N}]+/gu, '');
const plain = (value: string) => normalizeWord(value).normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

// Narration usually says numbers as words ("cấp bảy") while labels use digits ("Cấp 7").
const DIGIT_WORDS: Record<string, string[]> = {
  '0': ['không'], '1': ['một', 'nhất'], '2': ['hai'], '3': ['ba'], '4': ['bốn', 'tư'], '5': ['năm'], '6': ['sáu'],
  '7': ['bảy', 'bẩy'], '8': ['tám'], '9': ['chín'], '10': ['mười'],
};
const same = (spoken: string, token: string) => spoken === token || (DIGIT_WORDS[token]?.includes(spoken) ?? false);

/**
 * Frame at which `phrase` starts being spoken, searching words from `fromWord`.
 * Tries the whole phrase, then its most distinctive token, then a diacritic-free first token.
 * Elements appear 2 frames before their word so they land on it. Falls back to `fallback`.
 */
export function cue(words: WordTiming[], phrase: string, fps: number, fallback: number, fromWord = 0): { frame: number; word: number } {
  const tokens = phrase.split(/\s+/).map(normalizeWord).filter((t) => t.length > 0);
  if (!tokens.length || !words.length) return { frame: fallback, word: fromWord };
  const spoken = words.map((w) => normalizeWord(w.text));
  const at = (i: number, span = 1) => ({ frame: Math.max(0, Math.round(words[i].start * fps) - 2), word: i + span });
  const from = Math.max(0, fromWord);
  for (let i = from; i + tokens.length <= spoken.length; i++) if (tokens.every((t, k) => same(spoken[i + k], t))) return at(i, tokens.length);
  // Distinctive token: a number, else the longest word. The phrase start is estimated from its offset.
  const key = tokens.reduce((best, t, k) => (/\d/.test(t) || (!/\d/.test(tokens[best]) && t.length > tokens[best].length) ? k : best), 0);
  for (let i = from + key; i < spoken.length; i++) if (same(spoken[i], tokens[key])) return at(Math.max(from, i - key), tokens.length - key);
  const first = plain(tokens[0]);
  for (let i = from; i < spoken.length; i++) if (plain(words[i].text) === first) return at(i);
  return { frame: fallback, word: fromWord };
}

/** Cue frames for several phrases in order, spaced evenly when a phrase is not found. */
export function cueSequence(words: WordTiming[], phrases: string[], fps: number, start: number, end: number): number[] {
  const step = phrases.length ? Math.max(STAGGER, (end - start) / (phrases.length + 0.5)) : 0;
  let fromWord = 0;
  let last = start - STAGGER;
  return phrases.map((phrase, i) => {
    const hit = cue(words, phrase, fps, Math.round(start + i * step), fromWord);
    fromWord = hit.word;
    // Never earlier than the previous element plus a stagger, never before the enter phase.
    last = Math.max(hit.frame, last + STAGGER, i === 0 ? start : 0);
    return last;
  });
}
