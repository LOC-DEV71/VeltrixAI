export class ContentInputError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}
import type { PlanSnapshot } from './PlanService';
export const structures = ['auto', 'aida', 'pas', 'storytelling'] as const;
export function getContentCapabilities(snapshot: PlanSnapshot) {
  const c = snapshot.config; const maximum = c.content.maxDurationSeconds;
  const durations = [...new Set([15,30,45,60,90,120,180,240,300,420,600,maximum,c.content.defaultDurationSeconds])].filter(v => v <= maximum).sort((a,b) => a-b);
  return { plan: snapshot.tier, revision: snapshot.revision, name: c.overview.name, durations, defaultDuration: c.content.defaultDurationSeconds, minScenes: Math.min(3,(c.scenes.enabled?c.scenes.maxScenes:1)), maxScenes: c.scenes.maxScenes, maxTokens: Math.min(65536,Math.ceil((c.content.maxOutputChars || 100000) / 2)+c.scenes.maxScenes*500), advanced: c.content.advanced, creativeDirection:c.content.creativeDirection, structures:c.content.modes, credits:c.credits.contentCost, enabled:c.content.enabled, maxInputChars:c.content.maxInputChars, maxOutputChars:c.content.maxOutputChars, languages:c.content.languages, scenesEnabled:c.scenes.enabled, regenerate:c.regeneration.enabled };
}
export function resolveContentOptions(input: Record<string, unknown>, snapshot: PlanSnapshot, pinnedSpeechRate?: number) {
  const caps = getContentCapabilities(snapshot);
  const durationSeconds = input.durationSeconds ?? caps.defaultDuration;
  const sceneCount = input.sceneCount ?? 0;
  const language=input.language ?? caps.languages[0];
  if(typeof language !== 'string' || !caps.languages.includes(language)) throw new ContentInputError('CONTENT_FEATURE_DISABLED','Unsupported language',403);
  const speechUnitsPerSecond = pinnedSpeechRate ?? (language === 'vi-VN' ? 4 : 2.5);
  const structure = input.structure ?? 'auto';
  const text = (key: string, max: number|null) => {
    const value = input[key] ?? '';
    if (typeof value !== 'string' || [...value].length > (max ?? Infinity)) throw new ContentInputError('INVALID_CONTENT_OPTIONS', `${key} vượt giới hạn hoặc không hợp lệ.`);
    return value.trim();
  };
  const cta = text('cta',caps.maxInputChars), creativeBrief = text('creativeBrief',caps.maxInputChars), visualStyle = text('visualStyle',caps.maxInputChars);
  if ((!caps.advanced && (sceneCount !== 0 || structure !== 'auto' || cta)) || (!caps.creativeDirection && (creativeBrief || visualStyle))) {
    throw new ContentInputError('CONTENT_PLAN_REQUIRED', 'Cấu hình nâng cao này cần gói Plus hoặc Pro phù hợp.', 403);
  }
  if (typeof durationSeconds !== 'number' || !caps.durations.includes(durationSeconds)) throw new ContentInputError('INVALID_CONTENT_OPTIONS', 'Thời lượng không thuộc giới hạn của gói hiện tại.');
  if(typeof sceneCount==='number' && sceneCount>caps.maxScenes)throw new ContentInputError('SCENE_LIMIT_EXCEEDED','Scene limit exceeded',403);
  if (typeof sceneCount !== 'number' || !Number.isInteger(sceneCount) || (sceneCount !== 0 && (sceneCount < caps.minScenes || sceneCount > caps.maxScenes || sceneCount * 3 > durationSeconds))) throw new ContentInputError('INVALID_CONTENT_OPTIONS', 'Số cảnh không phù hợp với gói hoặc thời lượng (ít nhất 3 giây/cảnh).');
  if (typeof structure !== 'string' || !caps.structures.includes(structure)) throw new ContentInputError('INVALID_CONTENT_OPTIONS', 'Cấu trúc kịch bản không hợp lệ.');
  const minScenes = sceneCount || caps.minScenes;
  const maxScenes = snapshot.config.scenes.enabled ? sceneCount || Math.min(caps.maxScenes, Math.max(caps.minScenes, Math.floor(durationSeconds / 5))) : 1;
  if(!snapshot.config.scenes.enabled && sceneCount>1)throw new ContentInputError('CONTENT_FEATURE_DISABLED','Scene splitting is disabled',403);
  const targetWords=Math.round(durationSeconds * speechUnitsPerSecond);
  return { maxOutputChars:caps.maxOutputChars,splitEnabled:snapshot.config.scenes.enabled,imageEnabled:snapshot.config.prompts.imageEnabled,videoEnabled:snapshot.config.prompts.videoEnabled,advanced:caps.advanced,creativeDirection:caps.creativeDirection,language, plan: caps.plan, durationSeconds, sceneCount, structure, cta, creativeBrief, visualStyle, minScenes, maxScenes, speechUnitsPerSecond, targetWords, maxTokens: caps.maxTokens };
}
export type ContentOptions = ReturnType<typeof resolveContentOptions>;
