const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { completedObjects, startLive, appendLive, finishLive, readLive } = require('../dist/services/LiveText');
const { LocalContentProvider } = require('../dist/providers/AiProvider');

afterEach(() => mock.restoreAll());

test('reads finished scene objects out of a JSON array that is still streaming', () => {
  const partial = '[{"title":"Cảnh 1","narration":"Có dấu ngoặc } trong chuỗi"},{"title":"Cảnh 2","data":{"a":1}},{"title":"Cả';
  assert.deepEqual(completedObjects(partial).map((o) => o.title), ['Cảnh 1', 'Cảnh 2']);
  assert.deepEqual(completedObjects('no array yet'), []);
  assert.deepEqual(completedObjects('[{"title":"x\\"y"}]').map((o) => o.title), ['x"y']);
});

test('live buffer appends chunks and keeps the phase', () => {
  startLive('job-1', 'script');
  appendLive('job-1', '[{"ti');
  appendLive('job-1', 'tle":"A"}');
  assert.equal(readLive('job-1').text, '[{"title":"A"}');
  assert.equal(readLive('job-1').done, false);
  finishLive('job-1');
  assert.equal(readLive('job-1').done, true);
  appendLive('missing', 'x'); // unknown keys are ignored
  assert.equal(readLive('missing'), null);
});

test('local provider streams tokens over SSE and returns the full text', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"[{\\"ti"}}]}',
    'data: {"choices":[{"delta":{"content":"tle\\":\\"A\\"}]"}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":7}}',
    'data: [DONE]',
    '',
  ].join('\n');
  mock.method(globalThis, 'fetch', async (url, init) => {
    const u = String(url);
    if (u.endsWith('/apply-template')) return Response.json({ prompt: 'p' });
    if (u.endsWith('/tokenize')) return Response.json({ tokens: [1, 2, 3] });
    assert.equal(JSON.parse(init.body).stream, true);
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });
  const provider = new LocalContentProvider({ kind: 'local', model: 'm', url: 'http://127.0.0.1:1', token: 'x'.repeat(40), apiKey: '', contextTokens: 8192, maxOutputTokens: 4096 });
  const chunks = [];
  const result = await provider.generate({ instruction: 'i', prompt: 'p', schema: { type: 'array' }, maxOutputTokens: 512, timeoutMs: 5000, onToken: (c) => chunks.push(c) });
  assert.equal(result.text, '[{"title":"A"}]');
  assert.deepEqual(chunks, ['[{"ti', 'tle":"A"}]']);
  assert.equal(result.usage.outputTokens, 7);
});
