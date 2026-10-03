// Vietnamese units are whitespace-separated syllables, not compound words.
// Planning baseline: four whitespace-separated spoken units per second; WAV duration remains authoritative.
export function narrationUnits(text: string): number {
  return text.trim().split(/\s+/u).filter(unit => /[\p{L}\p{N}]/u.test(unit)).length;
}
export function estimateNarrationSeconds(text: string, unitsPerSecond = 4): number {
  return Math.max(0.1, Math.round(narrationUnits(text) / unitsPerSecond * 10) / 10);
}
