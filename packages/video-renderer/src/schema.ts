// Storyboard schema shared by the render script (manifest validation) and the composition.
// Self-contained on purpose: render-job.mjs imports this file directly with Node type stripping.
import { z } from 'zod';

/** Visual themes (see theme.ts). Must match apps/backend-api/src/services/VideoTheme.ts. */
export const THEME_IDS = ['cosmic', 'documentary', 'finance', 'tech', 'nature', 'pop'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const SCENE_TYPES = ['hook', 'icon_card', 'stat', 'list', 'compare', 'scale', 'timeline', 'quote', 'cta'] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

const text = (max: number) => z.string().max(max);
const icon = z.string().max(40).default('sparkles');

export const statDataSchema = z.object({
  value: z.number().finite().min(0).max(1e30),
  unit: text(24).default(''),
  label: text(60).default(''),
  percent: z.number().min(0).max(100).optional(),
  decimals: z.number().int().min(0).max(2).default(0),
});
export const listDataSchema = z.object({
  items: z.array(z.object({ text: text(48).min(1), icon })).min(1).max(3),
});
const side = z.object({ label: text(32).min(1), value: text(24).default(''), icon });
export const compareDataSchema = z.object({ left: side, right: side, winner: z.enum(['left', 'right', 'none']).default('none') });
export const scaleDataSchema = z.object({
  levels: z.array(text(32).min(1)).min(3).max(7), // lowest first
  active: z.number().int().min(0),
}).refine((d) => d.active < d.levels.length, { message: 'active must index levels', path: ['active'] });
export const timelineDataSchema = z.object({
  events: z.array(z.object({ time: text(16).min(1), text: text(48).min(1) })).min(2).max(4),
});
export const quoteDataSchema = z.object({ quote: text(180).min(1), author: text(48).default('') });
export const ctaDataSchema = z.object({ action: z.enum(['subscribe', 'like', 'follow']).default('subscribe') });
const emptyData = z.object({}).passthrough();

export const DATA_SCHEMAS = {
  hook: emptyData, icon_card: emptyData, stat: statDataSchema, list: listDataSchema, compare: compareDataSchema,
  scale: scaleDataSchema, timeline: timelineDataSchema, quote: quoteDataSchema, cta: ctaDataSchema,
} as const;

export type StatData = z.infer<typeof statDataSchema>;
export type ListData = z.infer<typeof listDataSchema>;
export type CompareData = z.infer<typeof compareDataSchema>;
export type ScaleData = z.infer<typeof scaleDataSchema>;
export type TimelineData = z.infer<typeof timelineDataSchema>;
export type QuoteData = z.infer<typeof quoteDataSchema>;
export type CtaData = z.infer<typeof ctaDataSchema>;

/** Spoken word timing in seconds from the start of the scene's audio. */
export const wordSchema = z.object({ text: z.string().min(1).max(40), start: z.number().min(0), end: z.number().min(0) });
export type WordTiming = z.infer<typeof wordSchema>;

const baseScene = {
  voice: z.string().min(1).max(4000),
  title: text(90).default(''),
  subtitle: text(160).default(''),
  icon,
  emphasis: z.array(text(30)).max(4).default([]),
  words: z.array(wordSchema).max(1000).default([]),
  /** English text-to-image prompt from the script (used as is by packages/image-gen). */
  imagePrompt: z.string().max(1200).optional(),
  /** Camera move described by the script; picks the background motion (dolly, truck, tilt, orbit). */
  videoPrompt: z.string().max(1200).optional(),
};

type SceneBase = { voice: string; title: string; subtitle: string; icon: string; emphasis: string[]; words: WordTiming[]; imagePrompt?: string; videoPrompt?: string };
export type StoryboardScene = SceneBase & (
  | { type: 'hook' | 'icon_card'; data: Record<string, unknown> }
  | { type: 'stat'; data: StatData } | { type: 'list'; data: ListData } | { type: 'compare'; data: CompareData }
  | { type: 'scale'; data: ScaleData } | { type: 'timeline'; data: TimelineData } | { type: 'quote'; data: QuoteData }
  | { type: 'cta'; data: CtaData }
);

/** One storyboard scene, validated per type. */
export const storyboardSceneSchema = z.discriminatedUnion('type', SCENE_TYPES.map((type) =>
  z.object({ type: z.literal(type), ...baseScene, data: DATA_SCHEMAS[type] }),
) as unknown as [z.ZodObject<any>, ...z.ZodObject<any>[]]) as unknown as z.ZodType<StoryboardScene>;

/** Sequence rules from docs/VIDEO_STYLE.md. Returns human-readable problems (empty when valid). */
export function sequenceProblems(types: string[]): string[] {
  const problems: string[] = [];
  if (!types.length) return ['storyboard is empty'];
  if (types[0] !== 'hook') problems.push('scene 1 must be type "hook"');
  if (types.length > 1 && types[types.length - 1] !== 'cta') problems.push(`scene ${types.length} (last) must be type "cta"`);
  for (let i = 1; i < types.length; i++) if (types[i] === types[i - 1]) problems.push(`scenes ${i} and ${i + 1} must not both be "${types[i]}"`);
  return problems;
}

export const backgroundSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('video'), file: z.string().min(1).max(120) }),
  // real: an archival photo of a real subject (Wikimedia Commons). Shown sharp, with its credit on screen.
  z.object({ kind: z.literal('image'), file: z.string().min(1).max(120), real: z.boolean().optional(), credit: z.string().max(160).optional() }),
  z.object({ kind: z.literal('gradient') }),
]);

/** Manifest written by the backend video worker. Files are names inside assetsDir. */
export const manifestSchema = z.object({
  assetsDir: z.string().min(1),
  outputPath: z.string().min(1),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30)]),
  width: z.number().int().min(320).max(2160),
  height: z.number().int().min(320).max(3840),
  music: z.boolean().default(true),
  theme: z.enum(THEME_IDS).default('cosmic'),
  /** Picks the layout variant inside the theme (palette, alignment, pattern phase). */
  seed: z.number().int().min(0).max(2 ** 31).default(1),
  scenes: z.array(z.object({
    scene: storyboardSceneSchema,
    audio: z.string().min(1).max(120).optional(),
    audioSeconds: z.number().min(0.2).max(600),
    background: backgroundSchema.default({ kind: 'gradient' }),
  })).min(1).max(60),
}).superRefine((m, ctx) => {
  for (const problem of sequenceProblems(m.scenes.map((s) => s.scene.type as string))) ctx.addIssue({ code: 'custom', message: problem, path: ['scenes'] });
});
export type Manifest = z.infer<typeof manifestSchema>;

// ---- Composition props (what the React tree receives) ----

export type ResolvedBackground = { kind: 'video' | 'image'; src: string; blurred: boolean; real?: boolean; credit?: string } | { kind: 'gradient' };

export type RenderScene = {
  scene: StoryboardScene;
  audioSrc: string | null;
  /** Scene length = audio + 6 frames of padding. */
  durationInFrames: number;
  background: ResolvedBackground;
};

export type VideoProps = {
  fps: number;
  width: number;
  height: number;
  musicSrc: string | null;
  sfx: boolean;
  theme?: ThemeId;
  seed?: number;
  scenes: RenderScene[];
};

export const PAD_FRAMES = 6;
export const sceneFrames = (audioSeconds: number, fps: number) => Math.ceil(audioSeconds * fps) + PAD_FRAMES;
