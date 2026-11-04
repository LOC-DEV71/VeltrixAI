// Synthesizes the bundled sound assets (no third-party samples, so no licensing questions):
//   public/sfx/whoosh.wav, pop.wav, tick.wav   short effects, mixed low in the video
//   public/music/ambient-1.wav                 32 s seamless ambient loop (A minor pad + soft arpeggio)
// Run: node scripts/make-audio-assets.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RATE = 48000;

function wav(file, samples) {
  const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round((v / peak) * 0.89 * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.concat([h, data]));
  console.log('wrote', file, (samples.length / RATE).toFixed(2) + 's');
}

// Deterministic noise.
let seed = 1234567;
const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };

/** Band-pass state-variable filter over noise with a moving center frequency. */
function whoosh(seconds = 0.5) {
  const n = Math.floor(seconds * RATE), out = new Float64Array(n);
  let low = 0, band = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const freq = 350 + 2800 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 2;
    const f = 2 * Math.sin((Math.PI * freq) / RATE), q = 0.35;
    const high = noise() - low - q * band; band += f * high; low += f * band;
    const env = Math.sin(Math.PI * Math.min(1, t ** 0.7)) ** 2;
    out[i] = band * env;
  }
  return out;
}

function pop(seconds = 0.14) {
  const n = Math.floor(seconds * RATE), out = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const freq = 320 + 620 * Math.exp(-t * 38);
    phase += (2 * Math.PI * freq) / RATE;
    out[i] = Math.sin(phase) * Math.exp(-t * 30) + (i < 90 ? noise() * 0.25 * (1 - i / 90) : 0);
  }
  return out;
}

function tick(seconds = 0.03) {
  const n = Math.floor(seconds * RATE), out = new Float64Array(n);
  for (let i = 0; i < n; i++) { const t = i / RATE; out[i] = Math.sin(2 * Math.PI * 2600 * t) * Math.exp(-t * 260) + (i < 30 ? noise() * 0.3 : 0); }
  return out;
}

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** 32 s loop: Am - F - C - G, 8 s each. Envelopes and plucks wrap around so the loop is seamless. */
function ambient() {
  const LENGTH = 32, n = LENGTH * RATE, out = new Float64Array(n);
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // A3 C4 E4 | F3 A3 C4 | C3 E3 G3 | G3 B3 D4
  const CHORD = 8, FADE = 2;
  const wrap = (t) => ((t % LENGTH) + LENGTH) % LENGTH;
  // Pad: each chord fades in/out over FADE seconds around its slot, computed on circular time.
  chords.forEach((notes, c) => {
    const start = c * CHORD;
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      const rel = wrap(t - start + FADE); // 0..LENGTH, chord active in [FADE, FADE + CHORD]
      if (rel > CHORD + 2 * FADE) continue;
      const env = rel < 2 * FADE ? Math.sin((Math.PI / 2) * (rel / (2 * FADE))) ** 2 : rel > CHORD ? Math.cos((Math.PI / 2) * ((rel - CHORD) / (2 * FADE))) ** 2 : 1;
      let v = 0;
      for (const m of notes) {
        const f = hz(m);
        v += Math.sin(2 * Math.PI * f * t) * 0.5 + Math.sin(2 * Math.PI * f * 1.004 * t) * 0.35 + Math.sin(2 * Math.PI * f * 0.5 * t) * 0.25;
      }
      v += Math.sin(2 * Math.PI * hz(notes[0] - 12) * t) * 0.55; // soft bass
      out[i] += v * env * (0.85 + 0.15 * Math.sin(2 * Math.PI * 0.11 * t)); // slow swell keeps it alive
    }
  });
  // Arpeggio: eighth-note sine plucks at 96 bpm over the chord tones, an octave up.
  const step = 60 / 96 / 2;
  for (let k = 0; k * step < LENGTH; k++) {
    const at = k * step;
    const notes = chords[Math.floor(at / CHORD) % chords.length];
    const m = notes[[0, 1, 2, 1][k % 4]] + 12;
    const f = hz(m), dur = 1.4;
    for (let j = 0; j < dur * RATE; j++) {
      const t = j / RATE, i = Math.floor(wrap(at + t) * RATE) % n;
      out[i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 3.2) * 0.32 * (k % 4 === 0 ? 1 : 0.7);
    }
  }
  return out;
}

wav(join(root, 'public/sfx/whoosh.wav'), whoosh());
wav(join(root, 'public/sfx/pop.wav'), pop());
wav(join(root, 'public/sfx/tick.wav'), tick());
wav(join(root, 'public/music/ambient-1.wav'), ambient());
