// quote: framed quotation revealed word by word, huge faded quote marks floating behind.
import React from 'react';
import { interpolate, useVideoConfig } from 'remotion';
import { enter, float, settle } from '../motion';
import type { QuoteData } from '../schema';
import { EmphasisText } from '../text';
import { alpha, bodyStyle, COLORS, FONT_FAMILY, SIZE, titleStyle, WEIGHT } from '../theme';
import { ContentArea, fadeUp, Glass, Sfx, type TemplateProps } from './common';

export const Quote: React.FC<TemplateProps> = ({ scene, frame, length }) => {
  const { fps } = useVideoConfig();
  const data = scene.data as QuoteData;
  const words = data.quote.split(/\s+/).length;
  // Spread the reveal across ~60% of the scene, 2-5 frames per word.
  const stagger = Math.max(2, Math.min(5, Math.floor((length * 0.6) / Math.max(1, words))));
  const frameIn = settle(frame, fps, 0);
  const author = enter(frame, fps, 8 + words * stagger + 4);
  const size = [...data.quote].length > 90 ? SIZE.titleMin : [...data.quote].length > 50 ? 80 : 92;
  return (
    <ContentArea>
      <Glass glow={0.3} style={{
        position: 'relative', width: '100%', padding: '110px 60px 80px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 40,
        transform: `scale(${interpolate(frameIn, [0, 1], [0.8, 1])}) translateY(${float(frame, 7, 110)}px)`, opacity: Math.min(1, frameIn * 1.5),
      }}>
        <div style={{ position: 'absolute', left: 20, top: -120, fontFamily: FONT_FAMILY, fontWeight: WEIGHT.heavy, fontSize: 480, lineHeight: 1, color: alpha(COLORS.primary, 0.32), transform: `translateY(${float(frame, 14, 130)}px) rotate(${float(frame, 4, 160)}deg)` }}>“</div>
        <div style={{ position: 'absolute', right: 20, bottom: -300, fontFamily: FONT_FAMILY, fontWeight: WEIGHT.heavy, fontSize: 480, lineHeight: 1, color: alpha(COLORS.secondary, 0.22), transform: `translateY(${float(frame, 14, 140, 60)}px)` }}>”</div>
        <EmphasisText text={data.quote} emphasis={scene.emphasis} frame={frame} fps={fps} start={8} stagger={stagger} mode="fade" style={{ ...titleStyle(size), fontWeight: WEIGHT.bold, position: 'relative' }} />
        {data.author ? <div style={{ ...bodyStyle(SIZE.body), color: COLORS.secondary, fontWeight: WEIGHT.bold, ...fadeUp(author) }}>— {data.author}</div> : null}
      </Glass>
      <Sfx at={1} name="whoosh" volume={0.1} />
    </ContentArea>
  );
};
