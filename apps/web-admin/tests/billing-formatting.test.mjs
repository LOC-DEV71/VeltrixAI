import {test} from 'node:test';
import assert from 'node:assert/strict';
import {billingNumber, billingDate} from '../src/billingFormatting.ts';

test('missing financial fields display a placeholder without inventing zero', () => {
  for (const value of [undefined, null, '', NaN, Infinity, 'bad', {}]) assert.equal(billingNumber(value), '—');
  assert.equal(billingNumber(0), '0');
  assert.equal(billingNumber(199000), '199.000');
  assert.equal(billingNumber('199000'), '199.000');
  assert.equal(billingNumber(-1000), '-1.000');
});

test('missing or invalid transaction dates do not crash rendering', () => {
  for (const value of [undefined, null, '', 'bad']) assert.equal(billingDate(value), '—');
  assert.match(billingDate('2026-10-02T00:00:00Z'), /2026/);
});
