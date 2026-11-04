// Background camera moves chosen from the script's videoPrompt. No local image-to-video, so a still
// image gets a camera move instead: dolly, truck, tilt, orbit, or a seeded Ken Burns when unclear.
import { interpolate } from 'remotion';
import { random } from './motion';

export type CameraMove = 'dolly-in' | 'dolly-out' | 'truck-left' | 'truck-right' | 'tilt-up' | 'tilt-down' | 'orbit';

const RULES: Array<[RegExp, CameraMove]> = [
  [/\b(zoom(s|ing)? out|pull(s|ing)? (back|out)|dolly(ing)? out|widen)/i, 'dolly-out'],
  [/\b(zoom(s|ing)? in|push(es|ing)?( in)?|dolly(ing)? in|move(s)? (closer|in)|close[- ]up|towards?)\b/i, 'dolly-in'],
  [/\b(orbit(s|ing)?|circl(e|es|ing) around|rotat(e|es|ing) around|arc(s|ing)? around|360)\b/i, 'orbit'],
  [/\b(pan(s|ning)?|truck(s|ing)?|track(s|ing)?|slide(s)?|move(s)?) (to the )?left\b/i, 'truck-left'],
  [/\b(pan(s|ning)?|truck(s|ing)?|track(s|ing)?|slide(s)?|move(s)?) (to the )?right\b/i, 'truck-right'],
  [/\b(tilt(s|ing)? up|rise(s)?|rising|crane(s)? up|pedestal up|ascend(s|ing)?|look(s|ing)? up)\b/i, 'tilt-up'],
  [/\b(tilt(s|ing)? down|descend(s|ing)?|crane(s)? down|look(s|ing)? down|lower(s|ing)?)\b/i, 'tilt-down'],
];
const KEN_BURNS: CameraMove[] = ['dolly-in', 'dolly-out', 'truck-left', 'truck-right'];

/** The move described by `videoPrompt`, or a seeded Ken Burns move when it names none. */
export function cameraFromPrompt(videoPrompt: string | undefined, seed: number): { move: CameraMove; fromPrompt: boolean } {
  for (const [pattern, move] of RULES) if (videoPrompt && pattern.test(videoPrompt)) return { move, fromPrompt: true };
  return { move: KEN_BURNS[Math.floor(random(seed * 3 + 1) * KEN_BURNS.length) % KEN_BURNS.length], fromPrompt: false };
}

export type CameraPose = { x: number; y: number; scale: number; rotate: number };

/**
 * Pose at eased progress t (0..1). Scale always covers the frame edges for the translation used.
 * `strong` (hook scenes) roughly doubles the travel.
 */
export function cameraPose(move: CameraMove, t: number, strong = false): CameraPose {
  const k = strong ? 1.8 : 1;
  const lerp = (a: number, b: number) => interpolate(t, [0, 1], [a, b]);
  switch (move) {
    case 'dolly-in': return { x: 0, y: lerp(6, -10), scale: lerp(1.06, 1.06 + 0.16 * k), rotate: 0 };
    case 'dolly-out': return { x: 0, y: lerp(-8, 6), scale: lerp(1.06 + 0.16 * k, 1.06), rotate: 0 };
    // Camera moving left makes the picture slide right, and vice versa.
    case 'truck-left': return { x: lerp(-55 * k, 55 * k), y: 0, scale: 1.14 + 0.06 * k, rotate: 0 };
    case 'truck-right': return { x: lerp(55 * k, -55 * k), y: 0, scale: 1.14 + 0.06 * k, rotate: 0 };
    case 'tilt-up': return { x: 0, y: lerp(-80 * k, 80 * k), scale: 1.14 + 0.06 * k, rotate: 0 };
    case 'tilt-down': return { x: 0, y: lerp(80 * k, -80 * k), scale: 1.14 + 0.06 * k, rotate: 0 };
    case 'orbit': return { x: lerp(-24 * k, 24 * k), y: 0, scale: lerp(1.16, 1.22), rotate: lerp(-2.4 * k, 2.4 * k) };
  }
}

/** Foreground layers drift against the camera a little: cheap parallax depth. */
export const parallax = (pose: CameraPose, depth = 0.35) => ({ x: -pose.x * depth, y: -pose.y * depth });
