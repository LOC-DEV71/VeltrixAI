// Text with "emphasis" effects: yellow, 110% scale, a short shake and an underline that draws in.
import React from 'react';
import { interpolate } from 'remotion';
import { enter, normalizeWord, shake, STAGGER } from './motion';
import { COLORS } from './theme';

/** Marks which words belong to any emphasis phrase (multi-word phrases supported). */
export function emphasisMask(words: string[], emphasis: string[]): boolean[] {
  const tokens = words.map(normalizeWord);
  const mask = tokens.map(() => false);
  for (const phrase of emphasis) {
    const parts = phrase.split(/\s+/).map(normalizeWord).filter(Boolean);
    if (!parts.length) continue;
    for (let i = 0; i + parts.length <= tokens.length; i++) {
      if (parts.every((p, k) => tokens[i + k] === p)) for (let k = 0; k < parts.length; k++) mask[i + k] = true;
    }
  }
  return mask;
}

type Props = {
  text: string;
  emphasis: string[];
  frame: number;
  fps: number;
  /** First word appears at this frame. */
  start?: number;
  /** Frames between words. 0 shows the whole line at once. */
  stagger?: number;
  /** "pop" bounces words in; "fade" slides them up softly. */
  mode?: 'pop' | 'fade';
  style?: React.CSSProperties;
};

export const EmphasisText: React.FC<Props> = ({ text, emphasis, frame, fps, start = 0, stagger = STAGGER, mode = 'pop', style }) => {
  const words = text.split(/\s+/).filter(Boolean);
  const mask = emphasisMask(words, emphasis);
  return (
    // Inline words with balanced wrapping, so a title never leaves one orphan word on its last line.
    <div style={{ ...style, display: 'block', textWrap: 'balance' } as React.CSSProperties}>
      {words.map((word, i) => {
        const at = start + i * stagger;
        const s = enter(frame, fps, at);
        const strong = mask[i];
        const scale = mode === 'pop' ? interpolate(s, [0, 1], [0.4, 1]) : 1;
        const y = mode === 'pop' ? interpolate(s, [0, 1], [40, 0]) : interpolate(s, [0, 1], [24, 0]);
        const underline = enter(frame, fps, at + 6);
        return (
          <span
            key={i}
            style={{
              display: 'inline-block', position: 'relative', opacity: Math.min(1, s * 1.4), marginRight: i < words.length - 1 ? '0.26em' : 0,
              transform: `translate(${strong ? shake(frame, at + 3) : 0}px, ${y}px) scale(${scale * (strong ? 1.1 : 1)})`,
              color: strong ? COLORS.accent : undefined,
              marginLeft: strong ? '0.06em' : undefined,
            }}
          >
            {word}
            {strong ? (
              <span style={{
                position: 'absolute', left: '2%', right: '2%', bottom: '-0.02em', height: '0.1em', borderRadius: 99,
                background: COLORS.accent, transformOrigin: 'left center', transform: `scaleX(${Math.max(0, underline)})`,
                boxShadow: `0 0 18px ${COLORS.accent}`,
              }} />
            ) : null}
          </span>
        );
      })}
    </div>
  );
};

/** Typewriter: reveals characters over time, with a blinking caret while typing. */
export const Typewriter: React.FC<{ text: string; frame: number; start: number; charsPerFrame?: number; emphasis: string[]; style?: React.CSSProperties }> = ({ text, frame, start, charsPerFrame = 1.6, emphasis, style }) => {
  const chars = [...text];
  const shown = Math.max(0, Math.min(chars.length, Math.floor((frame - start) * charsPerFrame)));
  const typing = shown < chars.length;
  const words = text.split(/(\s+)/);
  const mask = emphasisMask(words.filter((w) => w.trim()), emphasis);
  let used = 0, wordIndex = 0;
  return (
    <div style={style}>
      {words.map((part, i) => {
        const visible = [...part].slice(0, Math.max(0, shown - used)).join('');
        used += [...part].length;
        if (!part.trim()) return <span key={i}>{visible}</span>;
        const strong = mask[wordIndex++];
        return <span key={i} style={strong ? { color: COLORS.accent } : undefined}>{visible}</span>;
      })}
      <span style={{ display: 'inline-block', width: '0.07em', height: '0.9em', marginLeft: '0.08em', verticalAlign: '-0.08em', borderRadius: 4, background: COLORS.secondary, boxShadow: `0 0 12px ${COLORS.secondary}`, opacity: typing || Math.floor(frame / 8) % 2 === 0 ? 1 : 0 }} />
    </div>
  );
};
