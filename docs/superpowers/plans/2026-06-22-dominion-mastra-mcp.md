# Dominion Energy Mastra MCP Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Refactor the Fastify HTTP service into a Mastra MCP server. All domain logic moves to `dominionpower-mcp/` and is exposed as MCP tools. Background polling + browser-based TFA auth are preserved. Docker multi-stage build.

**Spec:** `docs/superpowers/specs/2026-06-22-dominion-mastra-mcp-design.md`

**Reference project:** `../weather-mcp/weather-mcp-mastra/` (same Mastra + MCPServer pattern)

---

## File Structure (final)

```
dominionpower-mcp/
├── src/
│   ├── mastra/
│   │   ├── index.ts                  # Mastra config with MCPServer + DominionService
│   │   └── lib/
│   │       └── dominion-service.ts    # Auth init → API client → poller → tools
│   ├── dominion/                      # Copied from root src/dominion/
│   │   ├── client.ts, auth.ts, session.ts, types.ts, const.ts
│   │   ├── endpoints/gigya.ts
│   │   └── parsers/{bill,usage,account,weather}.ts
│   ├── server/                        # Copied from root (NO routes.ts)
│   │   ├── cache.ts, poller.ts, reauth.ts
│   ├── auth-browser/                  # Copied from root
│   │   ├── login.ts, tfa.ts, api-proxy.ts, ui/
│   └── config.ts                      # Copied from root
├── package.json
├── Dockerfile
├── docker-compose.yml
├── tsconfig.json
├── .dockerignore
└── .env.example
```

---

## Phase 1 — Install dependencies

### Task 1.1: Update package.json and install

**Files:**
- Modify: `dominionpower-mcp/package.json`

Add production dependencies: `@mastra/mcp`, `playwright-chromium`, `pino`, `zod`.
Remove unused: `@mastra/duckdb`, `@mastra/evals`, `@mastra/libsql`, `@mastra/observability`, `@mastra/memory`.
Update scripts: add `typecheck`, `build` uses `--studio` flag.

- [x] **Step 1: Edit `package.json`**

Replace contents with:

```json
{
  "name": "dominionpower-mcp",
  "version": "1.0.0",
  "description": "Dominion Energy MCP Server — live energy data via Mastra",
  "type": "module",
  "engines": { "node": ">=22.13.0" },
  "scripts": {
    "dev": "mastra dev",
    "build": "mastra build --studio",
    "start": "mastra start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mastra/core": "^1.45.0",
    "@mastra/loggers": "^1.2.0",
    "@mastra/mcp": "^1.0.0",
    "pino": "^9.4.0",
    "playwright-chromium": "^1.49.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^26.0.0",
    "mastra": "^1.15.0",
    "typescript": "^6.0.3"
  }
}
```

- [x] **Step 2: Install**

Run in `dominionpower-mcp/`:
```
npm install
```

Expected: all deps installed, no errors.

- [x] **Step 3: Create `tsconfig.json`**

```
dominionpower-mcp/tsconfig.json
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

---

## Phase 2 — Move domain code

### Task 2.1: Copy `src/dominion/`

**Files copied:**
- `src/dominion/client.ts`
- `src/dominion/auth.ts`
- `src/dominion/session.ts`
- `src/dominion/types.ts`
- `src/dominion/const.ts`
- `src/dominion/endpoints/gigya.ts`
- `src/dominion/parsers/bill.ts`
- `src/dominion/parsers/usage.ts`
- `src/dominion/parsers/account.ts`
- `src/dominion/parsers/weather.ts`

**Target:** `dominionpower-mcp/src/dominion/`

- [x] **Step 1: Create directories**

```
mkdir -p dominionpower-mcp/src/dominion/endpoints
mkdir -p dominionpower-mcp/src/dominion/parsers
```

- [x] **Step 2: Copy dominion files**

Copy each file verbatim from root `src/dominion/` to `dominionpower-mcp/src/dominion/`.

### Task 2.2: Copy `src/server/` (minus routes.ts)

**Files copied:**
- `src/server/cache.ts`
- `src/server/poller.ts`
- `src/server/reauth.ts`

**NOT copied:** `src/server/routes.ts` (Fastify routes — replaced by MCP tools)

- [x] **Step 1: Create directory**

```
mkdir -p dominionpower-mcp/src/server
```

- [x] **Step 2: Copy server files**

### Task 2.3: Copy `src/auth-browser/`

**Files copied:**
- `src/auth-browser/login.ts`
- `src/auth-browser/tfa.ts`
- `src/auth-browser/api-proxy.ts`
- `src/auth-browser/ui/login.html`
- `src/auth-browser/ui/tfa.html`

- [x] **Step 1: Create directories**

```
mkdir -p dominionpower-mcp/src/auth-browser/ui
```

- [x] **Step 2: Copy files**

### Task 2.4: Copy `src/config.ts`

- [x] **Step 1: Copy `src/config.ts`** to `dominionpower-mcp/src/config.ts`

---

## Phase 3 — Create DominionService

### Task 3.1: Create `src/mastra/lib/dominion-service.ts`

This is the main container. It wires auth, the API client, background polling, and tool creation.

**Key behavior:**
- Constructor takes env config, session path, logger
- `initialize()` is blocking: loads session, if invalid runs auth-browser flow, creates DominionEnergyApi, starts Poller
- `getTools()` returns Record of MCP tools bound to the cache

```
dominionpower-mcp/src/mastra/lib/dominion-service.ts
```

- [x] **Step 1: Create file**

```ts
import { parseConfig, type AppConfig } from '../config.js';
import { PinoLogger } from 'pino';
import { loadSession, saveSession, type SessionStore } from '../dominion/session.js';
import { DominionEnergyApi } from '../dominion/client.js';
import { isAuthenticated, refreshAccessTokenIfNeeded, FullAuthRequiredError } from '../dominion/auth.js';
import { DataCache } from '../server/cache.js';
import { Poller } from '../server/poller.js';
import { ReauthHandler } from '../server/reauth.js';
import { ApiProxy } from '../auth-browser/api-proxy.js';
import { runLoginFlow } from '../auth-browser/login.js';
import { initiateTfa, completePhoneTfa, type TfaContext } from '../auth-browser/tfa.js';
import { gigyaLogin, dominionLoginAuth } from '../dominion/endpoints/gigya.js';
import { API_BASE_URL } from '../dominion/const.js';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ALL_SENSOR_KEYS, type SensorKey } from '../dominion/const.js';
import type { DominionEnergyData } from '../dominion/types.js';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class DominionService {
  config: AppConfig;
  logger: PinoLogger;
  sessionPath: string;
  store!: SessionStore;
  api!: DominionEnergyApi;
  cache: DataCache;
  poller!: Poller;
  reauthHandler!: ReauthHandler;
  apiProxy: ApiProxy;
  tfaContext: TfaContext | null = null;
  authServer: ReturnType<typeof createServer> | null = null;

  constructor() {
    this.config = parseConfig(process.env as Record<string, string>);
    this.logger = new PinoLogger({ name: 'dominion-mcp', level: this.config.logLevel as any });
    this.sessionPath = join(this.config.dataDir, 'session.json');
    this.cache = new DataCache();
    this.apiProxy = new ApiProxy();
  }

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
    this.api = new DominionEnergyApi(proxyFetch, this.store, (msg) => this.logger.info(msg));

    if (isAuthenticated(this.store)) {
      try {
        await refreshAccessTokenIfNeeded(proxyFetch, this.store, (msg) => this.logger.info(msg));
        this.logger.info('Session loaded and token refreshed');
      } catch (err) {
        if (err instanceof FullAuthRequiredError) {
          this.logger.warn('Token refresh failed — running full auth');
          await this.runAuthFlow();
        }
      }
    } else {
      this.logger.info('No valid session — running auth flow');
      await this.runAuthFlow();
    }

    await saveSession(this.sessionPath, this.store);
    await this.syncCookiesToProxy();

    this.poller = new Poller(this.api, this.cache, () => this.triggerReauth());
    this.poller.start();
  }

  private async syncCookiesToProxy(): Promise<void> {
    const cookies = this.store.cookies;
    if (Object.keys(cookies).length > 0) {
      try {
        await this.apiProxy.setCookies(cookies, API_BASE_URL);
      } catch (err) {
        this.logger.warn({ err }, 'Failed to sync cookies to API proxy');
      }
    }
  }

  private createProxyFetch(): typeof fetch {
    return async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const result = await this.apiProxy.fetch(url, {
        method: (init?.method as string) ?? 'GET',
        headers: init?.headers as Record<string, string> | undefined,
        body: init?.body as string | undefined,
      });
      return new Response(result.body, {
        status: result.status,
        headers: result.headers,
      });
    };
  }

  private async runAuthFlow(): Promise<void> {
    await this.apiProxy.ensureBrowser();
    const loginBrowser = this.apiProxy.getBrowserRef();
    const result = await runLoginFlow(
      this.config.username,
      this.config.password,
      loginBrowser ?? undefined,
    );
    this.store.uuid = result.uuid;
    this.store.cookies = result.cookies;
    if (this.config.accountNumber) this.store.customer_number = this.config.accountNumber;
    await saveSession(this.sessionPath, this.store);
    await this.syncCookiesToProxy();

    if (result.needsTfa) {
      this.tfaContext = { regToken: result.regToken ?? '', gmid: result.uuid };
      await initiateTfa(fetch, this.tfaContext);
      this.logger.info('TFA code sent. Starting auth server for code entry.');
      await this.startAuthServer();
      return;
    }

    const gigyaResult = await gigyaLogin(fetch, this.config.username, this.config.password);
    if (gigyaResult.needsTfa) {
      this.tfaContext = { regToken: gigyaResult.regToken ?? '', gmid: result.uuid };
      await initiateTfa(fetch, this.tfaContext);
      this.logger.info('TFA code sent. Starting auth server for code entry.');
      await this.startAuthServer();
      return;
    }

    try {
      const authResult = await dominionLoginAuth(
        this.apiProxy.fetch.bind(this.apiProxy),
        gigyaResult.id_token!,
        this.store.cookies,
      );
      this.store.token = authResult.token;
      this.store.refresh_token = authResult.refresh_token;
      this.store.token_expires = Math.floor(Date.now() / 1000) + 25;
      this.store.uuid = authResult.uuid;
      this.logger.info('Dominion auth successful');
    } catch (authErr) {
      this.logger.warn({ err: authErr }, 'Dominion login auth failed');
    }
  }

  private startAuthServer(): Promise<void> {
    return new Promise((resolve) => {
      const adminPort = parseInt(process.env.ADMIN_PORT || '8080', 10);
      const tfaPath = join(__dirname, '..', 'auth-browser', 'ui', 'tfa.html');

      this.authServer = createServer(async (req, res) => {
        if (req.method === 'GET' && req.url === '/admin/tfa') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(readFileSync(tfaPath, 'utf8'));
          return;
        }

        if (req.method === 'POST' && req.url === '/admin/tfa') {
          let body = '';
          req.on('data', (chunk) => { body += chunk; });
          req.on('end', async () => {
            try {
              const { code } = JSON.parse(body);
              const tfaResult = await completePhoneTfa(fetch, this.tfaContext!, code);
              const proxyFetch = this.createProxyFetch();
              const authResult = await dominionLoginAuth(
                this.apiProxy.fetch.bind(this.apiProxy),
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
              resolve();
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: (err as Error).message }));
            }
          });
          return;
        }

        res.writeHead(404);
        res.end();
      });

      this.authServer.listen(adminPort, '0.0.0.0', () => {
        this.logger.info(`TFA entry UI at http://localhost:${adminPort}/admin/tfa`);
        // Don't resolve yet — wait for POST
      });
    });
  }

  private triggerReauth(): void {
    this.logger.info('Reauth triggered — restarting auth flow');
    this.runAuthFlow()
      .then(() => this.poller.pollOnce())
      .catch((err) => this.logger.error({ err }, 'Reauth failed'));
  }

  async shutdown(): Promise<void> {
    this.poller?.stop();
    await saveSession(this.sessionPath, this.store);
    await this.apiProxy.close().catch(() => {});
  }

  getTools() {
    return {
      getSensors: createTool({
        id: 'get-sensors',
        description: 'Returns all Dominion Energy sensor values from the last poll. Includes 36 keys: grid consumption, solar generation, billing info, weather data, meter info, and more.',
        outputSchema: z.object({ data: z.record(z.unknown()).nullable(), error: z.string().optional() }),
        mcp: { annotations: { readOnlyHint: true } },
        execute: async () => {
          const data = this.cache.getData();
          if (!data) return { data: null, error: 'Data not yet available — poller has not completed' };
          return { data: data as unknown as Record<string, unknown> };
        },
      }),

      getSensor: createTool({
        id: 'get-sensor',
        description: 'Returns a single Dominion Energy sensor value by key. Valid keys match the sensor constants.',
        inputSchema: z.object({ key: z.string().describe('Sensor key (e.g. grid_consumption, current_bill, solar_generation)') }),
        outputSchema: z.object({ key: z.string(), value: z.unknown().nullable(), error: z.string().optional() }),
        mcp: { annotations: { readOnlyHint: true } },
        execute: async ({ key }) => {
          const data = this.cache.getData();
          if (!data) return { key, value: null, error: 'Data not yet available' };
          if (!ALL_SENSOR_KEYS.includes(key as SensorKey)) {
            return { key, value: null, error: `Unknown sensor: ${key}` };
          }
          return { key, value: (data as unknown as Record<string, unknown>)[key] ?? null };
        },
      }),

      getDailyUsage: createTool({
        id: 'get-daily-usage',
        description: 'Returns daily energy consumption data from the last poll.',
        outputSchema: z.object({ data: z.array(z.record(z.unknown())), error: z.string().optional() }),
        mcp: { annotations: { readOnlyHint: true } },
        execute: async () => {
          const data = this.cache.getData();
          if (!data) return { data: [], error: 'Data not yet available' };
          return { data: data.daily_consumption ?? [] };
        },
      }),

      getMonthlyUsage: createTool({
        id: 'get-monthly-usage',
        description: 'Returns monthly energy usage (electric + solar generation) from the last poll.',
        outputSchema: z.object({ monthly_usage: z.number().nullable(), error: z.string().optional() }),
        mcp: { annotations: { readOnlyHint: true } },
        execute: async () => {
          const data = this.cache.getData();
          if (!data) return { monthly_usage: null, error: 'Data not yet available' };
          return { monthly_usage: data.monthly_usage };
        },
      }),

      getBillHistory: createTool({
        id: 'get-bill-history',
        description: 'Returns historical bill data from the last poll.',
        outputSchema: z.object({ data: z.array(z.record(z.unknown())), error: z.string().optional() }),
        mcp: { annotations: { readOnlyHint: true } },
        execute: async () => {
          const data = this.cache.getData();
          if (!data) return { data: [], error: 'Data not yet available' };
          return { data: data.bill_history ?? [] };
        },
      }),

      getHealth: createTool({
        id: 'get-health',
        description: 'Returns the health status of the Dominion Energy MCP server — last poll time, error state, and authentication status.',
        outputSchema: z.object({
          status: z.string(),
          lastPollTime: z.number().nullable(),
          error: z.string().nullable(),
        }),
        mcp: { annotations: { readOnlyHint: true } },
        execute: async () => {
          return {
            status: 'ok',
            lastPollTime: this.cache.getLastPollTime(),
            error: this.cache.getError()?.message ?? null,
          };
        },
      }),
    };
  }
}
```

---

## Phase 4 — Create MCP tools

### Task 4.1: Create tool factory files (optional — may fold into service)

Tools are already defined inline in `DominionService.getTools()` above. If the file grows too large, extract each tool group into its own file under `src/mastra/tools/` following the reference project's `adapters/controllers/` pattern. For now, inline is sufficient.

- [x] **Step 1: Decide on extraction**

Keep tools inline in `DominionService.getTools()` for simplicity. Extract on next refactor if needed.

---

## Phase 5 — Wire Mastra config

### Task 5.1: Update `src/mastra/index.ts`

Replace the weather agent/workflow/scorer setup with Dominion MCP server.

- [x] **Step 1: Edit `src/mastra/index.ts`**

```ts
import { Mastra } from '@mastra/core/mastra';
import { MCPServer } from '@mastra/mcp';
import { PinoLogger } from '@mastra/loggers';
import { DominionService } from './lib/dominion-service.js';

const service = new DominionService();
await service.initialize();

const mcpServer = new MCPServer({
  id: 'dominion-energy',
  name: 'Dominion Energy',
  version: '1.0.0',
  description: 'Live Dominion Energy usage, billing, solar, and weather data',
  instructions:
    'Use these tools to get live Dominion Energy data including energy consumption, ' +
    'solar generation, billing information, weather data, and meter information. ' +
    'Data is refreshed every 12 hours from Dominion Energy\'s API.',
  tools: service.getTools(),
});

export const mastra = new Mastra({
  mcpServers: { dominionEnergy: mcpServer },
  server: {
    port: parseInt(process.env.PORT || '3456', 10),
    host: process.env.HOST || '0.0.0.0',
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: (process.env.LOG_LEVEL as any) || 'info',
  }),
});
```

- [x] **Step 2: Remove old weather files**

Remove: `src/mastra/agents/`, `src/mastra/workflows/`, `src/mastra/scorers/`, `src/mastra/tools/weather-tool.ts`.

---

## Phase 6 — Dockerize

### Task 6.1: Create Dockerfile

- [x] **Step 1: Create `dominionpower-mcp/Dockerfile`**

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2: Run (Playwright base for browser-based TFA auth)
FROM mcr.microsoft.com/playwright:v1.49.0-jammy
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/.mastra ./.mastra

VOLUME /data

EXPOSE 3456

HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://localhost:3456/health', r => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

ENV NODE_ENV=production
ENV PORT=3456
ENV HOST=0.0.0.0

ENV MASTRA_STUDIO_PATH=.mastra/output/studio
ENV MASTRA_AUTO_DETECT_URL=true
ENV MASTRA_MCP_HTTP=true

CMD ["node", ".mastra/output/index.mjs"]
```

Note: This Dockerfile needs Mastra's MCP+HTTP server to expose the `/health` endpoint. If Mastra doesn't provide one, we'll adjust the HEALTHCHECK to use the MCP protocol's `tools/call` for `get-health`, or add a separate health endpoint.

### Task 6.2: Create docker-compose.yml

- [x] **Step 1: Create `dominionpower-mcp/docker-compose.yml`**

```yaml
version: '3.8'
services:
  dominion-mcp:
    build: .
    ports:
      - "3456:3456"
      - "8080:8080"
    volumes:
      - ./data:/data
    env_file: .env
    environment:
      - PORT=3456
      - HOST=0.0.0.0
      - DATA_DIR=/data
      - LOG_LEVEL=${LOG_LEVEL:-info}
    restart: unless-stopped
```

### Task 6.3: Update .dockerignore and .env.example

- [x] **Step 1: Create `.dockerignore`**

```
node_modules
.mastra
dist
.git
.github
test
coverage
.vscode
.idea
*.log
.env
.env.local
data
README.md
docs
```

- [x] **Step 2: Update `.env.example`**

```
DOMINION_USERNAME=your-email@example.com
DOMINION_PASSWORD=your-password
DOMINION_ACCOUNT_NUMBER=your-12-digit-account-number
PORT=3456
DATA_DIR=/data
LOG_LEVEL=info
```

### Task 6.4: Update AGENTS.md

- [x] **Step 1: Edit `dominionpower-mcp/AGENTS.md`**

Update to reflect new project structure (remove weather references, describe Dominion MCP server).

---

## Phase 7 — Verify

### Task 7.1: TypeScript compilation

- [x] **Step 1: Run `npx tsc --noEmit`**

Fix any type errors.

### Task 7.2: Mastra build

- [x] **Step 1: Run `npm run build`**

Expected: generates `.mastra/output/index.mjs`

### Task 7.3: Clean up root project

- [x] **Step 1: Remove old files (optional)**

Root `src/dominion/`, `src/server/`, `src/auth-browser/`, `src/config.ts`, `src/index.ts` are no longer needed — they've been migrated. Remove them once the Mastra version is verified working.
