export interface Caption { text: string; startFrame: number; endFrame: number }

const MAX_WORDS = 7;

/** Splits narration into short on-screen chunks: sentences first, then commas, then every MAX_WORDS words. */
export function splitCaptionText(narration: string): string[] {
  const text = narration.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const chunks: string[] = [];
  for (const sentence of text.split(/(?<=[.!?…])\s+/u)) {
    for (const clause of sentence.split(/(?<=[,;:])\s+/u)) {
      const words = clause.split(' ').filter(Boolean);
      // Balanced split: 10 words -> 5 + 5 rather than 7 + 3.
      const parts = Math.ceil(words.length / MAX_WORDS);
      for (let p = 0, i = 0; p < parts; p++) {
        const size = Math.ceil((words.length - i) / (parts - p));
        chunks.push(words.slice(i, i + size).join(' '));
        i += size;
      }
    }
  }
  return chunks;
}

/**
 * Times chunks across the scene in proportion to their length (a proxy for speaking time).
 * Captions cover [0, durationInFrames) with no gaps or overlaps.
 */
export function buildCaptions(narration: string, durationInFrames: number): Caption[] {
  const chunks = splitCaptionText(narration);
  if (!chunks.length || durationInFrames < 1) return [];
  const weights = chunks.map((c) => Math.max(1, [...c].length));
  const total = weights.reduce((a, b) => a + b, 0);
  const captions: Caption[] = [];
  let start = 0, cumulative = 0;
  chunks.forEach((text, index) => {
    cumulative += weights[index];
    const end = index === chunks.length - 1 ? durationInFrames : Math.max(start + 1, Math.round((cumulative / total) * durationInFrames));
    captions.push({ text, startFrame: start, endFrame: Math.min(end, durationInFrames) });
    start = Math.min(end, durationInFrames);
  });
  return captions.filter((c) => c.endFrame > c.startFrame);
}
