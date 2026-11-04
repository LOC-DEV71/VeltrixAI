// Layer 5: captions of 2-4 words, the word being spoken is highlighted, emphasis words are yellow.
import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { enter } from './motion';
import type { WordTiming } from './schema';
import { emphasisMask } from './text';
import { alpha, CAPTION_FONT, COLORS, DESIGN, SAFE, SIZE, STYLE, TEXT_SHADOW, WEIGHT } from './theme';

export type CaptionGroup = { first: number; last: number; start: number; end: number };

const ENDS_CLAUSE = /[.!?…,;:]["'”’)\]]*$/u;
/** Highlight a little before the word is heard: estimated timings measured ~0.1 s late against Whisper, and a caption that leads reads as in sync. */
export const CAPTION_LEAD = 0.15;
const display = (text: string) => text.replace(/["'“”‘’«»]/g, '');

/**
 * Groups words into chunks of 2-4: split into phrases at punctuation and pauses first, then split each
 * phrase into balanced chunks (9 words -> 3+3+3, never 4+4+1).
 */
export function captionGroups(words: WordTiming[], maxWords = 4): CaptionGroup[] {
  const phrases: Array<[number, number]> = [];
  let first = 0;
  for (let i = 0; i < words.length; i++) {
    const gap = i + 1 < words.length ? words[i + 1].start - words[i].end : Infinity;
    if (i === words.length - 1 || ENDS_CLAUSE.test(words[i].text) || gap > 0.35) { phrases.push([first, i]); first = i + 1; }
  }
  // A one-word phrase joins a neighbour when that keeps the chunk within maxWords.
  for (let p = 0; p < phrases.length; p++) {
    const [a, b] = phrases[p];
    if (a !== b || phrases.length < 2) continue;
    const prev = phrases[p - 1], next = phrases[p + 1];
    if (prev && prev[1] - prev[0] + 2 <= maxWords) { prev[1] = b; phrases.splice(p--, 1); }
    else if (next && next[1] - next[0] + 2 <= maxWords) { next[0] = a; phrases.splice(p--, 1); }
  }
  const groups: CaptionGroup[] = [];
  for (const [a, b] of phrases) {
    const parts = Math.ceil((b - a + 1) / maxWords);
    for (let k = 0, i = a; k < parts; k++) {
      const size = Math.ceil((b + 1 - i) / (parts - k));
      groups.push({ first: i, last: i + size - 1, start: words[i].start, end: words[i + size - 1].end });
      i += size;
    }
  }
  return groups;
}

/** Even word timings when the TTS and the aligner gave none. */
export function fallbackWords(voice: string, seconds: number): WordTiming[] {
  const tokens = voice.split(/\s+/).filter(Boolean);
  const weights = tokens.map((t) => 1 + (ENDS_CLAUSE.test(t) ? 0.6 : 0));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let at = 0;
  return tokens.map((text, i) => {
    const length = (weights[i] / total) * seconds;
    const word = { text: text.slice(0, 40), start: at, end: at + length * 0.85 };
    at += length;
    return word;
  });
}

/** Active-word highlight for the theme: box behind the word and (for solid boxes) the word's ink. */
function captionLook(): { box: React.CSSProperties; ink?: string } {
  const c = COLORS;
  switch (STYLE.caption) {
    case 'underline': // documentary: a gold rule under the word, no box
      return { box: { left: '0.1em', right: '0.1em', bottom: '0.02em', height: '0.12em', borderRadius: 2, background: c.accent } };
    case 'bracket': // tech: outlined neon frame
      return { box: { inset: '0.08em -0.04em 0.04em', border: `4px solid ${c.primary}`, background: alpha(c.primary, 0.12), boxShadow: `0 0 18px ${alpha(c.primary, 0.7)}` }, ink: c.primary };
    case 'ledger': // finance: solid gold tag with dark ink
      return { box: { inset: '0.06em -0.02em 0.02em', borderRadius: 8, background: c.primary }, ink: '#0A1428' };
    case 'soft': // nature: frosted round pill
      return { box: { inset: '0.04em -0.04em 0.02em', borderRadius: 999, background: alpha(c.primary, 0.55) } };
    case 'sticker': // pop: black sticker, yellow ink, slight tilt
      return { box: { inset: '0.02em -0.06em -0.02em', borderRadius: 14, background: '#111111', transform: 'rotate(-3deg)', boxShadow: '5px 5px 0 rgba(0,0,0,0.35)' }, ink: c.primary };
    default:
      return { box: { inset: '0.06em -0.02em 0.02em', borderRadius: 18, background: alpha(c.primary, 0.92), boxShadow: `0 8px 26px ${alpha(c.primary, 0.55)}` } };
  }
}

export const Captions: React.FC<{ words: WordTiming[]; emphasis: string[]; sceneFrames: number }> = ({ words, emphasis, sceneFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { height, width } = DESIGN;
  if (frame >= sceneFrames) return null; // hidden during the outgoing transition
  const groups = captionGroups(words);
  const mask = emphasisMask(words.map((w) => w.text), emphasis);
  const t = frame / fps;
  const index = groups.findIndex((g, i) => t >= g.start - CAPTION_LEAD - 0.03 && t < (groups[i + 1]?.start ?? g.end + 0.6) - CAPTION_LEAD - 0.03);
  if (index < 0) return null;
  const group = groups[index];
  const appear = Math.round((group.start - CAPTION_LEAD - 0.03) * fps);
  const s = enter(frame, fps, appear);
  const bottom = Math.round(height * SAFE.bottom) + 36;
  const fontSize = Math.round((SIZE.caption * width) / 1080);
  const look = captionLook();
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: bottom, paddingLeft: width * SAFE.side, paddingRight: width * SAFE.side }}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '0.06em', rowGap: '0.12em', maxWidth: '100%',
        fontFamily: CAPTION_FONT, fontWeight: WEIGHT.heavy, fontSize, lineHeight: STYLE.fonts.caption === 'Baloo 2' ? 1.15 : 1.3, color: COLORS.text, textShadow: TEXT_SHADOW,
        textTransform: STYLE.titleCase === 'upper' ? 'uppercase' : 'none',
        transform: `translateY(${interpolate(s, [0, 1], [26, 0])}px) scale(${interpolate(s, [0, 1], [0.86, 1])})`, opacity: Math.min(1, s * 1.5),
      }}>
        {words.slice(group.first, group.last + 1).map((word, k) => {
          const i = group.first + k;
          // Exactly one active word: from slightly before its start until the next word takes over.
          const active = t >= word.start - CAPTION_LEAD && t < (words[i + 1] ? words[i + 1].start - CAPTION_LEAD : word.end + 0.4);
          const lit = spring({ frame: frame - Math.round((word.start - CAPTION_LEAD) * fps), fps, config: { damping: 14, stiffness: 320, mass: 0.4 } });
          return (
            <span key={i} style={{
              position: 'relative', display: 'inline-block', padding: '0 0.14em',
              color: active && look.ink ? look.ink : mask[i] ? COLORS.accent : COLORS.text,
              ...(active && look.ink ? { textShadow: 'none' } : {}),
              transform: `scale(${active ? interpolate(lit, [0, 1], [1, 1.08]) : 1})`,
            }}>
              {active ? <span style={{ position: 'absolute', zIndex: -1, opacity: Math.min(1, lit * 2), ...look.box, transform: `${look.box.transform ?? ''} scale(${interpolate(lit, [0, 1], [0.7, 1])})` }} /> : null}
              {display(word.text)}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
