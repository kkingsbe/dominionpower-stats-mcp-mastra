# Dominion Energy TypeScript Port — Design

**Date:** 2026-06-22
**Status:** Approved (pending user review of written spec)

## Goal

Port the Python Home Assistant integration at `../homeassistant-dominionpower-integration` to a standalone TypeScript service that runs in Docker. Only the connection to Dominion Energy is in scope — no Home Assistant sensor platform, no HA config flow, no HA recorder/statistics integration.

The result is a long-running service that authenticates against Dominion Energy (with on-demand browser-based TFA), polls every 12 hours, and exposes the same 36 sensor values via a local HTTP/JSON API plus historical time-series endpoints.

## Non-goals

- No Home Assistant sensor integration (no `sensor.py` equivalent, no MQTT discovery, no HA REST push).
- No Prometheus or InfluxDB exporter.
- No energy-dashboard statistics insertion (`coordinator.py`'s `_insert_statistics` / `_process_statistics` is intentionally omitted — that was an HA-coordinator concern).
- No CLI utility beyond a thin `setup` command for development.

## Architecture

Two-tier TypeScript project: a **pure API client library** and a **service tier** that wires it to Playwright (for TFA) and Fastify (for HTTP).

```
src/
├── dominion/          # Pure API client — no browser, no HTTP server, no I/O beyond session.json
│   ├── client.ts        # DominionEnergyApi class (entrypoint)
│   ├── auth.ts          # Refresh-token logic (Gigya)
│   ├── parsers/         # Raw API JSON → DominionEnergyData
│   │   ├── bill.ts
│   │   ├── usage.ts
│   │   ├── account.ts
│   │   └── weather.ts
│   ├── endpoints/       # One file per API family
│   │   ├── service.ts       # Bill forecast, usage history, weather (Service API)
│   │   ├── usage.ts         # Monthly electric + generation (Usage API)
│   │   ├── billing.ts       # Current bill + history (Billing API)
│   │   ├── account.ts       # Meter info (Account Management API)
│   │   └── gigya.ts         # Token refresh + finalize (User Management API)
│   ├── session.ts       # Load/save session JSON from disk
│   ├── types.ts         # DominionEnergyData interface + Error classes
│   └── const.ts         # URLs, headers, sensor keys (mirror of Python const.py)
├── auth-browser/      # Playwright-based login + TFA
│   ├── login.ts         # Headless Chrome login flow
│   ├── tfa.ts           # TFA flow via Gigya API (port of Python _handle_tfa_via_api)
│   └── ui/              # Static HTML for login + TFA form
│       ├── login.html
│       └── tfa.html
├── server/            # HTTP API + caching + lifecycle
│   ├── routes.ts        # Fastify routes
│   ├── cache.ts         # In-memory snapshot store
│   ├── poller.ts        # 12h background poll loop
│   └── reauth.ts        # Detect auth failure → launch auth-browser UI
├── config.ts          # Env var parsing (Zod)
└── index.ts           # Wires client + auth-browser + server
```

### Component responsibilities

- **`dominion/`** — No `playwright`, no `fastify`, no process lifecycle. Pure data layer. Reads `session.json` on demand; the only I/O it performs. Designed so it could be lifted out into a separate npm package.
- **`auth-browser/`** — Owns Playwright lifecycle. Only invoked by `server/reauth.ts` when authentication is needed. Port of Python's `_selenium_login_with_tfa`, `_handle_tfa_via_api`, and `_handle_phone_tfa`.
- **`server/`** — Fastify app, in-memory cache, 12h poller, re-auth orchestration. The only layer that wires `dominion/` to `auth-browser/`.
- **`index.ts`** — Parses env config, starts the poller, starts the HTTP server.

## Tech stack

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | Node 20 LTS | Native `fetch`, native `AbortController`, stable. No Bun — keeps Docker image lean. |
| Language | TypeScript 5.x strict | — |
| HTTP server | Fastify 4.x | TS-first, built-in JSON schema validation, faster than Express, pino integrates natively. |
| HTTP client | Native `fetch` | No need for `undici` wrapper; Node 20 fetch is sufficient. |
| Browser automation | Playwright (`playwright-chromium`) | TS-native API, bundles Chromium, much better Docker story than Selenium + webdriver-manager. |
| Validation | Zod | Env var parsing + API response shape validation. |
| Logging | pino | Pairs with Fastify. Structured JSON logs. |
| Testing | Vitest | Fastest TS-native runner, ESM-friendly. |
| Lint/format | ESLint + Prettier | — |
| Container base | `mcr.microsoft.com/playwright:v1.49.x-jammy` | Chromium pre-installed; ~1.2GB but saves fragile ChromeDriver setup. |

## Data flow

1. **Startup.** `index.ts` reads env vars via `config.ts` (Zod). Tries to load `/data/session.json` via `session.ts`.
2. **Background poller.** `server/poller.ts` runs `setInterval` of 12 hours. Each tick calls `dominion/client.ts: getAllData()`. On success, snapshot is written to `server/cache.ts`. On auth error, `reauth.ts` is invoked.
3. **Re-auth.** `reauth.ts` launches a Playwright Chromium, binds the admin web UI on port 8080, and pauses polling. After successful TFA, session is saved, admin UI is torn down, and polling resumes.
4. **HTTP requests.** Fastify reads from `cache.ts`. No request ever triggers a fetch directly — only the poller does. This keeps Dominion's API call rate constant.

## HTTP API surface

All responses are JSON. Errors use Fastify's standard error shape `{ error: string, details?: unknown }`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | `{ status: "ok" \| "needs_reauth" \| "error", lastFetch: ISO8601, lastError?: string }` |
| GET | `/sensors` | Full `DominionEnergyData` snapshot (all 36 keys) |
| GET | `/sensors/:key` | One sensor (e.g. `/sensors/grid_consumption`); 404 if key unknown |
| GET | `/usage/daily?from=YYYY-MM-DD&to=YYYY-MM-DD` | Daily consumption/generation within range |
| GET | `/usage/monthly` | Monthly electric + solar generation |
| GET | `/bills/history?limit=N` | Bill history (default 12) |
| GET | `/admin/*` | Login + TFA UI (only bound when re-auth needed) |

The 36 sensor keys in `/sensors/:key` exactly match the Python `const.py` `SENSOR_*` constants — see "Mapping from Python" below.

## Mapping from Python (`../homeassistant-dominionpower-integration`)

| Python file/class | TS location |
|---|---|
| `custom_components/dominion_energy/api.py` (2591 lines) | Split across `dominion/` |
| `DominionEnergyData` dataclass | `dominion/types.ts` (interface + factory) |
| `DominionEnergyApi` class | `dominion/client.ts` |
| `_refresh_access_token` | `dominion/auth.ts` |
| `get_bill_forecast`, `get_usage_history`, `get_usage_history_detail` | `dominion/endpoints/service.ts` |
| `get_electric_usage`, `get_generation_data` | `dominion/endpoints/usage.ts` |
| `get_current_bill`, `get_billing_history` | `dominion/endpoints/billing.ts` |
| `get_meter_info`, `get_bp_number`, `get_business_master` | `dominion/endpoints/account.ts` |
| Inline JSON parsing (e.g. `_parse_bill`, `_parse_usage`) | `dominion/parsers/*.ts` |
| `get_session_data`, `restore_session_data` | `dominion/session.ts` |
| `const.py` URLs + headers | `dominion/const.ts` |
| `const.py` `SENSOR_*` constants | `dominion/const.ts` (preserved verbatim) |
| `_selenium_login_with_tfa` | `auth-browser/login.ts` |
| `_handle_tfa_via_api`, `_handle_phone_tfa` | `auth-browser/tfa.ts` |
| `config_flow.py` (HA-specific) | **Dropped.** Replaced by `auth-browser/ui/*.html` + `/admin` routes. |
| `coordinator.py` (HA-specific polling + statistics) | **Dropped.** Replaced by `server/poller.ts` (no statistics insertion). |
| `__init__.py`, `manifest.json`, `hacs.json`, `strings.json`, `translations/` | **Dropped.** Not applicable outside HA. |

### Notable port decisions

- **Selenium → Playwright.** Selenium is unstable in headless containers and the Python integration has known issues with `webdriver-manager` downloading ChromeDriver at runtime. Playwright bundles Chromium, has first-class TS bindings, and runs cleanly in `mcr.microsoft.com/playwright` base images.
- **No TFA callbacks.** Python uses thread-blocking `threading.Event` to wait for HA's config flow to deliver a TFA code. In TS we have a real web UI — `auth-browser/login.ts` simply awaits an HTTP POST from the admin form. Much cleaner.
- **No statistics insertion.** HA's `recorder` integration accepts external statistics; that is what `coordinator.py:_insert_statistics` does. Not applicable standalone — if a consumer wants time-series, they call `/usage/daily` etc.
- **No async-to-thread bridging.** Python needed `loop.run_in_executor` because Selenium is sync. Playwright is async-native, so `auth-browser/login.ts` is plain `async/await`.

## Configuration & storage

### Environment variables (parsed via Zod in `config.ts`)

| Var | Required | Default | Purpose |
|---|---|---|---|
| `DOMINION_USERNAME` | yes | — | Dominion account email |
| `DOMINION_PASSWORD` | yes | — | Dominion account password |
| `DOMINION_ACCOUNT_NUMBER` | yes | — | 12-digit account number |
| `DATA_DIR` | no | `/data` | Mounted volume for session.json |
| `HTTP_PORT` | no | `3000` | Main API port |
| `ADMIN_PORT` | no | `8080` | Re-auth UI port |
| `POLL_INTERVAL_HOURS` | no | `12` | Background poll cadence |
| `LOG_LEVEL` | no | `info` | pino level |

### `/data/session.json`

JSON document with the same shape as the Python `get_session_data()` return value:

```json
{
  "token": "...",
  "refresh_token": "...",
  "token_expires": 1719000000.0,
  "uuid": "...",
  "cookies": { "gmid": "...", "ucid": "..." },
  "customer_number": "...",
  "contract": "..."
}
```

Written by `dominion/session.ts` after every successful `getAllData()` only if changed (matches Python behavior). Read on startup. Plaintext on disk — credentials are not stored here, only session tokens. Mounted volume ensures it survives container restarts.

## Auth UI flow

1. **First run** (no `session.json`): `reauth.ts` starts Playwright + binds admin UI on port 8080 immediately.
2. User opens `http://localhost:8080/admin/login`, sees a form with username/password/account-number fields (pre-filled from env vars when available).
3. Form POSTs to `/admin/login`. Server starts Playwright login via `auth-browser/login.ts`.
4. If TFA required, Playwright's network capture detects a `403101` error code from Gigya. `auth-browser/tfa.ts` then performs the Gigya TFA flow directly (initTFA → phone.sendVerificationCode → phone.completeVerification → finalizeTFA → finalizeRegistration) — same as Python.
5. UI shows a 6-digit code field. User enters the SMS code, POSTs to `/admin/tfa`.
6. TFA completes. Session saved to `/data/session.json`. Admin server tears down. Polling resumes.
7. **Subsequent runs**: session restored. Refresh token used. No browser launches. UI only re-appears if refresh fails.

Admin port (8080) is only bound when re-auth is needed — the service does not expose any UI when healthy. Production deployments should not publish the admin port externally.

## Docker

Single `Dockerfile` based on `mcr.microsoft.com/playwright:v1.49.x-jammy`:

- Copy `package.json`, install deps with `npm ci --omit=dev`.
- Copy `dist/` (compiled TS).
- Run as non-root (`USER node`).
- `CMD ["node", "dist/index.js"]`.

`.dockerignore` excludes `node_modules`, `dist` build artifacts cache, `.git`, `test/`.

Example `docker-compose.yml` shape (documented in README, not committed by default):

```yaml
services:
  dominion:
    build: .
    environment:
      DOMINION_USERNAME: ${DOMINION_USERNAME}
      DOMINION_PASSWORD: ${DOMINION_PASSWORD}
      DOMINION_ACCOUNT_NUMBER: ${DOMINION_ACCOUNT_NUMBER}
    volumes:
      - ./data:/data
    ports:
      - "3000:3000"     # API
      # 8080:8080      # Uncomment only when re-auth needed
    restart: unless-stopped
```

## Testing strategy

| Layer | Tool | Coverage |
|---|---|---|
| `dominion/parsers/` | Vitest + fixture JSON | Pure unit tests on response parsing. Highest leverage — most bug-prone code. |
| `dominion/endpoints/` | Vitest + `msw` (mock fetch) | Verify URL construction + headers. No real network. |
| `dominion/auth.ts` (refresh logic) | Vitest with mocked fetch | Token expiry handling, error paths. |
| `server/routes.ts` | Vitest + Fastify `inject` | HTTP shape, 404 handling, query params. |
| `server/poller.ts` | Vitest with fake timers | Interval timing, error → reauth trigger. |
| `auth-browser/` | Manual only | Browser flows are impractical to test in CI; covered by manual smoke test in README. |

No live API calls in CI. README documents a `npm run smoke` script that authenticates against the real Dominion API using env credentials — manual verification only.

## Risks

1. **Dominion changes their auth flow.** Python integration already required Selenium because Gigya + JS-driven login is brittle. Playwright is more reliable but not immune. Mitigation: pin to a working Chromium version, document the known-good state in README.
2. **TFA UX depends on the admin port being reachable.** If 8080 isn't published, the user can't complete TFA. Mitigation: README, docker-compose comment, and a `/health` endpoint that reports `needs_reauth` so an external orchestrator can page the user.
3. **Session.json contains tokens in plaintext.** Acceptable for a home Docker deployment; if exposed to the internet, this is a real concern. Mitigation: document the risk in README, recommend reverse proxy with auth if exposing publicly.
4. **Image size (~1.5GB with Playwright Chromium).** Acceptable for a single-purpose container; the alternative is a multi-stage build that downloads Chromium at runtime, which is fragile.