// timeline: a vertical time axis draws down, milestones pop out on alternating sides as they are spoken.
import React from 'react';
import { interpolate, useVideoConfig } from 'remotion';
import { cueSequence, easeInOut, enter, float, progress, pulse } from '../motion';
import type { TimelineData } from '../schema';
import { EmphasisText } from '../text';
import { alpha, bodyStyle, COLORS, FONT_FAMILY, fitTitle, SIZE, TEXT_SHADOW, titleStyle, WEIGHT } from '../theme';
import { ContentArea, Glass, Sfx, type TemplateProps } from './common';

const GAP = 230;

export const Timeline: React.FC<TemplateProps> = ({ scene, frame, words, length }) => {
  const { fps } = useVideoConfig();
  const events = (scene.data as TimelineData).events.slice(0, 4);
  // Cue on the time label first ("1969"), which is what narration usually says out loud.
  const cues = cueSequence(words, events.map((e) => e.time), fps, 10, Math.max(30, length - 16));
  const axisLength = (events.length - 1) * GAP + 120;
  const axis = progress(frame, 2, cues[cues.length - 1] + 6, easeInOut);
  return (
    <ContentArea gap={40}>
      {scene.title ? <EmphasisText text={scene.title} emphasis={scene.emphasis} frame={frame} fps={fps} start={0} mode="fade" style={titleStyle(fitTitle(scene.title, SIZE.title - 16))} /> : null}
      <div style={{ position: 'relative', width: '100%', height: axisLength, transform: `translateY(${float(frame, 5, 110)}px)` }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, width: 8, marginLeft: -4, height: axisLength, borderRadius: 8, background: alpha(COLORS.text, 0.12) }} />
        <div style={{ position: 'absolute', left: '50%', top: 0, width: 8, marginLeft: -4, height: axisLength * axis, borderRadius: 8, background: `linear-gradient(180deg, ${COLORS.secondary}, ${COLORS.primary})`, boxShadow: `0 0 22px ${alpha(COLORS.secondary, 0.7)}` }} />
        {events.map((event, i) => {
          const s = enter(frame, fps, cues[i]);
          const left = i % 2 === 0;
          const current = frame >= cues[i] && (i === events.length - 1 || frame < cues[i + 1]);
          return (
            <div key={i} style={{ position: 'absolute', top: 60 + i * GAP - 70, left: 0, right: 0, height: 140 }}>
              <div style={{
                position: 'absolute', left: '50%', top: 70 - 26, width: 52, height: 52, marginLeft: -26, borderRadius: '50%',
                background: current ? COLORS.accent : frame >= cues[i] ? COLORS.primary : alpha(COLORS.bg, 0.9), border: `5px solid ${frame >= cues[i] ? COLORS.text : alpha(COLORS.text, 0.35)}`,
                boxShadow: `0 0 ${current ? 26 + pulse(frame, 20) * 24 : 14}px ${current ? COLORS.accent : alpha(COLORS.primary, frame >= cues[i] ? 1 : 0.3)}`,
                transform: `scale(${interpolate(enter(frame, fps, 4 + i * 5), [0, 1], [0, 0.7]) + 0.3 * s})`,
              }} />
              <Glass glow={current ? 0.5 : 0.1} style={{
                position: 'absolute', top: 0, width: '43%', height: 140, padding: '16px 24px', display: 'flex', flexDirection: 'column', justifyContent: 'center',
                ...(left ? { right: '55%' } : { left: '55%' }),
                transform: `translateX(${interpolate(s, [0, 1], [left ? -80 : 80, 0])}px) scale(${interpolate(s, [0, 1], [0.6, 1])})`,
                opacity: frame < cues[i] ? 0.35 * Math.min(1, enter(frame, fps, 6 + i * 5)) : Math.min(1, 0.35 + s),
                filter: frame < cues[i] ? 'saturate(0.3)' : undefined,
                transformOrigin: left ? 'right center' : 'left center',
              }}>
                <div style={{ fontFamily: FONT_FAMILY, fontWeight: WEIGHT.heavy, fontSize: 52, lineHeight: 1.05, color: current ? COLORS.accent : COLORS.secondary, textShadow: TEXT_SHADOW, textAlign: left ? 'right' : 'left' }}>{event.time}</div>
                <div style={{ ...bodyStyle(34), color: COLORS.text, textAlign: left ? 'right' : 'left', lineHeight: 1.25 }}>{event.text}</div>
              </Glass>
            </div>
          );
        })}
      </div>
      {cues.map((at, i) => <Sfx key={i} at={at} name="pop" />)}
    </ContentArea>
  );
};
