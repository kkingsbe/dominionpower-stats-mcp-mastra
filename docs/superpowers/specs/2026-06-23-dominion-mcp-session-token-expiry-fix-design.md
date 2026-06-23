# Dominion MCP Session Token Expiry Fix — Design

**Date:** 2026-06-23
**Status:** Draft

## Goal

Stop `dominionpower-mcp` from triggering the Playwright-based full TFA auth flow every time the docker container restarts. Today, restarting forces a re-auth because `session.json` is saved with a bogus `token_expires` value that is already in the past by the time the container starts. This spec also adds diagnostic logging so that when a refresh genuinely fails, the cause is visible in the existing `[dominion-mcp]` log stream.

## Non-goals

- No changes to the Dominion API client, parsers, or TFA flow itself.
- No changes to the root Fastify project (`src/index.ts`) — per `dominionpower-mcp/AGENTS.md` it is stale and unused; only `dominionpower-mcp/` is in scope.
- No JWT signature verification — the `exp` claim is read for scheduling only.
- No changes to the `refreshWindow = 60` constant in `auth.ts`.
- Not addressing the unrelated Mastra "no `storage` configured" warning (agent memory, not session persistence).

## Root cause

`dominionpower-mcp/src/mastra/lib/dominion-service.ts:159` and `:199` set:

```ts
this.store.token_expires = Math.floor(Date.now() / 1000) + 25;
```

immediately after a successful auth and after TFA completion. The user's current `dominionpower-mcp/data/session.json` has `token_expires: 1782245077` while the JWT's `exp` claim is `1782246853` — about 30 minutes later. So every restart finds the saved value already past, `auth.ts:25-28` triggers `refreshAccessTokenIfNeeded`, the refresh fails (root cause of the failure still unknown — captured below), `FullAuthRequiredError` is thrown, and `runAuthFlow` re-enters the Playwright TFA flow.

When the refresh does fail, the only signal is `FullAuthRequiredError("Token refresh rejected (401)")` from `dominionpower-mcp/src/dominion/endpoints/gigya.ts:32`. No body, no fetch-path info, no way to tell whether the request was Playwright-routed or globally-fetched.

## Approach

1. Parse the JWT `exp` claim and use it as the source of truth for `token_expires`. No new dependencies.
2. Replace the two `now + 25` lines with the JWT-derived value.
3. On every `loadSession`, recompute `token_expires` from the JWT if the stored value is in the past — automatic migration for existing buggy session files.
4. Enrich refresh error messages with response status and body excerpt so failures are diagnosable from the existing log.

## Architecture

```
dominionpower-mcp/
├── src/
│   └── dominion/
│       ├── jwt.ts            # NEW: decodeJwtPayload, jwtExpiry
│       ├── session.ts        # MODIFY: loadSession recomputes token_expires from JWT
│       ├── auth.ts           # MODIFY: refreshAccessTokenIfNeeded logs diagnostic context
│       └── endpoints/
│           └── gigya.ts      # MODIFY: refreshAccessToken includes body excerpt in error
└── mastra/
    └── lib/
        └── dominion-service.ts  # MODIFY: replace +25 with jwtExpiry()
└── test/                     # NEW dir
    ├── dominion/
    │   ├── jwt.test.ts       # NEW
    │   ├── auth.test.ts      # NEW
    │   └── session.test.ts   # NEW
├── vitest.config.ts          # NEW
└── package.json              # MODIFY: add "test" script
```

### Data flow

1. Container starts → `DominionService.initialize()` → `loadSession(sessionPath)`.
2. New migration logic in `loadSession`: if `store.token` is non-null and `store.token_expires < jwtExpiry(store.token)`, overwrite `token_expires` with the JWT-derived value. Idempotent and safe.
3. `isAuthenticated(store)` returns `true` because `token_expires` is now ~30 min in the future, well past `now + refreshWindow` (60 s).
4. `refreshAccessTokenIfNeeded` logs `refresh skipped: token expires at …, now …, still valid` and returns without hitting the network.
5. Poller starts. No TFA required.

### When a refresh genuinely fails

- `refreshAccessToken` (`gigya.ts`) reads `await res.text()` before throwing, and includes the body excerpt in the thrown error message: `Token refresh rejected (401): <body[:300]>`.
- `refreshAccessTokenIfNeeded` (`auth.ts`) catches, logs `{ err, status, body }` via the existing `[dominion-mcp]` logger at `info` level, then throws `FullAuthRequiredError` with the enriched message.

## Files to create / modify

### New files in `dominionpower-mcp/`

| File | Purpose |
|---|---|
| `src/dominion/jwt.ts` | `decodeJwtPayload(token)` + `jwtExpiry(token, fallbackSeconds?)` utilities |
| `test/dominion/jwt.test.ts` | Unit tests for JWT parser |
| `test/dominion/auth.test.ts` | Tests for `isAuthenticated` + `refreshAccessTokenIfNeeded` skip behavior |
| `test/dominion/session.test.ts` | Migration test: bogus `token_expires` is recomputed from JWT on load |
| `vitest.config.ts` | Vitest config for the subproject (matches root project pattern) |

### Modified files in `dominionpower-mcp/`

| File | Change |
|---|---|
| `src/dominion/session.ts` | After parsing session.json, if `store.token` exists and `store.token_expires < jwtExpiry(store.token)`, overwrite with JWT-derived value |
| `src/dominion/auth.ts` | In `refreshAccessTokenIfNeeded` catch, log `{ err, status, body }` before throwing `FullAuthRequiredError` |
| `src/dominion/endpoints/gigya.ts` | `refreshAccessToken` reads body on non-ok and includes `body.slice(0, 300)` in the thrown error message |
| `src/mastra/lib/dominion-service.ts` | Replace `token_expires = Math.floor(Date.now() / 1000) + 25` (lines 159, 199) with `token_expires = jwtExpiry(this.store.token)` |
| `package.json` | Add `"test": "vitest run"` script |

## Key design decisions

- **JWT `exp` as source of truth over server `expiresIn`:** the JWT is the actual issued token; parsing it is more reliable than depending on the auth response shape, which currently does not return `expires_in`.
- **Always recompute on load, not only when "looks wrong":** simpler, idempotent, and makes migration automatic without heuristics.
- **Body excerpt in error messages, not separate logging:** keeps diagnostic information tied to the failure context; the existing `[dominion-mcp]` logger shows the same line for both.
- **No signature verification:** the JWT is read for scheduling only. A forged `exp` cannot gain access because Dominion's API still enforces real auth.
- **`fallbackSeconds = 30` for malformed tokens:** matches the existing `refreshAccessToken` default of `expiresIn ?? 30`.

## Edge cases

- **Token null / missing on load:** `jwtExpiry(null) === 0`. No recomputation; `isAuthenticated` returns false and the existing full-auth flow runs as today.
- **Malformed JWT (not three parts, non-base64 payload, non-numeric exp):** `decodeJwtPayload` returns `null`; `jwtExpiry` returns `now + fallbackSeconds`. Better than the current `+ 25`.
- **Token present but refresh_token expired:** with the fix, `isAuthenticated` still returns true, poller runs, API calls fail with 401 → cache error. On the next poll cycle the failure is captured. No silent infinite-loop fallback to TFA unless explicitly triggered.
- **Concurrent restart / race condition:** not in scope; the existing single-instance design still applies.

## Out of scope (explicitly)

- Root Fastify project (`src/index.ts:104` has the same `+ 25` bug but is not running).
- Mastra storage configuration warning.
- Refreshing `refreshWindow` constant.
- JWT signature verification.
- Removing or replacing the Playwright-based TFA flow itself.

## Verification

1. `npm run typecheck` in `dominionpower-mcp/` passes.
2. `npm test` in `dominionpower-mcp/` passes (vitest).
3. Manual: with a valid `session.json`, `docker compose restart` produces no TFA prompt and the `[dominion-mcp]` log shows `refresh skipped: token expires at …, still valid`.
4. Manual: with `session.json` corrupted (token_expires set to 0), restart triggers refresh; if refresh fails, the log includes the HTTP status and body excerpt from the failed refresh request.