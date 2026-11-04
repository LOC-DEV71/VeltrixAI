import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { forOwner } from '../services/EntitlementService';
import { PlanError } from '../services/PlanSchema';
import { getContentCapabilities } from '../services/ContentCapabilities';
import { createContentAiProvider, sceneJsonSchema, AiProviderError } from '../providers/AiProvider';
import { ensureLocalAi } from '../services/LocalAiControl';
import {
  IDEA_MAX_SEED_CHARS, IDEA_RESPONSE_SCHEMA, IDEA_SYSTEM_INSTRUCTION, IdeaError,
  buildIdeaPrompt, parseIdeas, releaseIdea, reserveIdea,
} from '../services/IdeaSuggestion';

const fail = (res: Response, status: number, code: string) => res.status(status).json({ success: false, error: { code } });

/** POST /api/contents/suggest  { seed?: string } -> { suggestions, usedToday, dailyLimit } */
export const suggestIdeas = async (req: Request, res: Response) => {
  const ownerId = (req as any).user._id as mongoose.Types.ObjectId;
  const seedInput = req.body?.seed ?? '';
  if (typeof seedInput !== 'string') return fail(res, 400, 'IDEA_INVALID_INPUT');
  const seed = seedInput.normalize('NFC').trim();
  if (seed.length > IDEA_MAX_SEED_CHARS) return fail(res, 400, 'IDEA_INVALID_INPUT');

  let caps;
  try { caps = getContentCapabilities(await forOwner(ownerId)); }
  catch (error) { return error instanceof PlanError ? fail(res, error.status, error.code) : fail(res, 503, 'PLAN_CONFIGURATION_UNAVAILABLE'); }
  if (!caps.enabled) return fail(res, 403, 'CONTENT_FEATURE_DISABLED');

  // The local LLM may be stopped while images are generated: start it again on demand.
  await ensureLocalAi();
  const provider = createContentAiProvider();
  const timeoutMs = provider.identity.kind === 'local' ? 120000 : 45000;
  let reservation;
  try { reservation = await reserveIdea(ownerId, timeoutMs + 15000); }
  catch (error) { return error instanceof IdeaError ? fail(res, error.status, error.code) : fail(res, 503, 'IDEA_UNAVAILABLE'); }

  let succeeded = false;
  try {
    const context = { durations: caps.durations, defaultDuration: caps.defaultDuration };
    const result = await provider.generate({
      instruction: IDEA_SYSTEM_INSTRUCTION,
      prompt: buildIdeaPrompt(seed, context),
      schema: sceneJsonSchema(IDEA_RESPONSE_SCHEMA),
      maxOutputTokens: 1500,
      timeoutMs,
      temperature: 0.9,
    });
    const suggestions = parseIdeas(result.text, context);
    succeeded = true;
    return res.json({ success: true, data: { suggestions, usedToday: reservation.used, dailyLimit: reservation.limit } });
  } catch (error: any) {
    if (error instanceof IdeaError) return fail(res, error.status, error.code);
    if (error instanceof AiProviderError) return fail(res, 503, 'IDEA_PROVIDER_UNAVAILABLE');
    if (error?.status === 429) return fail(res, 503, 'IDEA_PROVIDER_RATE_LIMITED');
    console.error('[POST /contents/suggest]', error?.message);
    return fail(res, 503, 'IDEA_PROVIDER_UNAVAILABLE');
  } finally {
    await releaseIdea(ownerId, reservation.day, succeeded).catch(() => undefined);
  }
};
