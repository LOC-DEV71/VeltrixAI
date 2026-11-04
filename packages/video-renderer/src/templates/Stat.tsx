// stat: number counts up from 0 (Vietnamese format) while a progress ring fills in sync; ticks while counting.
import React from 'react';
import { interpolate, useVideoConfig } from 'remotion';
import { cue, easeOut, enter, float, progress, pulse } from '../motion';
import type { StatData } from '../schema';
import { EmphasisText } from '../text';
import { alpha, bodyStyle, COLORS, FONT_FAMILY, SIZE, TEXT_SHADOW, titleStyle, WEIGHT, fitTitle } from '../theme';
import { ContentArea, fadeUp, formatViNumber, Sfx, type TemplateProps } from './common';

const RING = 560;
const STROKE = 30;

export const Stat: React.FC<TemplateProps> = ({ scene, frame, words, length }) => {
  const { fps } = useVideoConfig();
  const data = scene.data as StatData;
  // Start counting when the number is spoken (first word with a digit), else shortly after the enter phase.
  const digitWord = words.find((w) => /\d/.test(w.text));
  const start = Math.min(Math.max(8, digitWord ? cue(words, digitWord.text, fps, 8).frame : 8), Math.max(8, length - 40));
  const countFrames = Math.round(Math.min(48, Math.max(24, length * 0.45)));
  const p = progress(frame, start, start + countFrames, easeOut);
  const huge = data.value >= 1e18;
  const shownValue = huge ? Math.pow(10, Math.log10(data.value) * p) : data.value * p;
  const ringTarget = (data.percent ?? 100) / 100;
  const circumference = Math.PI * (RING - STROKE);
  const ringIn = enter(frame, fps, 0);
  const done = frame >= start + countFrames;
  const glow = done ? pulse(frame, 36) : p;
  const label = scene.title || data.label;
  const numberText = formatViNumber(shownValue, data.decimals);
  const ticks = [];
  for (let f = start; f < start + countFrames; f += 3) ticks.push(<Sfx key={f} at={f} name="tick" />);
  return (
    <ContentArea gap={40}>
      {label ? <EmphasisText text={label} emphasis={scene.emphasis} frame={frame} fps={fps} start={2} mode="fade" style={titleStyle(fitTitle(label, SIZE.title - 16))} /> : null}
      <div style={{ position: 'relative', width: RING, height: RING, transform: `scale(${interpolate(ringIn, [0, 1], [0.5, 1])}) translateY(${float(frame, 8, 95)}px)`, opacity: Math.min(1, ringIn * 1.5) }}>
        <svg width={RING} height={RING} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)', overflow: 'visible' }}>
          <circle cx={RING / 2} cy={RING / 2} r={(RING - STROKE) / 2} fill={alpha(COLORS.bg, 0.45)} stroke={alpha(COLORS.text, 0.12)} strokeWidth={STROKE} />
          <circle cx={RING / 2} cy={RING / 2} r={(RING - STROKE) / 2} fill="none" stroke={COLORS.primary} strokeWidth={STROKE} strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ringTarget * p)}
            style={{ filter: `drop-shadow(0 0 ${14 + glow * 18}px ${alpha(COLORS.primary, 0.9)})` }} />
          <circle cx={RING / 2} cy={RING / 2} r={(RING - STROKE) / 2 - 46} fill="none" stroke={alpha(COLORS.secondary, 0.5)} strokeWidth={4}
            strokeDasharray="4 18" style={{ transformOrigin: 'center', transform: `rotate(${frame * 0.6 + float(frame, 20, 120)}deg)` }} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
          <div style={{
            fontFamily: FONT_FAMILY, fontWeight: WEIGHT.heavy, fontSize: numberText.length > 9 ? 96 : 140, lineHeight: 1, color: COLORS.accent,
            textShadow: `${TEXT_SHADOW}, 0 0 ${20 + glow * 30}px ${alpha(COLORS.accent, 0.55)}`, transform: `scale(${done ? 1 + 0.04 * Math.sin((frame - start - countFrames) / 6) * Math.exp(-(frame - start - countFrames) / 20) + 0.0 : 1})`,
            fontVariantNumeric: 'tabular-nums', textAlign: 'center',
          }}>{numberText}</div>
          {data.unit ? <div style={{ ...bodyStyle(SIZE.body + 6), fontWeight: WEIGHT.bold, color: COLORS.text, marginTop: 12 }}>{data.unit}</div> : null}
        </div>
      </div>
      {scene.subtitle ? <div style={{ ...bodyStyle(), ...fadeUp(enter(frame, fps, start + countFrames)) }}>{scene.subtitle}</div> : null}
      {ticks}
      <Sfx at={start + countFrames} name="pop" />
    </ContentArea>
  );
};
