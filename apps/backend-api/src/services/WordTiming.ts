// Word timestamps for captions and on-cue animation.
//
// The local TTS returns audio only, and no Whisper model is installed, so timings are estimated from
// the audio itself: find voiced regions from the energy envelope, spread words over voiced time only
// (never over silence), and snap punctuation to the real pauses. Vietnamese is written one syllable
// per word, so speaking time per word is close to uniform, which keeps this estimate tight.

export interface WordTime { text: string; start: number; end: number }
export interface PcmAudio { sampleRate: number; samples: Float32Array; duration: number }

/** Parses PCM (8/16/24/32-bit) or float32 WAV into mono samples. Returns null when not a WAV we can read. */
export function parseWav(buffer: Buffer): PcmAudio | null {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12, format = 0, channels = 0, sampleRate = 0, bits = 0;
  let data: Buffer | null = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= buffer.length) {
      format = buffer.readUInt16LE(body); channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4); bits = buffer.readUInt16LE(body + 14);
      if (format === 0xfffe && size >= 26) format = buffer.readUInt16LE(body + 24); // WAVE_FORMAT_EXTENSIBLE sub-format
    } else if (id === 'data') {
      data = buffer.subarray(body, Math.min(buffer.length, body + size));
      break;
    }
    offset = body + size + (size % 2);
  }
  if (!data || !channels || !sampleRate || !((format === 1 && [8, 16, 24, 32].includes(bits)) || (format === 3 && bits === 32))) return null;
  const bytes = bits / 8, frames = Math.floor(data.length / (bytes * channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const at = (i * channels + c) * bytes;
      sum += format === 3 ? data.readFloatLE(at)
        : bits === 8 ? (data[at] - 128) / 128
        : bits === 16 ? data.readInt16LE(at) / 32768
        : bits === 24 ? data.readIntLE(at, 3) / 8388608
        : data.readInt32LE(at) / 2147483648;
    }
    samples[i] = sum / channels;
  }
  return { sampleRate, samples, duration: frames / sampleRate };
}

const HOP = 0.01; // 10 ms analysis frames

/** Voiced regions [start, end] in seconds from an adaptive energy threshold. */
export function voicedSegments(audio: PcmAudio): Array<[number, number]> {
  const hop = Math.max(1, Math.round(audio.sampleRate * HOP));
  const count = Math.floor(audio.samples.length / hop);
  if (count < 3) return [];
  const db = new Float64Array(count);
  for (let f = 0; f < count; f++) {
    let sum = 0;
    for (let i = f * hop; i < Math.min(audio.samples.length, (f + 2) * hop); i++) sum += audio.samples[i] * audio.samples[i];
    db[f] = 10 * Math.log10(sum / (2 * hop) + 1e-10);
  }
  const sorted = [...db].sort((a, b) => a - b);
  const floor = sorted[Math.floor(count * 0.1)], loud = sorted[Math.floor(count * 0.95)];
  if (loud - floor < 12) return loud > -45 ? [[0, audio.duration]] : []; // no clear silence: treat as one block
  const threshold = floor + 0.3 * (loud - floor);
  const voiced = Array.from(db, (v) => v > threshold);
  // Close short gaps (stop consonants inside a word), then drop clicks.
  fillRuns(voiced, false, 6);
  fillRuns(voiced, true, 4);
  const segments: Array<[number, number]> = [];
  for (let f = 0; f < count; f++) {
    if (voiced[f] && (f === 0 || !voiced[f - 1])) segments.push([f * HOP, f * HOP]);
    if (voiced[f]) segments[segments.length - 1][1] = Math.min(audio.duration, (f + 1) * HOP);
  }
  return segments;
}

/** Flips runs of `value` shorter than `max` frames that sit between opposite values. */
function fillRuns(flags: boolean[], value: boolean, max: number) {
  for (let i = 0; i < flags.length;) {
    if (flags[i] !== value) { i++; continue; }
    let j = i;
    while (j < flags.length && flags[j] === value) j++;
    if (j - i < max && i > 0 && j < flags.length) for (let k = i; k < j; k++) flags[k] = !value;
    i = j;
  }
}

const PAUSE_AFTER = /[.!?…,;:—–-]["'”)\]]*$/u;

/** Relative speaking time of a token. Numbers are read out as several syllables. */
export function tokenWeight(token: string) {
  const digits = (token.match(/\d/g) || []).length;
  if (digits) return Math.max(1, digits * 1.7);
  const letters = (token.match(/\p{L}/gu) || []).length;
  return letters ? 1 + Math.max(0, letters - 5) * 0.08 : 0.3;
}

/**
 * Estimates per-word timings for `text` spoken in `wav`. Falls back to an even spread over the
 * audio duration when the audio cannot be analysed.
 */
export function alignWords(text: string, wav: Buffer | null, fallbackSeconds: number): WordTime[] {
  const tokens = text.normalize('NFC').split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const audio = wav ? parseWav(wav) : null;
  const duration = audio?.duration || fallbackSeconds;
  const segments = audio ? voicedSegments(audio) : [];
  const spans: Array<[number, number]> = segments.length ? segments : [[0, duration]];
  const lengths = spans.map(([a, b]) => b - a);
  const voicedTotal = lengths.reduce((a, b) => a + b, 0) || duration;
  const weights = tokens.map(tokenWeight);
  const cum = [0];
  for (const w of weights) cum.push(cum[cum.length - 1] + w);
  const totalWeight = cum[cum.length - 1];
  const avgRate = voicedTotal / totalWeight;

  // Pauses in the audio
  const pauses: Array<{ s: number; voicedBefore: number; gap: number }> = [];
  let vb = 0;
  for (let s = 0; s < spans.length - 1; s++) {
    vb += lengths[s];
    pauses.push({ s, voicedBefore: vb, gap: spans[s + 1][0] - spans[s][1] });
  }

  // Anchors map punctuation in text to the corresponding real pauses in the audio.
  // Each punctuation boundary only binds to a pause if the timing is consistent with natural speaking rates.
  const anchors: Array<[number, number]> = [[0, 0]];
  let lastS = -1;
  let lastW = 0;
  let lastV = 0;

  for (let t = 1; t < tokens.length; t++) {
    if (!PAUSE_AFTER.test(tokens[t - 1])) continue;
    const w = cum[t];
    const expV = lastV + ((w - lastW) / (totalWeight - lastW)) * (voicedTotal - lastV);

    let best: { s: number; voicedBefore: number; gap: number } | null = null;
    let bestDiff = Infinity;
    for (const p of pauses) {
      if (p.s <= lastS || p.gap < 0.1) continue;
      const diff = Math.abs(p.voicedBefore - expV);
      if (diff > 1.2) continue;
      const segRate = (p.voicedBefore - lastV) / (w - lastW);
      if (segRate < avgRate * 0.5 || segRate > avgRate * 1.7) continue;
      if (diff < bestDiff) {
        bestDiff = diff;
        best = p;
      }
    }

    if (best) {
      anchors.push([w, best.voicedBefore]);
      lastS = best.s;
      lastW = w;
      lastV = best.voicedBefore;
    }
  }
  anchors.push([totalWeight, voicedTotal]);

  const toVoiced = (w: number) => {
    for (let a = 1; a < anchors.length; a++) {
      const [w0, v0] = anchors[a - 1], [w1, v1] = anchors[a];
      if (w <= w1 || a === anchors.length - 1) return w1 > w0 ? v0 + ((w - w0) / (w1 - w0)) * (v1 - v0) : v0;
    }
    return voicedTotal;
  };
  // preferNext: a position exactly on a segment boundary belongs to the next segment (word starts).
  const toReal = (v: number, preferNext: boolean) => {
    let acc = 0;
    for (let s = 0; s < spans.length; s++) {
      const end = acc + lengths[s];
      if (v < end || (v === end && !preferNext) || s === spans.length - 1) return Math.min(spans[s][1], spans[s][0] + Math.max(0, v - acc));
      acc = end;
    }
    return duration;
  };
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return tokens.map((token, i) => {
    const start = toReal(toVoiced(cum[i]), true);
    const end = Math.max(start + 0.04, toReal(toVoiced(cum[i + 1]), false));
    return { text: token.slice(0, 40), start: round(start), end: round(Math.min(duration, end)) };
  });
}
