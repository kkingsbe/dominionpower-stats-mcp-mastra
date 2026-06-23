import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadSession } from '../../src/dominion/session.js';
import { jwtExpiry } from '../../src/dominion/jwt.js';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('loadSession', () => {
  let dir: string;
  let sessionPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dom-session-'));
    sessionPath = join(dir, 'session.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when file does not exist', async () => {
    const result = await loadSession(sessionPath);
    expect(result).toBeNull();
  });

  it('migrates bogus token_expires (now+25) to JWT exp on load', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 1800;
    const token = makeJwt({ exp: futureExp, sub: 'u' });
    writeFileSync(sessionPath, JSON.stringify({
      token,
      refresh_token: 'rt',
      token_expires: 0,
      uuid: 'u',
      cookies: { gmid: 'g' },
      customer_number: '123',
      contract: null,
    }));
    const loaded = await loadSession(sessionPath);
    expect(loaded).not.toBeNull();
    expect(loaded!.token).toBe(token);
    expect(loaded!.token_expires).toBe(futureExp);
  });

  it('overwrites token_expires when stored value is earlier than JWT exp', async () => {
    const jwtExp = Math.floor(Date.now() / 1000) + 1800;
    const token = makeJwt({ exp: jwtExp });
    const storedExp = jwtExp - 100;
    writeFileSync(sessionPath, JSON.stringify({
      token,
      refresh_token: 'rt',
      token_expires: storedExp,
      uuid: 'u',
      cookies: {},
      customer_number: null,
      contract: null,
    }));
    const loaded = await loadSession(sessionPath);
    expect(loaded!.token_expires).toBe(jwtExp);
  });

  it('does not modify session when token is null', async () => {
    writeFileSync(sessionPath, JSON.stringify({
      token: null,
      refresh_token: null,
      token_expires: 0,
      uuid: null,
      cookies: {},
      customer_number: null,
      contract: null,
    }));
    const loaded = await loadSession(sessionPath);
    expect(loaded!.token_expires).toBe(0);
  });

  it('returns parsed store when token has no exp claim (uses fallback)', async () => {
    const token = makeJwt({ sub: 'no-exp' });
    writeFileSync(sessionPath, JSON.stringify({
      token,
      refresh_token: 'rt',
      token_expires: 0,
      uuid: 'u',
      cookies: {},
      customer_number: null,
      contract: null,
    }));
    const loaded = await loadSession(sessionPath);
    const expectedFallback = jwtExpiry(token);
    expect(loaded!.token_expires).toBe(expectedFallback);
    expect(loaded!.token_expires).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('returns null on invalid JSON', async () => {
    writeFileSync(sessionPath, 'not json {{');
    const loaded = await loadSession(sessionPath);
    expect(loaded).toBeNull();
  });
});