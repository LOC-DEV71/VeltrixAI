// In-memory text the LLM is producing right now, for the "Agent đang nghĩ" panel.
// Content jobs and storyboard planning run inside the API process, so the details endpoint (same
// process) can read it. Display only: never persisted, bounded in size, dropped after 15 minutes.
const MAX_CHARS = 60_000;
const TTL_MS = 15 * 60_000;

interface Entry { text: string; phase: string; updatedAt: number; done: boolean }
const entries = new Map<string, Entry>();

function sweep(now = Date.now()) {
  for (const [key, entry] of entries) if (now - entry.updatedAt > TTL_MS) entries.delete(key);
}

/** Starts (or restarts) a stream for a key, e.g. a content job id or `storyboard:<projectId>`. */
export function startLive(key: string, phase: string) {
  sweep();
  entries.set(key, { text: '', phase, updatedAt: Date.now(), done: false });
}

export function appendLive(key: string, chunk: string) {
  const entry = entries.get(key);
  if (!entry) return;
  entry.text = (entry.text + chunk).slice(-MAX_CHARS);
  entry.updatedAt = Date.now();
}

export function finishLive(key: string) {
  const entry = entries.get(key);
  if (entry) { entry.done = true; entry.updatedAt = Date.now(); }
}

export function readLive(key: string): Entry | null {
  return entries.get(key) ?? null;
}

/**
 * Completed objects of a streamed JSON array, read while it is still being written.
 * Tolerates the unfinished tail: only objects whose closing brace has arrived are returned.
 */
export function completedObjects(text: string): any[] {
  const out: any[] = [];
  const start = text.indexOf('[');
  if (start < 0) return out;
  let depth = 0, inString = false, escaped = false, objectStart = -1;
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') { if (depth === 0) objectStart = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && objectStart >= 0) {
        try { out.push(JSON.parse(text.slice(objectStart, i + 1))); } catch { /* skip malformed */ }
        objectStart = -1;
      }
    }
  }
  return out;
}
