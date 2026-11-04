// Start/stop the local Gemma server (services/ai) so it and the image model never share the 6 GB GPU.
// llama-server has no "unload model" call, so unloading means stopping the process; it is started
// again on demand before the next script-writing step. Only applies when AI_PROVIDER=local.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Job } from '../models/Job';

const aiDir = () => resolve(process.env.LOCAL_AI_DIR || resolve(__dirname, '../../../../services/ai'));
export const usesLocalAi = () => (process.env.AI_PROVIDER || 'gemini') === 'local';

async function healthy(timeoutMs = 1500) {
  try {
    const { url } = JSON.parse(readFileSync(resolve(aiDir(), '.runtime/connection.json'), 'utf8'));
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch { return false; }
}

const AI_TYPES = ['AI_CONTENT', 'AI_SPLIT', 'AI_PROMPT_GEN', 'AI_ANALYSIS'];

/** Stops the local LLM unless an AI job still needs it. */
export async function unloadLocalAi(): Promise<'STOPPED' | 'NOT_RUNNING' | 'BUSY' | 'NOT_LOCAL'> {
  if (!usesLocalAi() || process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT) return 'NOT_LOCAL';
  if (await Job.exists({ type: { $in: AI_TYPES }, status: { $in: ['QUEUED', 'PROCESSING'] } })) return 'BUSY';
  if (!await healthy()) return 'NOT_RUNNING';
  const result = spawnSync(process.execPath, [resolve(aiDir(), 'stop.cjs')], { cwd: aiDir(), windowsHide: true, encoding: 'utf8', timeout: 30_000 });
  return /LOCAL_AI_STOPPED/.test(result.stdout || '') ? 'STOPPED' : 'NOT_RUNNING';
}

let starting: Promise<boolean> | null = null;
/** Makes sure the local LLM is up (starts it detached if needed). Resolves false on timeout. */
/** `always`: start it even when AI_PROVIDER is not local (support chat always uses the local model). */
export async function ensureLocalAi(timeoutMs = 120_000, always = false): Promise<boolean> {
  if (process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT) return true; // tests never launch the real model
  if ((!always && !usesLocalAi()) || await healthy()) return true;
  if (!starting) {
    starting = (async () => {
      const child = spawn(process.execPath, [resolve(aiDir(), 'start.cjs')], { cwd: resolve(aiDir(), '../..'), detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        if (await healthy()) return true;
        await new Promise((r) => setTimeout(r, 1500));
      }
      return false;
    })().finally(() => { starting = null; });
  }
  return starting;
}
