import { describe, it, expect } from 'vitest';
import { decodeJwtPayload, jwtExpiry } from '../../src/dominion/jwt.js';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

describe('decodeJwtPayload', () => {
  it('decodes a valid JWT payload', () => {
    const token = makeJwt({ exp: 1234567890, sub: 'user-1' });
    expect(decodeJwtPayload(token)).toEqual({ exp: 1234567890, sub: 'user-1' });
  });

  it('returns null for non-three-part token', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('only.two')).toBeNull();
    expect(decodeJwtPayload('')).toBeNull();
  });

  it('returns null for malformed base64 payload', () => {
    expect(decodeJwtPayload('header.!!!not-base64!!!.signature')).toBeNull();
  });

  it('returns null for non-JSON payload', () => {
    const body = Buffer.from('not-json-at-all').toString('base64url');
    expect(decodeJwtPayload(`header.${body}.signature`)).toBeNull();
  });
});

describe('jwtExpiry', () => {
  it('returns the exp claim when present and numeric', () => {
    const token = makeJwt({ exp: 1234567890 });
    expect(jwtExpiry(token)).toBe(1234567890);
  });

  it('returns fallback when exp is missing', () => {
    const token = makeJwt({ sub: 'user-1' });
    const before = Math.floor(Date.now() / 1000);
    const result = jwtExpiry(token, 30);
    const after = Math.floor(Date.now() / 1000);
    expect(result).toBeGreaterThanOrEqual(before + 30);
    expect(result).toBeLessThanOrEqual(after + 30);
  });

  it('returns fallback when exp is non-numeric', () => {
    const token = makeJwt({ exp: 'soon' });
    const before = Math.floor(Date.now() / 1000);
    const result = jwtExpiry(token, 30);
    expect(result).toBeGreaterThanOrEqual(before + 30);
  });

  it('returns 0 for null token', () => {
    expect(jwtExpiry(null)).toBe(0);
    expect(jwtExpiry(undefined)).toBe(0);
    expect(jwtExpiry('')).toBe(0);
  });

  it('returns fallbackSeconds default of 30', () => {
    const token = makeJwt({});
    const before = Math.floor(Date.now() / 1000);
    const result = jwtExpiry(token);
    expect(result - before).toBeGreaterThanOrEqual(29);
    expect(result - before).toBeLessThanOrEqual(31);
  });
});
