// The whole video: scenes with overlapping transitions, voice, sound effects and ducked music.
import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Captions, fallbackWords } from './Captions';
import { cameraFromPrompt, parallax } from './camera';
import { BackgroundLayer, ColorLayer, PatternLayer, scenePose } from './layers';
import { exit, setTransitionFrames, TRANSITION_FRAMES } from './motion';
import { PAD_FRAMES, type RenderScene, type SceneType, type VideoProps, type WordTiming } from './schema';
import { Compare } from './templates/Compare';
import { DesignCanvas, Sfx, SfxProvider, type TemplateProps } from './templates/common';
import { Cta } from './templates/Cta';
import { Hook } from './templates/Hook';
import { IconCard } from './templates/IconCard';
import { List } from './templates/List';
import { Quote } from './templates/Quote';
import { Scale } from './templates/Scale';
import { Stat } from './templates/Stat';
import { Timeline } from './templates/Timeline';
import { enterStyle, exitStyle, pickTransitions, wipeEdge, type TransitionKind } from './transitions';
import { alpha, applyTheme, COLORS, STYLE, VARIANT } from './theme';

export const TEMPLATES: Record<SceneType, React.FC<TemplateProps>> = {
  hook: Hook, icon_card: IconCard, stat: Stat, list: List, compare: Compare, scale: Scale, timeline: Timeline, quote: Quote, cta: Cta,
};

export const sceneWords = (rs: RenderScene, fps: number): WordTiming[] =>
  rs.scene.words.length ? rs.scene.words : fallbackWords(rs.scene.voice, Math.max(0.5, (rs.durationInFrames - PAD_FRAMES) / fps));

const SceneFrame: React.FC<{ rs: RenderScene; index: number; enterKind: TransitionKind | null; exitKind: TransitionKind | null }> = ({ rs, index, enterKind, exitKind }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const length = rs.durationInFrames;
  const words = useMemo(() => sceneWords(rs, fps), [rs, fps]);
  const Template = TEMPLATES[rs.scene.type];
  const camera = useMemo(() => cameraFromPrompt(rs.scene.videoPrompt, index + 1), [rs.scene.videoPrompt, index]);
  const pose = scenePose(camera.move, frame, length + TRANSITION_FRAMES, rs.scene.type === 'hook');
  // Content leaves fast and clean right as the next scene starts covering it.
  const out = exit(frame, length - 2, 7);
  return (
    <AbsoluteFill style={{ ...enterStyle(enterKind, frame, fps, TRANSITION_FRAMES), ...exitStyle(exitKind, frame, length, TRANSITION_FRAMES), overflow: 'hidden' }}>
      <BackgroundLayer background={rs.background} pose={pose} seed={index + 1 + VARIANT.patternPhase} />
      <ColorLayer seed={index + 1 + VARIANT.patternPhase} />
      <PatternLayer seed={index + 1 + VARIANT.patternPhase} density={rs.scene.type === 'hook' || rs.scene.type === 'cta' ? 1.3 : 1} offset={parallax(pose)} />
      <DesignCanvas>
        <AbsoluteFill style={{ opacity: 1 - out, transform: `scale(${interpolate(out, [0, 1], [1, 0.9])})` }}>
          <Template scene={rs.scene} frame={frame} length={length} words={words} />
        </AbsoluteFill>
        <Captions words={words} emphasis={rs.scene.emphasis} sceneFrames={length} />
      </DesignCanvas>
      {enterKind === 'wipe' && frame < TRANSITION_FRAMES + 1 ? <WipeSeam frame={frame} /> : null}
    </AbsoluteFill>
  );
};

/** Glowing diagonal seam riding the wipe edge. */
const WipeSeam: React.FC<{ frame: number }> = ({ frame }) => {
  const x = wipeEdge(frame, TRANSITION_FRAMES);
  return (
    <AbsoluteFill style={{
      clipPath: `polygon(${x + 22}% 0%, ${x + 28}% 0%, ${x + 3}% 100%, ${x - 3}% 100%)`,
      background: `linear-gradient(90deg, ${alpha(COLORS.secondary, 0)}, ${COLORS.secondary}, ${COLORS.text}, ${COLORS.primary}, ${alpha(COLORS.primary, 0)})`,
    }} />
  );
};

/** Frame ranges where any voice is speaking, merged across small gaps. */
export function speechRanges(scenes: RenderScene[], starts: number[], fps: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  scenes.forEach((rs, i) => {
    for (const w of sceneWords(rs, fps)) {
      const a = starts[i] + Math.floor(w.start * fps), b = starts[i] + Math.ceil(w.end * fps);
      const last = ranges[ranges.length - 1];
      if (last && a - last[1] <= 8) last[1] = Math.max(last[1], b); else ranges.push([a, b]);
    }
  });
  return ranges;
}

const MUSIC = { bed: 0.17, ducked: 0.045, attack: 5, release: 14 };

/** Music volume per frame: dips under the voice (ducking), fades in and out at the ends. */
export function musicVolumes(total: number, ranges: Array<[number, number]>): number[] {
  const duck = new Array<number>(total).fill(0);
  const smooth = (x: number) => x * x * (3 - 2 * x);
  for (const [a, b] of ranges) {
    for (let f = Math.max(0, a - MUSIC.attack); f < Math.min(total, b + MUSIC.release); f++) {
      const v = f < a ? smooth((f - (a - MUSIC.attack)) / MUSIC.attack) : f <= b ? 1 : smooth(1 - (f - b) / MUSIC.release);
      duck[f] = Math.max(duck[f], v);
    }
  }
  return duck.map((d, f) => {
    const edge = Math.min(1, smooth(Math.min(1, f / 20)), smooth(Math.min(1, (total - f) / 36)));
    return (MUSIC.bed + (MUSIC.ducked - MUSIC.bed) * d) * edge;
  });
}

export const AutoVideo: React.FC<VideoProps> = ({ scenes, musicSrc, sfx, theme, seed = 1 }) => {
  // Before any child renders: every module reads the theme's live values (see theme.ts).
  applyTheme(theme, seed);
  setTransitionFrames(STYLE.transitionFrames);
  const { fps, durationInFrames } = useVideoConfig();
  const starts = useMemo(() => scenes.reduce<number[]>((acc, s, i) => [...acc, i ? acc[i - 1] + scenes[i - 1].durationInFrames : 0], []), [scenes]);
  const kinds = useMemo(() => pickTransitions(Math.max(0, scenes.length - 1), seed + scenes.length, STYLE.transitions), [scenes.length, seed, theme]); // eslint-disable-line react-hooks/exhaustive-deps
  const volumes = useMemo(() => musicVolumes(durationInFrames, speechRanges(scenes, starts, fps)), [durationInFrames, scenes, starts, fps]);
  const last = scenes.length - 1;
  return (
    <SfxProvider value={sfx}>
      <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
        {scenes.map((rs, i) => (
          <Sequence key={`v${i}`} from={starts[i]} durationInFrames={rs.durationInFrames + (i < last ? TRANSITION_FRAMES : 0)} name={`${i + 1}. ${rs.scene.type}`}>
            <SceneFrame rs={rs} index={i} enterKind={i ? kinds[i - 1] : null} exitKind={i < last ? kinds[i] : null} />
          </Sequence>
        ))}
        {scenes.map((rs, i) => rs.audioSrc ? (
          <Sequence key={`a${i}`} from={starts[i]} durationInFrames={rs.durationInFrames} layout="none">
            <Audio src={rs.audioSrc} />
          </Sequence>
        ) : null)}
        {starts.slice(1).map((at, i) => <Sfx key={`w${i}`} at={at - 4} name="whoosh" />)}
        {musicSrc ? <Audio src={/^https?:\/\//.test(musicSrc) ? musicSrc : staticFile(musicSrc)} loop volume={(f) => volumes[Math.min(volumes.length - 1, Math.max(0, f))] ?? 0} /> : null}
      </AbsoluteFill>
    </SfxProvider>
  );
};
