// cta: like/subscribe icons bounce in, light rings ripple outward, a short call to action.
import React from 'react';
import { interpolate, useVideoConfig } from 'remotion';
import { easeOut, enter, float, pulse } from '../motion';
import type { CtaData } from '../schema';
import { EmphasisText } from '../text';
import { alpha, buttonRadius, COLORS, FONT_FAMILY, fitTitle, onColor, SIZE, STYLE, TEXT_SHADOW, titleStyle, WEIGHT } from '../theme';
import { ContentArea, IconBadge, Sfx, type TemplateProps } from './common';

const LABELS: Record<CtaData['action'], string> = { subscribe: 'ĐĂNG KÝ', like: 'THÍCH', follow: 'THEO DÕI' };
const ICONS: Record<CtaData['action'], [string, string]> = { subscribe: ['bell', 'thumbs-up'], like: ['thumbs-up', 'heart'], follow: ['users', 'bell'] };

const Ripples: React.FC<{ frame: number; size: number }> = ({ frame, size }) => (
  <>
    {[0, 1, 2].map((k) => {
      const t = easeOut(((frame + k * 15) % 45) / 45);
      return <div key={k} style={{ position: 'absolute', left: '50%', top: '50%', width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, borderRadius: '50%', border: `4px solid ${alpha(COLORS.secondary, 0.7 * (1 - t))}`, transform: `scale(${1 + t * 1.3})` }} />;
    })}
  </>
);

export const Cta: React.FC<TemplateProps> = ({ scene, frame }) => {
  const { fps } = useVideoConfig();
  const action = (scene.data as CtaData).action;
  const [main, second] = ICONS[action];
  const a = enter(frame, fps, 2);
  const b = enter(frame, fps, 7);
  const button = enter(frame, fps, 12);
  const title = scene.title || 'Theo dõi để xem tiếp';
  // Periodic bounce so the icons keep moving through the whole scene.
  const bounce = (phase: number) => -Math.abs(Math.sin(((frame + phase) / 26) * Math.PI)) * 26;
  return (
    <ContentArea gap={60}>
      <div style={{ display: 'flex', gap: 90, alignItems: 'center' }}>
        <div style={{ position: 'relative', transform: `translateY(${bounce(0)}px) scale(${interpolate(a, [0, 1], [0, 1])}) rotate(${float(frame, 8, 40)}deg)` }}>
          <Ripples frame={frame} size={230} />
          <IconBadge name={main} size={230} frame={frame} color={COLORS.accent} ring={false} />
        </div>
        <div style={{ position: 'relative', transform: `translateY(${bounce(13)}px) scale(${interpolate(b, [0, 1], [0, 1])}) rotate(${float(frame, 8, 40, 20)}deg)` }}>
          <Ripples frame={frame + 20} size={190} />
          <IconBadge name={second} size={190} frame={frame + 20} color={COLORS.secondary} ring={false} />
        </div>
      </div>
      <EmphasisText text={title} emphasis={scene.emphasis} frame={frame} fps={fps} start={8} mode="pop" style={titleStyle(fitTitle(title, SIZE.title))} />
      <div style={{
        padding: '30px 84px', borderRadius: buttonRadius(), background: `linear-gradient(135deg, ${COLORS.primary}, ${alpha(COLORS.primary, 0.85)})`,
        border: STYLE.card === 'sticker' ? '6px solid #111111' : `3px solid ${alpha(COLORS.text, 0.4)}`, fontFamily: FONT_FAMILY, fontWeight: WEIGHT.heavy, fontSize: 64,
        color: onColor(COLORS.primary), textShadow: onColor(COLORS.primary) === '#FFFFFF' ? TEXT_SHADOW : 'none',
        textTransform: STYLE.titleCase === 'upper' ? 'uppercase' : 'none',
        clipPath: STYLE.card === 'neon' ? 'polygon(24px 0, 100% 0, 100% calc(100% - 24px), calc(100% - 24px) 100%, 0 100%, 0 24px)' : undefined,
        boxShadow: STYLE.card === 'sticker' ? '10px 10px 0 #111111' : `0 0 ${30 + pulse(frame, 30) * 40}px ${alpha(COLORS.primary, 0.85 * Math.max(0.3, STYLE.glow))}`,
        transform: `scale(${interpolate(button, [0, 1], [0.3, 1]) * (1 + 0.04 * pulse(frame, 30))})`, opacity: Math.min(1, button * 1.5),
      }}>{LABELS[action]}</div>
      <Sfx at={2} name="pop" />
      <Sfx at={7} name="pop" volume={0.16} />
      <Sfx at={12} name="pop" volume={0.22} />
    </ContentArea>
  );
};
