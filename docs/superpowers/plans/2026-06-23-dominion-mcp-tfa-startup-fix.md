# Dominion MCP TFA Startup Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken auth flow in the Mastra deployment so the container sends exactly one SMS code per startup, and a wrong/expired TFA code gives the user a clear recovery path instead of a dead-end "invalid login session" error.

**Architecture:** Add a concurrency guard around `triggerReauth` (mirroring the root version's `ReauthHandler`), `await` the initial `runAuthFlow` call inside `initialize()`, reset stale `tfaContext` and `authServer` state at the start of each auth attempt, and clear `tfaContext` on TFA failure so the user can request a fresh code automatically (one retry per cycle, guarded by the same flag).

**Tech Stack:** TypeScript 6.0, Node 22.13, Mastra 1.45, Playwright Chromium 1.49. No new runtime dependencies. No new test framework (project doesn't have one).

**Spec:** This plan. No separate spec doc — scope is small and bugs are well-localized to `dominion-service.ts`.

**Reference (working pattern):** `src/server/reauth.ts` at the repo root — `ReauthHandler.trigger()` with a `running` flag is the model we mirror.

---

## File Structure (changes only)

```
dominionpower-mcp/
└── src/
    ├── mastra/
    │   └── lib/
    │       └── dominion-service.ts     # ALL auth-flow fixes
    └── auth-browser/
        └── ui/
            └── tfa.html                # clearer UX on TFA failure / restart
```

No new files. No new dependencies. No docker / config / .env changes.

---

## Task 1: Add concurrency guard to `triggerReauth`

**Files:**
- Modify: `dominionpower-mcp/src/mastra/lib/dominion-service.ts:22-40` (add field), `:212-219` (gate the method)

### Step 1.1: Add the `running` field

Open `dominionpower-mcp/src/mastra/lib/dominion-service.ts`. In the `DominionService` class, find this block:

```ts
  apiProxy: ApiProxy;
  tfaContext: TfaContext | null = null;
  authServer: Server | null = null;
  logger: (msg: string) => void;
```

Add a `running` field directly after `logger`:

```ts
  apiProxy: ApiProxy;
  tfaContext: TfaContext | null = null;
  authServer: Server | null = null;
  logger: (msg: string) => void;
  private running = false;
```

### Step 1.2: Replace `triggerReauth` with a guarded version

Find the current method:

```ts
  private triggerReauth(): void {
    this.logger('Reauth triggered — restarting auth flow');
    this.runAuthFlow()
      .then(() => {
        this.poller.pollOnce().catch((err) => this.logger(`Poll after reauth failed: ${(err as Error).message}`));
      })
      .catch((err) => this.logger(`Reauth failed: ${(err as Error).message}`));
  }
```

Replace it with:

```ts
  private triggerReauth(): void {
    if (this.running) {
      this.logger('Reauth already in progress — skipping duplicate trigger');
      return;
    }
    this.running = true;
    this.logger('Reauth triggered — restarting auth flow');
    this.runAuthFlow()
      .then(() => {
        this.poller.pollOnce().catch((err) => this.logger(`Poll after reauth failed: ${(err as Error).message}`));
      })
      .catch((err) => this.logger(`Reauth failed: ${(err as Error).message}`))
      .finally(() => {
        this.running = false;
      });
  }
```

### Step 1.3: Typecheck

```bash
cd dominionpower-mcp && npm run typecheck
```

Expected: exit code 0, no errors.

### Step 1.4: Commit

```bash
cd dominionpower-mcp && git add src/mastra/lib/dominion-service.ts && git commit -m "fix(auth): add concurrency guard to triggerReauth"
```

---

## Task 2: `await` `runAuthFlow` in `initialize()`

**Files:**
- Modify: `dominionpower-mcp/src/mastra/lib/dominion-service.ts:42-76`

### Step 2.1: Wrap the two `this.runAuthFlow()` calls in try/catch + await

Find the current `initialize()` method:

```ts
  async initialize(): Promise<void> {
    const loaded = await loadSession(this.sessionPath);
    this.store = loaded ?? {
      token: null,
      refresh_token: null,
      token_expires: 0,
      uuid: null,
      cookies: {},
      customer_number: this.config.accountNumber ?? null,
      contract: null,
    };

    await this.syncCookiesToProxy();

    const proxyFetch = this.createProxyFetch();
    this.api = new DominionEnergyApi(proxyFetch, this.store, this.logger);

    if (isAuthenticated(this.store)) {
      try {
        await refreshAccessTokenIfNeeded(proxyFetch, this.store, this.logger);
        this.logger('Session loaded and token refreshed');
        await saveSession(this.sessionPath, this.store);
        await this.syncCookiesToProxy();
        this.startPoller();
      } catch (err) {
        if (err instanceof FullAuthRequiredError) {
          this.logger('Token refresh failed — running full auth');
          this.runAuthFlow();
        }
      }
    } else {
      this.logger('No valid session — running auth flow');
      this.runAuthFlow();
    }
  }
```

Replace the catch block and the `else` block so both `runAuthFlow()` calls are awaited and their errors are caught/logged:

```ts
    if (isAuthenticated(this.store)) {
      try {
        await refreshAccessTokenIfNeeded(proxyFetch, this.store, this.logger);
        this.logger('Session loaded and token refreshed');
        await saveSession(this.sessionPath, this.store);
        await this.syncCookiesToProxy();
        this.startPoller();
      } catch (err) {
        if (err instanceof FullAuthRequiredError) {
          this.logger('Token refresh failed — running full auth');
          try {
            await this.runAuthFlow();
          } catch (authErr) {
            this.logger(`Initial auth flow failed: ${(authErr as Error).message}`);
          }
        } else {
          throw err;
        }
      }
    } else {
      this.logger('No valid session — running auth flow');
      try {
        await this.runAuthFlow();
      } catch (authErr) {
        this.logger(`Initial auth flow failed: ${(authErr as Error).message}`);
      }
    }
  }
```

### Step 2.2: Typecheck

```bash
cd dominionpower-mcp && npm run typecheck
```

Expected: exit code 0.

### Step 2.3: Commit

```bash
cd dominionpower-mcp && git add src/mastra/lib/dominion-service.ts && git commit -m "fix(auth): await initial runAuthFlow in initialize()"
```

---

## Task 3: Reset stale `tfaContext` at start of `runAuthFlow`

**Files:**
- Modify: `dominionpower-mcp/src/mastra/lib/dominion-service.ts:110-129`

### Step 3.1: Add the reset line

Find `runAuthFlow` (currently starts with `await this.apiProxy.ensureBrowser();`):

```ts
  private async runAuthFlow(): Promise<void> {
    await this.apiProxy.ensureBrowser();
    const loginBrowser = this.apiProxy.getBrowserRef();
    const result = await runLoginFlow(
```

Insert a `this.tfaContext = null;` line at the very top of the method body (before `await this.apiProxy.ensureBrowser();`):

```ts
  private async runAuthFlow(): Promise<void> {
    this.tfaContext = null;
    await this.apiProxy.ensureBrowser();
    const loginBrowser = this.apiProxy.getBrowserRef();
    const result = await runLoginFlow(
```

### Step 3.2: Typecheck

```bash
cd dominionpower-mcp && npm run typecheck
```

Expected: exit code 0.

### Step 3.3: Commit

```bash
cd dominionpower-mcp && git add src/mastra/lib/dominion-service.ts && git commit -m "fix(auth): clear stale tfaContext at start of runAuthFlow"
```

---

## Task 4: Close existing `authServer` before opening a new one

**Files:**
- Modify: `dominionpower-mcp/src/mastra/lib/dominion-service.ts:162-166`

### Step 4.1: Add the close-if-exists guard

Find the start of `startAuthServer`:

```ts
  private startAuthServer(): void {
    const adminPort = parseInt(process.env.ADMIN_PORT || '8080', 10);
    const tfaPath = join(__dirname, '..', '..', '..', 'auth-browser', 'ui', 'tfa.html');

    this.authServer = createServer(async (req, res) => {
```

Replace it so the existing server (if any) is closed first:

```ts
  private startAuthServer(): void {
    if (this.authServer) {
      this.authServer.close();
      this.authServer = null;
    }
    const adminPort = parseInt(process.env.ADMIN_PORT || '8080', 10);
    const tfaPath = join(__dirname, '..', '..', '..', 'auth-browser', 'ui', 'tfa.html');

    this.authServer = createServer(async (req, res) => {
```

### Step 4.2: Typecheck

```bash
cd dominionpower-mcp && npm run typecheck
```

Expected: exit code 0.

### Step 4.3: Commit

```bash
cd dominionpower-mcp && git add src/mastra/lib/dominion-service.ts && git commit -m "fix(auth): close existing authServer before opening a new one"
```

---

## Task 5: Clear `tfaContext` on TFA failure and re-trigger auth

**Files:**
- Modify: `dominionpower-mcp/src/mastra/lib/dominion-service.ts:173-201`

### Step 5.1: Update the POST `/admin/tfa` catch block

Find the POST handler inside `startAuthServer`:

```ts
      if (req.method === 'POST' && req.url === '/admin/tfa') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
          try {
            const { code } = JSON.parse(body);
            const tfaResult = await completePhoneTfa(fetch, this.tfaContext!, code);
            const proxyFetch = this.createProxyFetch();
            const authResult = await dominionLoginAuth(
              proxyFetch,
              tfaResult.id_token,
              this.store.cookies,
            );
            this.store.token = authResult.token;
            this.store.refresh_token = authResult.refresh_token;
            this.store.token_expires = Math.floor(Date.now() / 1000) + 25;
            await saveSession(this.sessionPath, this.store);
            await this.syncCookiesToProxy();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            this.authServer?.close();
            this.startPoller();
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: (err as Error).message }));
          }
        });
        return;
      }
```

Replace it so the catch block clears `tfaContext` and triggers a fresh auth flow (which is itself guarded by `running`, so it won't loop):

```ts
      if (req.method === 'POST' && req.url === '/admin/tfa') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
          try {
            const { code } = JSON.parse(body);
            const tfaResult = await completePhoneTfa(fetch, this.tfaContext!, code);
            const proxyFetch = this.createProxyFetch();
            const authResult = await dominionLoginAuth(
              proxyFetch,
              tfaResult.id_token,
              this.store.cookies,
            );
            this.store.token = authResult.token;
            this.store.refresh_token = authResult.refresh_token;
            this.store.token_expires = Math.floor(Date.now() / 1000) + 25;
            await saveSession(this.sessionPath, this.store);
            await this.syncCookiesToProxy();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            this.authServer?.close();
            this.authServer = null;
            this.startPoller();
          } catch (err) {
            this.logger(`TFA verification failed: ${(err as Error).message} — clearing tfaContext and re-triggering auth`);
            this.tfaContext = null;
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: (err as Error).message, action: 'restarting_auth' }));
            this.triggerReauth();
          }
        });
        return;
      }
```

### Step 5.2: Typecheck

```bash
cd dominionpower-mcp && npm run typecheck
```

Expected: exit code 0.

### Step 5.3: Commit

```bash
cd dominionpower-mcp && git add src/mastra/lib/dominion-service.ts && git commit -m "fix(auth): clear tfaContext and re-trigger auth on TFA failure"
```

---

## Task 6: Improve `tfa.html` UX for failure / restart state

**Files:**
- Modify: `dominionpower-mcp/src/auth-browser/ui/tfa.html:40-47`

### Step 6.1: Update the response handler

Find the script block:

```html
<script>
document.getElementById('tfaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('status');
  status.className = '';
  status.textContent = 'Verifying...';
  try {
    const res = await fetch('/admin/tfa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: document.getElementById('code').value }),
    });
    const data = await res.json();
    if (res.ok) {
      status.className = 'success'; status.textContent = 'Verification successful! You can close this window.';
    } else {
      status.className = 'error'; status.textContent = data.error || 'Verification failed';
    }
  } catch { status.className = 'error'; status.textContent = 'Connection error'; }
});
</script>
```

Replace it with a version that handles the new `restarting_auth` action and is robust to the server already restarting:

```html
<script>
document.getElementById('tfaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('status');
  status.className = '';
  status.textContent = 'Verifying...';
  try {
    const res = await fetch('/admin/tfa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: document.getElementById('code').value }),
    });
    const data = await res.json();
    if (res.ok) {
      status.className = 'success';
      status.textContent = 'Verification successful! You can close this window.';
      document.getElementById('tfaForm').style.display = 'none';
      return;
    }
    status.className = 'error';
    if (data.action === 'restarting_auth') {
      status.textContent = 'That code is no longer valid. A new authentication is starting — a fresh SMS code will arrive shortly. Reload this page in a minute.';
      document.getElementById('tfaForm').style.display = 'none';
    } else {
      status.textContent = data.error || 'Verification failed';
    }
  } catch {
    status.className = 'error';
    status.textContent = 'Connection error — please reload the page';
  }
});
</script>
```

### Step 6.2: Build the UI assets into `dist/`

```bash
cd dominionpower-mcp && npm run build
```

Expected: build succeeds. (Mastra copies static UI assets into `dist/`; verify by checking `dominionpower-mcp/.mastra/output/` or wherever the build outputs end up — match the path that the Docker `CMD` references.)

### Step 6.3: Commit

```bash
cd dominionpower-mcp && git add src/auth-browser/ui/tfa.html && git commit -m "fix(ui): clearer message when TFA failure restarts auth"
```

---

## Task 7: Verify build and produce a summary

**Files:** none (verification only)

### Step 7.1: Full typecheck + build

```bash
cd dominionpower-mcp && npm run typecheck && npm run build
```

Expected: both exit 0.

### Step 7.2: Manual smoke checklist

Document in your final report that you verified (or could not verify) the following:

1. Cold start with empty `/data/session.json`: container boots, `runAuthFlow` runs, **exactly one** SMS arrives, `/admin/tfa` accepts the code, `getAllData` populates the cache.
2. Cold start with stale `/data/session.json` (expired refresh_token): `initialize` detects `FullAuthRequiredError`, runs `runAuthFlow`, **exactly one** SMS arrives.
3. Wrong TFA code: UI shows the "restarting_auth" message, **exactly one** new SMS arrives (because `triggerReauth` is guarded), fresh code works.
4. Container restart after successful auth: no SMS sent (session is valid).
5. Verify in container logs: `grep -c 'TFA code sent' <container-logs>` returns `1` for scenarios 1–3, `0` for scenario 4.

### Step 7.3: No commit

This task is verification only. If any task above was missed, fix it in its own commit before reporting done.

---

## Self-Review

**Spec coverage:**

| Bug | Task |
|---|---|
| A — `runAuthFlow` not awaited in `initialize()` | Task 2 |
| B — `triggerReauth` no concurrency guard | Task 1 |
| C — stale `tfaContext` carries over | Task 3 |
| D — `authServer` port leak across cycles | Task 4 |
| E — TFA failure leaves dead-end state | Task 5 (server) + Task 6 (UI) |
| F — gigyaLogin double-SMS fallback | Left as-is; out of scope (Task 1's guard prevents spam even if it fires) |

**Placeholder scan:** No "TODO", "TBD", "implement later", or "similar to" markers in task bodies. Every step shows full code or exact commands.

**Type consistency:**
- `this.running` field added in Task 1; read in `triggerReauth` (Task 1) and reset in `.finally()` (Task 1). Matches.
- `this.tfaContext` cleared in Tasks 3 and 5. `tfaContext!` non-null assertion in `completePhoneTfa(fetch, this.tfaContext!, code)` (Task 5) is preserved — the assertion is safe because the POST handler is only reachable when the admin server is up, which is only true when `tfaContext` is set.
- `this.authServer` cleared in Task 4 (`startAuthServer` top) and Task 5 (success path and failure path). Matches.

**Known limits (called out, not hidden):**
- No unit test added — the Mastra project has no test framework. Verification is via `npm run typecheck`, `npm run build`, and the manual smoke checklist in Task 7.
- The `gigyaLogin` double-SMS fallback (Bug F) is not removed; Task 1's `running` guard ensures it can never spam because re-entry is blocked while `runAuthFlow` is in progress.
- If `ADMIN_PORT` is not reachable from the user's browser, the fix is unverified — same constraint as before, just a heads-up.