// list: up to 3 rows with icons, each row lands when its words are spoken.
import React from 'react';
import { interpolate, useVideoConfig } from 'remotion';
import { cueSequence, enter, float, settle } from '../motion';
import type { ListData } from '../schema';
import { EmphasisText } from '../text';
import { bodyStyle, COLORS, fitTitle, SIZE, titleStyle, WEIGHT } from '../theme';
import { ContentArea, Glass, IconBadge, Sfx, type TemplateProps } from './common';

export const List: React.FC<TemplateProps> = ({ scene, frame, words, length }) => {
  const { fps } = useVideoConfig();
  const data = scene.data as ListData;
  const items = data.items.slice(0, 3);
  const cues = cueSequence(words, items.map((i) => i.text), fps, 8, Math.max(20, length - 20));
  return (
    <ContentArea gap={34}>
      {scene.title ? <EmphasisText text={scene.title} emphasis={scene.emphasis} frame={frame} fps={fps} start={0} mode="fade" style={{ ...titleStyle(fitTitle(scene.title, SIZE.title - 16)), marginBottom: 12 }} /> : null}
      {items.map((item, i) => {
        const s = settle(frame, fps, 4 + i * 5); // placeholder row enters immediately, staggered
        const on = enter(frame, fps, cues[i]); // lights up when its words are spoken
        const icon = enter(frame, fps, cues[i] + 3);
        const spoken = frame >= cues[i];
        const active = spoken && (i === items.length - 1 || frame < cues[i + 1]);
        return (
          <Glass key={i} glow={active ? 0.6 : 0.1} tint={active ? COLORS.secondary : COLORS.primary} style={{
            width: '100%', padding: '30px 36px', display: 'flex', alignItems: 'center', gap: 34,
            transform: `translateX(${interpolate(s, [0, 1], [700, 0])}px) translateY(${float(frame, 5, 90, i * 30)}px) scale(${active ? 1.03 : 1})`,
            opacity: Math.min(1, s * 1.5) * interpolate(on, [0, 1], [0.45, 1], { extrapolateRight: 'clamp' }),
            border: active ? `2px solid ${COLORS.secondary}` : undefined,
          }}>
            <div style={{ transform: `scale(${interpolate(icon, [0, 1], [0.7, 1])})`, flexShrink: 0 }}><IconBadge name={item.icon} size={118} frame={frame + i * 9} ring={active} /></div>
            <div style={{ ...bodyStyle(SIZE.body + 8), fontWeight: WEIGHT.bold, color: COLORS.text, textAlign: 'left', display: 'flex', alignItems: 'baseline' }}>
              <span style={{ color: COLORS.accent, marginRight: 14 }}>{i + 1}.</span>
              <span style={{ opacity: Math.min(1, on * 1.4), transform: `translateX(${interpolate(on, [0, 1], [30, 0])}px)`, display: 'inline-block' }}>{item.text}</span>
            </div>
          </Glass>
        );
      })}
      {cues.map((at, i) => <Sfx key={i} at={at + 2} name="pop" />)}
    </ContentArea>
  );
};
