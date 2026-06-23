import { describe, it, expect, vi } from 'vitest';
import {
  isAuthenticated,
  refreshAccessTokenIfNeeded,
} from '../../src/dominion/auth.js';
import { DominionEnergyAuthError } from '../../src/dominion/types.js';
import type { SessionStore } from '../../src/dominion/session.js';

function makeJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `${header}.${body}.sig`;
}

function makeStore(overrides: Partial<SessionStore>): SessionStore {
  return {
    token: null,
    refresh_token: null,
    token_expires: 0,
    uuid: null,
    cookies: {},
    customer_number: null,
    contract: null,
    ...overrides,
  };
}

describe('isAuthenticated', () => {
  it('returns true when token_expires is in the future', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const store = makeStore({ token: 't', uuid: 'u', token_expires: future });
    expect(isAuthenticated(store)).toBe(true);
  });

  it('returns true when token expired but refresh_token present', () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const store = makeStore({ token: 't', uuid: 'u', token_expires: past, refresh_token: 'rt' });
    expect(isAuthenticated(store)).toBe(true);
  });

  it('returns false when no token and no refresh_token', () => {
    const store = makeStore({ token: null, refresh_token: null });
    expect(isAuthenticated(store)).toBe(false);
  });

  it('returns false when token present but no uuid', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const store = makeStore({ token: 't', uuid: null, token_expires: future });
    expect(isAuthenticated(store)).toBe(false);
  });
});

describe('refreshAccessTokenIfNeeded', () => {
  it('skips refresh when token_expires is far in the future', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const store = makeStore({ token: 't', refresh_token: 'rt', uuid: 'u', token_expires: future });
    const fetchFn = vi.fn();
    const log = vi.fn();
    await refreshAccessTokenIfNeeded(fetchFn, store, log);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it('skips refresh when refresh_token is missing', async () => {
    const store = makeStore({ token: 't', refresh_token: null, uuid: 'u', token_expires: 0 });
    const fetchFn = vi.fn();
    const log = vi.fn();
    await refreshAccessTokenIfNeeded(fetchFn, store, log);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('no refresh_token'));
  });

  it('logs diagnostic detail and throws FullAuthRequiredError on 401', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const store = makeStore({ token: 't', refresh_token: 'rt', uuid: 'u', token_expires: past });
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: () => Promise.resolve('{"error":"invalid_grant"}'),
    });
    const log = vi.fn();
    await expect(refreshAccessTokenIfNeeded(fetchFn, store, log)).rejects.toThrow(
      /Token refresh rejected \(401\):/,
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining('401'));
  });

  it('logs diagnostic detail on network error', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const store = makeStore({ token: 't', refresh_token: 'rt', uuid: 'u', token_expires: past });
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const log = vi.fn();
    await expect(refreshAccessTokenIfNeeded(fetchFn, store, log)).rejects.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ECONNRESET'));
  });
});

describe('auth errors', () => {
  it('DominionEnergyAuthError is constructable', () => {
    const err = new DominionEnergyAuthError('test');
    expect(err.message).toBe('test');
    expect(err.name).toBe('DominionEnergyAuthError');
  });
});
