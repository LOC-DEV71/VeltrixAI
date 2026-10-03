export interface GenerationSettings {
  language?: string;
  topic: string;
  platform: string;
  audience: string;
  tone: string;
  durationSeconds: number;
  sceneCount: number;
  structure: string;
  cta: string;
  creativeBrief: string;
  visualStyle: string;
}

// Only expose creator settings, never internal job payload fields or entitlement limits.
export function extractGenerationSettings(value: unknown): Partial<GenerationSettings> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const settings: Partial<GenerationSettings> = {};
  for (const key of ['language','topic', 'platform', 'audience', 'tone', 'structure', 'cta', 'creativeBrief', 'visualStyle'] as const) {
    if (typeof input[key] === 'string') settings[key] = input[key];
  }
  for (const key of ['durationSeconds', 'sceneCount'] as const) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key])) settings[key] = input[key];
  }
  return Object.keys(settings).length ? settings : undefined;
}
