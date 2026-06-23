# Dominion Energy Mastra MCP Server — Design

**Date:** 2026-06-22
**Status:** Draft

## Goal

Refactor the current Fastify-based HTTP service in `dominionpower-stats-mcp/` into a Mastra MCP server living in `dominionpower-mcp/`. The new server exposes the same Dominion Energy data as MCP tools instead of REST endpoints, runs as a Docker container with pre-start browser-based TFA auth, and keeps the 12-hour background polling pattern.

## Non-goals

- No AI agents or workflows — only raw MCP tools. The `@mastra/mcp` server is registered with Mastra but no `agents` or `workflows` config is used.
- No changes to the Dominion API client logic, parsers, auth-browser flow, or poller/cache internals — these move as-is.

## Architecture

```
dominionpower-mcp/
├── src/
│   ├── mastra/
│   │   ├── index.ts              # Mastra config: MCPServer + DominionService
│   │   └── lib/
│   │       └── dominion-service.ts  # Init: auth → api → poller → tools
│   ├── dominion/                 # Copied from root (client, auth, parsers, types, const, session, endpoints)
│   ├── server/                   # Copied from root (cache, poller, reauth)
│   ├── auth-browser/             # Copied from root (login, tfa, api-proxy, ui/)
│   └── config.ts                 # Copied from root (env parsing via Zod)
├── package.json                  # Merge root deps + @mastra/mcp
├── Dockerfile                    # Multi-stage: Node build → playwright-jammy runtime
└── docker-compose.yml            # Single service, Playwright-based image
```

### Data flow

1. **Startup.** `src/mastra/lib/dominion-service.ts` initializes:
   - Parses env config (Zod)
   - Loads session from `/data/session.json`
   - If session missing/expired → launches Playwright browser + admin web UI
   - User enters TFA code via web form (same HTML UI as current)
   - Auth completes, session saved to `/data/session.json`, browser closed
   - Creates `DominionEnergyApi` with valid session
   - Starts `Poller` (12h interval, feeds `DataCache`)
2. **MCP tools.** Each tool reads from `DataCache` (never calls Dominion API directly).
3. **Server.** Mastra's built-in HTTP server (via `@mastra/server`) exposes the MCP protocol.

### Tools

| Tool ID | Description | Returns |
|---|---|---|
| `get-sensors` | All sensor values from the last poll | Full `DominionEnergyData` object |
| `get-sensor` | One sensor by key | `{ key, value }` or 404 |
| `get-daily-usage` | Daily consumption/generation array | `{ data: [...] }` |
| `get-monthly-usage` | Monthly electric + solar usage | `{ monthly_usage }` |
| `get-bill-history` | Bill history array | `{ data: [...] }` |
| `get-health` | Poller status, last poll time, error state | Health object |

### Auth flow (unchanged from current)

1. Session loaded from `/data/session.json` on init
2. If `isAuthenticated()` + `token_expires` valid → proceed immediately
3. If invalid → `reauth.ts` launches Playwright, binds `POST /admin/tfa` endpoint on a separate port
4. User visits `http://<container>:8080/admin/tfa`, enters SMS code
5. Auth completes, session saved, browser closed, poller starts
6. Mastra server starts serving MCP tools on `PORT` (default 3456)

### Docker

Two-stage build:

1. **Builder** — `node:22-alpine`, install deps, `mastra build --studio`
2. **Runner** — `mcr.microsoft.com/playwright:v1.49.0-jammy`, copy `.mastra/output/` + `node_modules`, run built entry point

Volume mount `/data` for session persistence.

## Files to create/modify

### New files in `dominionpower-mcp/`

| File | Purpose |
|---|---|
| `src/mastra/lib/dominion-service.ts` | Service container: init auth, create API, start poller, create tools |
| `src/mastra/tools/sensors.ts` | `get-sensors` and `get-sensor` MCP tools |
| `src/mastra/tools/usage.ts` | `get-daily-usage` and `get-monthly-usage` MCP tools |
| `src/mastra/tools/bills.ts` | `get-bill-history` MCP tool |
| `src/mastra/tools/health.ts` | `get-health` MCP tool |
| `Dockerfile` | Multi-stage build for Mastra MCP server + Playwright |
| `docker-compose.yml` | Docker Compose service definition |

### Modified files in `dominionpower-mcp/`

| File | Change |
|---|---|
| `package.json` | Add `@mastra/mcp`, `playwright-chromium`, `zod`, `pino`; remove example weather agent deps |
| `src/mastra/index.ts` | Replace weather agent/workflow with MCP server + DominionService |
| `AGENTS.md` | Update instructions for new structure |

### Files copied from root `src/` into `dominionpower-mcp/`

| Source | Dest |
|---|---|
| `src/dominion/` | `src/dominion/` |
| `src/server/` (cache, poller, reauth — NOT routes.ts) | `src/server/` |
| `src/auth-browser/` | `src/auth-browser/` |
| `src/config.ts` | `src/config.ts` |
| `src/auth-browser/ui/` | `src/auth-browser/ui/` |
| Root tests | `tests/` |

### Files removed

| File | Reason |
|---|---|
| Root `src/index.ts` | Replaced by Mastra's built entry point |
| Root `src/server/routes.ts` | Fastify routes → MCP tools |
| Root `Dockerfile` | Replaced by new Mastra Dockerfile |
| Root `docker-compose.yml` | Replaced |
| `dominionpower-mcp/src/mastra/agents/weather-agent.ts` | Not needed |
| `dominionpower-mcp/src/mastra/workflows/weather-workflow.ts` | Not needed |
| `dominionpower-mcp/src/mastra/scorers/weather-scorer.ts` | Not needed |
| `dominionpower-mcp/src/mastra/tools/weather-tool.ts` | Not needed |

## Implementation Plan

### Phase 1 — Install dependencies & set up TypeScript

1. Add `@mastra/mcp`, `playwright-chromium`, `pino`, `zod` to `dominionpower-mcp/package.json`
2. Remove unused weather deps, update scripts
3. Add `tsconfig.json`
4. `npm install`

### Phase 2 — Move domain code

1. Copy `src/dominion/` from root into `dominionpower-mcp/src/`
2. Copy `src/server/` (cache.ts, poller.ts, reauth.ts — NOT routes.ts)
3. Copy `src/auth-browser/` (login.ts, tfa.ts, api-proxy.ts, ui/)
4. Copy `src/config.ts`
5. Copy existing tests

### Phase 3 — Create DominionService

1. Create `src/mastra/lib/dominion-service.ts`
2. Wraps: config parse, session load/save, auth flow, DominionEnergyApi, DataCache, Poller, tool creation
3. Init is blocking — server doesn't start until auth completes

### Phase 4 — Create MCP tools

1. `src/mastra/tools/sensors.ts` — `get-sensors` + `get-sensor`
2. `src/mastra/tools/usage.ts` — `get-daily-usage` + `get-monthly-usage`
3. `src/mastra/tools/bills.ts` — `get-bill-history`
4. `src/mastra/tools/health.ts` — `get-health`

Each tool:
- Takes zero params (reads from cache)
- Uses `createTool` from `@mastra/core/tools`
- Has `readOnlyHint: true` annotation
- Returns typed data or error

### Phase 5 — Wire Mastra config

1. Update `src/mastra/index.ts`:
   - Import and create `DominionService`
   - Create `MCPServer` with tools from service
   - Create `Mastra` instance with `mcpServers` + `server` config
   - Export `mastra`

### Phase 6 — Dockerize

1. Dockerfile: two-stage, Node 22-alpine builder → playwright-jammy runner
2. docker-compose.yml: single service with env vars, volume mount, port mapping
3. Update `.env.example`
4. Update `.dockerignore`

### Phase 7 — Verify & clean up

1. `npm run build` (mastra build)
2. Verify TypeScript compiles
3. Clean up root project (remove old src/ files that moved)
