import { describe, it, expect, vi } from 'vitest';
import { Request, Response } from 'express';
import { csrfProtection, generateCsrfToken } from '../src/middlewares/csrfMiddleware';
import * as cryptoUtils from '../src/utils/crypto';

describe('CSRF Middleware', () => {
  it('should allow GET requests without token', () => {
    const req = { method: 'GET' } as Request;
    const res = {} as Response;
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    csrfProtection(req, res, next);
    expect(nextCalled).toBe(true);
  });

  it('should reject POST if tokens mismatch', () => {
    const req = {
      method: 'POST',
      cookies: { csrfToken: 'token1' },
      headers: { 'x-csrf-token': 'token2' }
    } as unknown as Request;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    } as unknown as Response;

    const next = vi.fn();

    csrfProtection(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'CSRF token mismatch' } });
  });

  it('should allow POST if tokens match', () => {
    const req = {
      method: 'POST',
      cookies: { csrfToken: 'token-match' },
      headers: { 'x-csrf-token': 'token-match' }
    } as unknown as Request;

    const res = { setHeader: vi.fn() } as unknown as Response;
    const next = vi.fn();

    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should reject POST without a CSRF cookie even if a header is supplied', () => {
    const req = { method: 'POST', headers: { 'x-csrf-token': 'old-token' } } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn();
    csrfProtection(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('should reuse an existing token on concurrent bootstrap reads', () => {
    const token = 'a'.repeat(64);
    for (let i = 0; i < 2; i++) {
      const req = { cookies: { csrfToken: token } } as unknown as Request;
      const res = { cookie: vi.fn(), setHeader: vi.fn(), json: vi.fn() } as unknown as Response;
      generateCsrfToken(req, res);
      expect(res.cookie).not.toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('x-csrf-token', token);
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { csrfToken: token } });
    }
  });

  it.each([undefined, 'invalid-token'])('should issue a usable token when the cookie is %s', (cookie) => {
    const req = { cookies: { csrfToken: cookie } } as unknown as Request;
    const res = { cookie: vi.fn(), setHeader: vi.fn(), json: vi.fn() } as unknown as Response;
    generateCsrfToken(req, res);
    const token = vi.mocked(res.cookie).mock.calls[0][1];
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(res.setHeader).toHaveBeenCalledWith('x-csrf-token', token);
    const next = vi.fn();
    csrfProtection({ method: 'POST', cookies: { csrfToken: token }, headers: { 'x-csrf-token': token } } as unknown as Request, res, next);
    expect(next).toHaveBeenCalled();
  });
});
