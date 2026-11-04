// compare: split screen, cards enter from both sides, "VS" bounces in the middle, the winner lights up.
import React from 'react';
import { interpolate, useVideoConfig } from 'remotion';
import { cue, enter, float, progress, pulse, settle } from '../motion';
import type { CompareData } from '../schema';
import { EmphasisText } from '../text';
import { alpha, bodyStyle, COLORS, FONT_FAMILY, onColor, fitTitle, SIZE, TEXT_SHADOW, titleStyle, WEIGHT } from '../theme';
import { ContentArea, Glass, IconBadge, Sfx, type TemplateProps } from './common';

export const Compare: React.FC<TemplateProps> = ({ scene, frame, words, length }) => {
  const { fps } = useVideoConfig();
  const data = scene.data as CompareData;
  const left = settle(frame, fps, 2);
  const right = settle(frame, fps, 6);
  const vs = enter(frame, fps, 12);
  const winner = data.winner === 'none' ? null : data.winner;
  const winnerLabel = winner ? data[winner].label : '';
  const revealAt = winner ? Math.max(24, Math.min(length - 24, cue(words, winnerLabel, fps, Math.round(length * 0.6), Math.floor(words.length / 2)).frame)) : 0;
  const reveal = winner ? progress(frame, revealAt, revealAt + 10) : 0;
  const card = (side: 'left' | 'right', s: number) => {
    const isWinner = winner === side;
    const lit = isWinner ? reveal : 0;
    const dim = winner && !isWinner ? reveal : 0;
    const d = data[side];
    const tint = side === 'left' ? COLORS.secondary : COLORS.primary;
    return (
      <Glass glow={lit * (0.7 + 0.3 * pulse(frame, 30))} tint={COLORS.accent} style={{
        flex: 1, minHeight: 560, padding: '54px 26px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 30,
        transform: `translateX(${interpolate(s, [0, 1], [side === 'left' ? -720 : 720, 0])}px) translateY(${float(frame, 7, 100, side === 'left' ? 0 : 50)}px) scale(${1 + lit * 0.06 - dim * 0.04})`,
        opacity: Math.min(1, s * 1.5) * (1 - dim * 0.45),
        border: lit > 0 ? `3px solid ${alpha(COLORS.accent, lit)}` : undefined,
      }}>
        <IconBadge name={d.icon} size={150} frame={frame + (side === 'left' ? 0 : 20)} color={isWinner && lit > 0.5 ? COLORS.accent : tint} />
        <div style={{ ...bodyStyle(SIZE.body + 8), fontWeight: WEIGHT.heavy, color: COLORS.text }}>{d.label}</div>
        {d.value ? <div style={{ fontFamily: FONT_FAMILY, fontWeight: WEIGHT.heavy, fontSize: 64, color: isWinner ? COLORS.accent : tint, textShadow: TEXT_SHADOW, textAlign: 'center' }}>{d.value}</div> : null}
      </Glass>
    );
  };
  return (
    <ContentArea gap={46}>
      {scene.title ? <EmphasisText text={scene.title} emphasis={scene.emphasis} frame={frame} fps={fps} start={0} mode="fade" style={titleStyle(fitTitle(scene.title, SIZE.title - 16))} /> : null}
      <div style={{ position: 'relative', width: '100%', display: 'flex', gap: 40, alignItems: 'stretch' }}>
        {card('left', left)}
        {card('right', right)}
        <div style={{
          position: 'absolute', left: '50%', top: '50%', width: 150, height: 150, marginLeft: -75, marginTop: -75, borderRadius: '50%',
          background: `radial-gradient(circle at 35% 30%, ${COLORS.accent}, ${alpha(COLORS.accent, 0.75)} 70%)`, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: FONT_FAMILY, fontWeight: WEIGHT.heavy, fontSize: 64, color: onColor(COLORS.accent),
          boxShadow: `0 0 ${30 + pulse(frame, 24) * 30}px ${alpha(COLORS.accent, 0.7)}`,
          transform: `scale(${interpolate(vs, [0, 1], [0, 1])}) rotate(${interpolate(vs, [0, 1], [-30, 0]) + float(frame, 6, 50)}deg)`,
        }}>VS</div>
      </div>
      <Sfx at={2} name="whoosh" volume={0.12} />
      <Sfx at={12} name="pop" />
      {winner ? <Sfx at={revealAt} name="pop" volume={0.24} /> : null}
    </ContentArea>
  );
};
