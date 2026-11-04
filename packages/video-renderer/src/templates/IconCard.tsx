// icon_card: glass card slides up, icon with a pulsing glow ring, typed title, description fades in.
import React from 'react';
import { interpolate, useVideoConfig } from 'remotion';
import { enter, float, settle } from '../motion';
import { Typewriter } from '../text';
import { bodyStyle, COLORS, fitTitle, SIZE, titleStyle } from '../theme';
import { ContentArea, fadeUp, Glass, IconBadge, Sfx, type TemplateProps } from './common';

const CHARS_PER_FRAME = 1.8;

export const IconCard: React.FC<TemplateProps> = ({ scene, frame }) => {
  const { fps } = useVideoConfig();
  const title = scene.title || scene.voice.split(/\s+/).slice(0, 6).join(' ');
  const card = settle(frame, fps, 0);
  const icon = enter(frame, fps, 5);
  const typeStart = 9;
  const typed = typeStart + Math.ceil([...title].length / CHARS_PER_FRAME);
  const description = enter(frame, fps, typed + 3);
  return (
    <ContentArea>
      <Glass glow={0.4 + 0.2 * Math.sin(frame / 20)} style={{
        width: '100%', padding: '72px 56px 64px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 40,
        transform: `translateY(${interpolate(card, [0, 1], [420, 0]) + float(frame, 8, 100)}px) rotate(${interpolate(card, [0, 1], [-4, 0])}deg)`,
        opacity: Math.min(1, card * 1.6),
      }}>
        <div style={{ transform: `scale(${interpolate(icon, [0, 1], [0, 1])}) rotate(${float(frame, 5, 90)}deg)` }}>
          <IconBadge name={scene.icon} size={210} frame={frame} />
        </div>
        <Typewriter text={title} frame={frame} start={typeStart} charsPerFrame={CHARS_PER_FRAME} emphasis={scene.emphasis} style={{ ...titleStyle(fitTitle(title, SIZE.title - 8)), minHeight: '1.2em' }} />
        {scene.subtitle ? <div style={{ ...bodyStyle(), color: COLORS.text, ...fadeUp(description, 24) }}>{scene.subtitle}</div> : null}
      </Glass>
      <Sfx at={3} name="pop" />
    </ContentArea>
  );
};
