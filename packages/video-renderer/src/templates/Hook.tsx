// hook: words pop in one by one, big icon turning gently in a glow ring, white flash on the first frames.
import React from 'react';
import { AbsoluteFill, interpolate, useVideoConfig } from 'remotion';
import { enter, easeOut, float, progress, STAGGER } from '../motion';
import { EmphasisText } from '../text';
import { alpha, bodyStyle, COLORS, fitTitle, SIZE, STYLE, titleStyle, VARIANT } from '../theme';
import { Icon } from '../icons';
import { ContentArea, fadeUp, IconBadge, Sfx, type TemplateProps } from './common';

export const Hook: React.FC<TemplateProps> = ({ scene, frame }) => {
  const { fps } = useVideoConfig();
  const title = scene.title || scene.voice;
  const words = title.split(/\s+/).filter(Boolean).length;
  const iconIn = enter(frame, fps, 2);
  const flash = 1 - progress(frame, 0, 7, easeOut);
  const subtitleAt = 6 + words * STAGGER + 4;
  const layout = VARIANT.hook;
  const titleEl = <EmphasisText text={title} emphasis={scene.emphasis} frame={frame} fps={fps} start={6} mode="pop" style={{ ...titleStyle(fitTitle(title, SIZE.hero - (layout === 'watermark' ? 0 : 12))), ...(layout === 'side' ? { textAlign: 'left' } : {}) }} />;
  const subtitleEl = scene.subtitle ? <div style={{ ...bodyStyle(SIZE.body + 4), ...(layout === 'side' ? { textAlign: 'left' } : {}), ...fadeUp(enter(frame, fps, subtitleAt)) }}>{scene.subtitle}</div> : null;
  const badge = (size: number) => (
    <div style={{
      transform: `scale(${interpolate(iconIn, [0, 1], [0.2, 1])}) rotate(${interpolate(iconIn, [0, 1], [-140, 0]) + float(frame, 7, 110)}deg) translateY(${float(frame, 10, 80)}px)`,
      opacity: Math.min(1, iconIn * 1.5),
    }}>
      <IconBadge name={scene.icon} size={size} frame={frame} color={COLORS.accent} />
    </div>
  );
  return (
    <>
      {layout === 'watermark' ? (
        // Giant faded icon behind a bigger title.
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: 0.16 * Math.min(1, iconIn * 1.4), transform: `scale(${interpolate(iconIn, [0, 1], [1.3, 1])}) rotate(${float(frame, 4, 160)}deg)` }}>
          <Icon name={scene.icon} size={760} color={STYLE.card === 'sticker' ? '#111111' : COLORS.primary} strokeWidth={1.4} />
        </AbsoluteFill>
      ) : null}
      {layout === 'side' ? (
        // Left aligned editorial block with an accent rule, small badge on top.
        <ContentArea gap={34} justify="center">
          <div style={{ alignSelf: 'stretch', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 30 }}>
            {badge(170)}
            <div style={{ display: 'flex', gap: 30, alignItems: 'stretch' }}>
              <div style={{ width: 14, borderRadius: STYLE.card === 'neon' ? 0 : 8, background: COLORS.accent, transform: `scaleY(${iconIn})`, transformOrigin: 'top' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>{titleEl}{subtitleEl}</div>
            </div>
          </div>
        </ContentArea>
      ) : (
        <ContentArea gap={48}>
          {layout === 'stack' ? badge(260) : null}
          {titleEl}
          {subtitleEl}
        </ContentArea>
      )}
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 42%, ${alpha(COLORS.text, 0.95)}, ${alpha(COLORS.secondary, 0.4)} 60%, ${alpha(COLORS.bg, 0)} 100%)`, opacity: flash * 0.9, pointerEvents: 'none' }} />
      <Sfx at={2} name="pop" />
    </>
  );
};
