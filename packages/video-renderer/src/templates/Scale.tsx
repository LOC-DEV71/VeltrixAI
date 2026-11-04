// scale: a multi-level ladder; a light dot climbs to the level being talked about, the camera follows.
import React from 'react';
import { interpolate, useVideoConfig } from 'remotion';
import { cue, easeInOut, enter, float, progress, pulse } from '../motion';
import type { ScaleData } from '../schema';
import { EmphasisText } from '../text';
import { alpha, bodyStyle, COLORS, fitTitle, SIZE, TEXT_SHADOW, titleStyle, WEIGHT } from '../theme';
import { CAPTION_BAND, Glass, Sfx, type TemplateProps } from './common';
import { AbsoluteFill } from 'remotion';
import { DESIGN, SAFE } from '../theme';

const STEP = 210; // vertical distance between levels

export const Scale: React.FC<TemplateProps> = ({ scene, frame, words, length }) => {
  const { fps } = useVideoConfig();
  const { width, height } = DESIGN;
  const data = scene.data as ScaleData;
  const levels = data.levels;
  const active = Math.min(data.active, levels.length - 1);
  const top = Math.round(height * SAFE.top) + 24;
  const viewBottom = height - Math.round(height * SAFE.bottom) - CAPTION_BAND;
  const titleBlock = scene.title ? 250 : 0;
  const view = viewBottom - top - titleBlock; // visible ladder height
  const start = 12;
  const climbTo = Math.max(start + 20, Math.min(length - 16, cue(words, levels[active], fps, Math.round(length * 0.55)).frame + 6));
  const climb = progress(frame, start, climbTo, easeInOut);
  const dotLevel = climb * active; // fractional level
  const ladder = (levels.length - 1) * STEP;
  // Ladder y=0 is the top level. The dot sits at (levels-1-dotLevel)*STEP. Camera keeps it in the middle of the view.
  const dotY = (levels.length - 1 - dotLevel) * STEP;
  const camera = Math.max(Math.min(0, view / 2 - dotY), view - ladder - 120);
  const intro = enter(frame, fps, 0);
  return (
    <AbsoluteFill style={{ paddingTop: top, paddingLeft: width * SAFE.side, paddingRight: width * SAFE.side }}>
      {scene.title ? (
        <div style={{ height: titleBlock, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <EmphasisText text={scene.title} emphasis={scene.emphasis} frame={frame} fps={fps} start={0} mode="fade" style={titleStyle(fitTitle(scene.title, SIZE.title - 16))} />
        </div>
      ) : null}
      <div style={{ position: 'relative', height: view, overflow: 'hidden', maskImage: 'linear-gradient(180deg, transparent, black 10%, black 90%, transparent)', WebkitMaskImage: 'linear-gradient(180deg, transparent, black 10%, black 90%, transparent)' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 60, transform: `translateY(${camera + float(frame, 5, 100)}px)` }}>
          {/* Rail */}
          <div style={{ position: 'absolute', left: 120, top: 0, width: 10, height: ladder, borderRadius: 9, background: alpha(COLORS.text, 0.14) }} />
          <div style={{ position: 'absolute', left: 120, top: dotY, width: 10, height: ladder - dotY, borderRadius: 9, background: `linear-gradient(180deg, ${COLORS.secondary}, ${COLORS.primary})`, boxShadow: `0 0 24px ${alpha(COLORS.primary, 0.8)}` }} />
          {levels.map((label, i) => {
            const y = (levels.length - 1 - i) * STEP;
            const appear = enter(frame, fps, i * 4);
            const passed = dotLevel >= i - 0.02;
            const isActive = i === active && climb > 0.98;
            return (
              <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: y - 50, height: 100, display: 'flex', alignItems: 'center', gap: 34, opacity: Math.min(1, appear * 1.4) * intro, transform: `translateX(${interpolate(appear, [0, 1], [120, 0])}px)` }}>
                <div style={{ width: 50, height: 50, marginLeft: 100, borderRadius: '50%', background: passed ? COLORS.primary : alpha(COLORS.bg, 0.8), border: `4px solid ${passed ? COLORS.secondary : alpha(COLORS.text, 0.3)}`, flexShrink: 0 }} />
                <Glass glow={isActive ? 0.9 : 0} tint={COLORS.accent} style={{
                  flex: 1, height: 100, padding: '0 34px', display: 'flex', alignItems: 'center', borderRadius: 26,
                  border: isActive ? `3px solid ${COLORS.accent}` : undefined, background: passed ? alpha(COLORS.primary, 0.22) : undefined,
                  transform: `scale(${isActive ? 1 + 0.03 * pulse(frame, 30) : 1})`, transformOrigin: 'left center',
                }}>
                  <div style={{
                    ...bodyStyle(isActive ? SIZE.body + 12 : SIZE.body + 2), fontWeight: isActive ? WEIGHT.heavy : WEIGHT.bold, textAlign: 'left',
                    color: isActive ? COLORS.accent : passed ? COLORS.text : alpha(COLORS.text, 0.6),
                    textShadow: isActive ? `${TEXT_SHADOW}, 0 0 28px ${alpha(COLORS.accent, 0.6)}` : TEXT_SHADOW,
                  }}>{label}</div>
                </Glass>
              </div>
            );
          })}
          {/* Climbing light dot */}
          <div style={{ position: 'absolute', left: 125 - 34, top: dotY - 34, width: 68, height: 68, borderRadius: '50%', background: `radial-gradient(circle, ${COLORS.text} 0%, ${COLORS.accent} 35%, ${alpha(COLORS.accent, 0)} 72%)`, boxShadow: `0 0 ${40 + pulse(frame, 16) * 30}px ${COLORS.accent}`, opacity: intro }} />
        </div>
      </div>
      <Sfx at={start} name="whoosh" volume={0.1} />
      <Sfx at={climbTo} name="pop" volume={0.24} />
    </AbsoluteFill>
  );
};
