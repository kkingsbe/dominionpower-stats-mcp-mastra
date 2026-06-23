# Dominion MCP Session Token Expiry Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `dominionpower-mcp` from triggering the Playwright-based full TFA auth flow every time the docker container restarts, by replacing the bogus `token_expires = now + 25` bookkeeping with the JWT's actual `exp` claim, and add diagnostic logging so genuine refresh failures are visible.

**Architecture:** Add a small JWT-parsing utility (`src/dominion/jwt.ts`). Use it in `session.ts` (load-time migration) and `dominion-service.ts` (replace hardcoded `+25`). Enrich error messages in `gigya.ts`/`auth.ts` with refresh response details. Add vitest unit tests.

**Tech Stack:** TypeScript, Node 22, Vitest, Mastra MCP, Playwright (existing — no new runtime deps).

---

## File Structure

### New files
- `dominionpower-mcp/src/dominion/jwt.ts` — `decodeJwtPayload`, `jwtExpiry` utilities
- `dominionpower-mcp/test/dominion/jwt.test.ts` — JWT parser unit tests
- `dominionpower-mcp/test/dominion/auth.test.ts` — `isAuthenticated` + `refreshAccessTokenIfNeeded` tests
- `dominionpower-mcp/test/dominion/session.test.ts` — session-load migration test
- `dominionpower-mcp/vitest.config.ts` — Vitest config

### Modified files
- `dominionpower-mcp/src/dominion/session.ts` — load-time JWT `exp` recomputation
- `dominionpower-mcp/src/dominion/auth.ts` — diagnostic logging on refresh failure
- `dominionpower-mcp/src/dominion/endpoints/gigya.ts` — body excerpt in refresh error
- `dominionpower-mcp/src/mastra/lib/dominion-service.ts` — replace `+25` with `jwtExpiry(token)`
- `dominionpower-mcp/package.json` — add `"test"` script

---

## Task 1: Add JWT parsing utility

**Files:**
- Create: `dominionpower-mcp/src/dominion/jwt.ts`
- Test: `dominionpower-mcp/test/dominion/jwt.test.ts`
- Create: `dominionpower-mcp/vitest.config.ts`
- Modify: `dominionpower-mcp/package.json`

- [ ] **Step 1: Create vitest config**

Create `dominionpower-mcp/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Add test script to package.json**

In `dominionpower-mcp/package.json`, in the `scripts` block, add the `test` entry so it reads:

```json
"scripts": {
  "dev": "mastra dev",
  "build": "mastra build --studio",
  "start": "mastra start",
  "typecheck": "tsc --noEmit",
  "test": "vitest run"
},
```

- [ ] **Step 3: Install vitest in dominionpower-mcp**

Run from the subproject directory:

```bash
cd dominionpower-mcp && npm install --save-dev vitest@^2.1.0
```

Expected: vitest is added to `devDependencies`. (The root project already pins `vitest@^2.1.0` per its `package.json`.)

- [ ] **Step 4: Write failing tests for JWT parser**

Create `dominionpower-mcp/test/dominion/jwt.test.ts`:

```ts
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
```

- [ ] **Step 5: Run the test to verify it fails**

Run from `dominionpower-mcp/`:

```bash
cd dominionpower-mcp && npx vitest run test/dominion/jwt.test.ts
```

Expected: FAIL — `Cannot find module '../../src/dominion/jwt.js'`.

- [ ] **Step 6: Implement jwt.ts**

Create `dominionpower-mcp/src/dominion/jwt.ts`:

```ts
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const base64 = padded + '='.repeat(padLen);
    const json = Buffer.from(base64, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

export function jwtExpiry(
  token: string | null | undefined,
  fallbackSeconds: number = 30,
): number {
  if (!token) return 0;
  const claims = decodeJwtPayload(token);
  if (claims && typeof claims.exp === 'number') return claims.exp;
  return Math.floor(Date.now() / 1000) + fallbackSeconds;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run from `dominionpower-mcp/`:

```bash
cd dominionpower-mcp && npx vitest run test/dominion/jwt.test.ts
```

Expected: PASS — all 9 tests pass.

- [ ] **Step 8: Commit**

```bash
git add dominionpower-mcp/src/dominion/jwt.ts dominionpower-mcp/test/dominion/jwt.test.ts dominionpower-mcp/vitest.config.ts dominionpower-mcp/package.json dominionpower-mcp/package-lock.json
git commit -m "feat(dominion-mcp): add JWT exp parser with tests"
```

---

## Task 2: Add session-load migration to recompute token_expires from JWT

**Files:**
- Modify: `dominionpower-mcp/src/dominion/session.ts`
- Test: `dominionpower-mcp/test/dominion/session.test.ts`

- [ ] **Step 1: Write failing tests for session load migration**

Create `dominionpower-mcp/test/dominion/session.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
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

  it('does not overwrite token_expires when it is already past JWT exp', async () => {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `dominionpower-mcp/`:

```bash
cd dominionpower-mcp && npx vitest run test/dominion/session.test.ts
```

Expected: FAIL — `token_expires` not migrated; the loaded value still equals the stored `0`.

- [ ] **Step 3: Modify loadSession to migrate token_expires**

Replace `dominionpower-mcp/src/dominion/session.ts` with:

```ts
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import type { SessionData } from './types.js';
import { jwtExpiry } from './jwt.js';

export type SessionStore = SessionData;

export async function loadSession(filePath: string): Promise<SessionStore | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let store: SessionStore;
  try {
    store = JSON.parse(raw) as SessionStore;
  } catch {
    return null;
  }
  if (store.token) {
    const jwtExp = jwtExpiry(store.token);
    if (store.token_expires < jwtExp) {
      store.token_expires = jwtExp;
    }
  }
  return store;
}

export async function saveSession(filePath: string, store: SessionStore): Promise<void> {
  const json = JSON.stringify(store, null, 2);
  let current: string | undefined;
  try {
    current = await readFile(filePath, 'utf8');
  } catch {
    // file doesn't exist yet — proceed to write
  }
  if (current === json) return;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, json, 'utf8');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `dominionpower-mcp/`:

```bash
cd dominionpower-mcp && npx vitest run test/dominion/session.test.ts
```

Expected: PASS — all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add dominionpower-mcp/src/dominion/session.ts dominionpower-mcp/test/dominion/session.test.ts
git commit -m "feat(dominion-mcp): migrate bogus token_expires to JWT exp on load"
```

---

## Task 3: Replace `+25` in dominion-service.ts with `jwtExpiry(token)`

**Files:**
- Modify: `dominionpower-mcp/src/mastra/lib/dominion-service.ts`

- [ ] **Step 1: Add jwt import**

In `dominionpower-mcp/src/mastra/lib/dominion-service.ts`, add to the imports near the top:

```ts
import { jwtExpiry } from '../../dominion/jwt.js';
```

Place it alphabetically with the other `../../dominion/` imports.

- [ ] **Step 2: Replace line 159**

Find line 159 in `dominionpower-mcp/src/mastra/lib/dominion-service.ts`:

```ts
        this.store.token_expires = Math.floor(Date.now() / 1000) + 25;
```

Replace with:

```ts
        this.store.token_expires = jwtExpiry(this.store.token);
```

- [ ] **Step 3: Replace line 199**

Find line 199 in `dominionpower-mcp/src/mastra/lib/dominion-service.ts`:

```ts
            this.store.token_expires = Math.floor(Date.now() / 1000) + 25;
```

Replace with:

```ts
            this.store.token_expires = jwtExpiry(this.store.token);
```

- [ ] **Step 4: Verify no remaining `+ 25` patterns**

Run from repo root:

```bash
grep -rn "token_expires = Math.floor(Date.now()" dominionpower-mcp/src
```

Expected: no matches.

- [ ] **Step 5: Typecheck**

Run from `dominionpower-mcp/`:

```bash
cd dominionpower-mcp && npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add dominionpower-mcp/src/mastra/lib/dominion-service.ts
git commit -m "fix(dominion-mcp): use JWT exp for token_expires instead of now+25"
```

---

## Task 4: Enrich refresh error with response body excerpt

**Files:**
- Modify: `dominionpower-mcp/src/dominion/endpoints/gigya.ts`

- [ ] **Step 1: Update refreshAccessToken to include body in error**

In `dominionpower-mcp/src/dominion/endpoints/gigya.ts`, replace the entire `refreshAccessToken` function (currently lines 11-45) with:

```ts
export async function refreshAccessToken(
  fetchFn: typeof fetch,
  session: SessionData,
): Promise<TokenRefreshResult> {
  const url = `${AUTH_API_BASE_URL}/login/auth/refresh`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.token ?? ''}`,
    'Content-Type': 'application/json;charset=UTF-8',
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://myaccount.dominionenergy.com',
    Referer: 'https://myaccount.dominionenergy.com/',
    uid: '1',
  };
  const payload = { refreshToken: session.refresh_token ?? '' };
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new DominionEnergyApiError(
      `Token refresh network error: ${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const excerpt = body.slice(0, 300);
    if (res.status === 401) {
      throw new DominionEnergyAuthError(
        `Token refresh rejected (401): ${excerpt}`,
      );
    }
    throw new DominionEnergyApiError(
      `Token refresh failed (${res.status} ${res.statusText}): ${excerpt}`,
    );
  }
  const data = (await res.json()) as Record<string, unknown>;
  const responseData = (data.data ?? data) as Record<string, unknown>;
  return {
    access_token: (responseData.accessToken as string) ?? '',
    refresh_token: (responseData.refreshToken as string) ?? '',
    expires_in: (responseData.expiresIn as number) ?? 30,
  };
}
```

- [ ] **Step 2: Typecheck**

Run from `dominionpower-mcp/`:

```bash
cd dominionpower-mcp && npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add dominionpower-mcp/src/dominion/endpoints/gigya.ts
git commit -m "feat(dominion-mcp): include response body in refresh error messages"
```

---

## Task 5: Add diagnostic logging on refresh failure

**Files:**
- Modify: `dominionpower-mcp/src/dominion/auth.ts`
- Test: `dominionpower-mcp/test/dominion/auth.test.ts`

- [ ] **Step 1: Write failing tests for auth flow**

Create `dominionpower-mcp/test/dominion/auth.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `dominionpower-mcp/`:

```bash
cd dominionpower-mcp && npx vitest run test/dominion/auth.test.ts
```

Expected: FAIL — diagnostic logging not yet implemented; log will not be called with the diagnostic string.

- [ ] **Step 3: Add diagnostic logging to refreshAccessTokenIfNeeded**

Replace `dominionpower-mcp/src/dominion/auth.ts` with:

```ts
import type { SessionStore } from './session.js';
import { DominionEnergyAuthError } from './types.js';
import { refreshAccessToken } from './endpoints/gigya.js';

export function isAuthenticated(store: SessionStore): boolean {
  if (store.token && store.uuid) {
    const now = Math.floor(Date.now() / 1000);
    if (store.token_expires > now) return true;
    if (store.refresh_token) return true;
  }
  return false;
}

export async function refreshAccessTokenIfNeeded(
  fetchFn: typeof fetch,
  store: SessionStore,
  log?: (msg: string) => void,
): Promise<void> {
  if (!store.refresh_token || !store.uuid) {
    log?.('refresh skipped: no refresh_token or uuid');
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const refreshWindow = 60;
  if (store.token_expires > now + refreshWindow) {
    log?.(`refresh skipped: token expires at ${store.token_expires}, now ${now}, still valid`);
    return;
  }

  log?.(`refresh needed: token expires at ${store.token_expires}, now ${now}`);

  try {
    const result = await refreshAccessToken(fetchFn, {
      token: store.token,
      refresh_token: store.refresh_token,
      token_expires: store.token_expires,
      uuid: store.uuid,
      cookies: store.cookies,
      customer_number: store.customer_number,
      contract: store.contract,
    });

    store.token = result.access_token;
    store.refresh_token = result.refresh_token;
    store.token_expires = now + result.expires_in;
    log?.(`refresh succeeded: new token expires at ${store.token_expires}`);
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    log?.(`refresh failed: ${message}`);
    if (err instanceof DominionEnergyAuthError) {
      throw new FullAuthRequiredError(message);
    }
    throw err;
  }
}

export class FullAuthRequiredError extends DominionEnergyAuthError {
  override readonly name = 'FullAuthRequiredError';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `dominionpower-mcp/`:

```bash
cd dominionpower-mcp && npx vitest run test/dominion/auth.test.ts
```

Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Run the full test suite**

Run from `dominionpower-mcp/`:

```bash
cd dominionpower-mcp && npm test
```

Expected: PASS — all tests pass (jwt + session + auth = 22 tests).

- [ ] **Step 6: Commit**

```bash
git add dominionpower-mcp/src/dominion/auth.ts dominionpower-mcp/test/dominion/auth.test.ts
git commit -m "feat(dominion-mcp): log refresh diagnostics before throwing"
```

---

## Task 6: Final typecheck and full test verification

- [ ] **Step 1: Typecheck**

Run from `dominionpower-mcp/`:

```bash
cd dominionpower-mcp && npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 2: Run full test suite**

Run from `dominionpower-mcp/`:

```bash
cd dominionpower-mcp && npm test
```

Expected: PASS — all tests pass.

- [ ] **Step 3: Verify no leftover `+ 25` patterns**

Run from repo root:

```bash
grep -rn "token_expires = Math.floor(Date.now()" dominionpower-mcp/src && echo "FOUND BUG" || echo "OK: no +25 patterns remain"
```

Expected: `OK: no +25 patterns remain`.

- [ ] **Step 4: Commit (only if there are any uncommitted changes)**

```bash
git status --short
```

If anything is modified, commit it. If clean, no action.

---

## Verification (manual, post-merge)

These steps require a running docker container and are not part of the automated plan; they confirm the fix end-to-end.

1. With a valid `dominionpower-mcp/data/session.json`, run `docker compose restart`. Watch the logs — expected: `refresh skipped: token expires at …, now …, still valid` and no TFA prompt.
2. Temporarily corrupt `session.json` (set `token_expires: 0` with valid `token`). Restart. Expected: refresh attempt runs; on success the new `token_expires` reflects the server's `expiresIn`; on failure the log includes the actual HTTP status and response body excerpt (e.g., `refresh failed: Token refresh rejected (401): {"error":"…"}`).