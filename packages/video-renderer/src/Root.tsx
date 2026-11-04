import { CalculateMetadataFunction, Composition } from 'remotion';
import React from 'react';
import { loadFonts } from './fonts';
import { SAMPLE_STORYBOARD } from './sample';
import { sceneFrames, type VideoProps } from './schema';
import { AutoVideo } from './Video';

export const FPS = 30;
loadFonts();

const calculateMetadata: CalculateMetadataFunction<VideoProps> = ({ props }) => ({
  fps: props.fps,
  width: props.width,
  height: props.height,
  durationInFrames: Math.max(1, props.scenes.reduce((sum, s) => sum + s.durationInFrames, 0)),
});

// Studio preview: no audio, ~3.5 s per scene. Real renders pass inputProps from render-job.mjs.
const preview: VideoProps = {
  fps: FPS, width: 1080, height: 1920, musicSrc: null, sfx: false,
  scenes: SAMPLE_STORYBOARD.map((scene) => ({ scene, audioSrc: null, durationInFrames: sceneFrames(3.5, FPS), background: { kind: 'gradient' } })),
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="AutoVideo"
    component={AutoVideo}
    calculateMetadata={calculateMetadata}
    durationInFrames={1}
    fps={FPS}
    width={1080}
    height={1920}
    defaultProps={preview}
  />
);
