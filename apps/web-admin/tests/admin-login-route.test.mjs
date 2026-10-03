import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminLoginDestination, adminRoutes } from '../src/adminRoutes.ts';

test('direct /login visit with a session always redirects to a defined route', () => {
  for (const missing of [undefined, null, '', '   ', false, 0, {}, { pathname: '/users' }]) {
    assert.equal(adminLoginDestination(missing), '/');
  }
});

test('login returns to every known admin route and preserves search and hash', () => {
  for (const route of Object.values(adminRoutes)) {
    assert.equal(adminLoginDestination(route), route);
    const target = `${route}?page=2&limit=10#details`;
    assert.equal(adminLoginDestination(target), target);
  }
  assert.equal(adminLoginDestination('/voices/'), '/voices/');
});

test('unknown, login-loop, relative and external destinations fall back to overview', () => {
  for (const invalid of ['/login', '/login?next=/users', '/does-not-exist', '/users/nested', 'users', '?page=2', '#details', '//example.com', 'https://example.com/users']) {
    assert.equal(adminLoginDestination(invalid), '/');
  }
});
