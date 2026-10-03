import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForContentJob } from '../src/utils/pollContentJob.ts';

test('polls sequentially and stops at COMPLETED', async () => {
  const controller = new AbortController();
  const states = ['QUEUED', 'PROCESSING', 'COMPLETED'];
  let active = 0;
  const result = await waitForContentJob(async () => {
    assert.equal(++active, 1);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return { status: states.shift() };
  }, controller.signal, { intervalMs: 0 });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(states.length, 0);
});

test('returns FAILED reason and CANCELLED immediately without more polling', async () => {
  for (const status of ['FAILED', 'CANCELLED']) {
    let calls = 0;
    const result = await waitForContentJob(async () => {
      calls++;
      return { status, failedReason: 'INVALID_GEMINI_SCENES' };
    }, new AbortController().signal);
    assert.equal(calls, 1);
    assert.equal(result.failedReason, 'INVALID_GEMINI_SCENES');
  }
});

test('abort during a request discards its response', async () => {
  const controller = new AbortController();
  await assert.rejects(waitForContentJob(async () => {
    controller.abort();
    return { status: 'COMPLETED' };
  }, controller.signal), /POLL_ABORTED/);
});

test('abort during delay stops polling', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = waitForContentJob(async () => {
    calls++;
    setTimeout(() => controller.abort(), 1);
    return { status: 'PROCESSING' };
  }, controller.signal, { intervalMs: 100 });
  await assert.rejects(pending, /POLL_ABORTED/);
  assert.equal(calls, 1);
});

test('timeout and network errors stop polling', async () => {
  await assert.rejects(waitForContentJob(async () => ({ status: 'PROCESSING' }), new AbortController().signal,
    { intervalMs: 1, maxWaitMs: 5 }), /POLL_TIMEOUT/);
  let calls = 0;
  await assert.rejects(waitForContentJob(async () => {
    calls++;
    throw new Error('Network failed');
  }, new AbortController().signal), /Network failed/);
  assert.equal(calls, 1);
});
