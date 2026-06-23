import { parseConfig, type AppConfig } from '../../config.js';
import { loadSession, saveSession, type SessionStore } from '../../dominion/session.js';
import { DominionEnergyApi } from '../../dominion/client.js';
import { isAuthenticated, refreshAccessTokenIfNeeded, FullAuthRequiredError } from '../../dominion/auth.js';
import { DataCache } from '../../server/cache.js';
import { Poller } from '../../server/poller.js';
import { ApiProxy } from '../../auth-browser/api-proxy.js';
import { runLoginFlow } from '../../auth-browser/login.js';
import { initiateTfa, completePhoneTfa, type TfaContext } from '../../auth-browser/tfa.js';
import { TFA_HTML } from '../../auth-browser/ui/tfa-template.js';
import { gigyaLogin, dominionLoginAuth } from '../../dominion/endpoints/gigya.js';
import { ALL_SENSOR_KEYS, API_BASE_URL, type SensorKey } from '../../dominion/const.js';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createServer, type Server } from 'http';
import { join } from 'path';

export class DominionService {
  config: AppConfig;
  sessionPath: string;
  store!: SessionStore;
  api!: DominionEnergyApi;
  cache: DataCache;
  poller!: Poller;
  apiProxy: ApiProxy;
  tfaContext: TfaContext | null = null;
  authServer: Server | null = null;
  logger: (msg: string) => void;
  private running = false;

  constructor() {
    this.config = parseConfig(process.env as Record<string, string>);
    this.sessionPath = join(this.config.dataDir, 'session.json');
    this.cache = new DataCache();
    this.apiProxy = new ApiProxy();
    this.logger = (msg: string) => console.log(`[dominion-mcp] ${msg}`);
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

  private startPoller(): void {
    this.poller = new Poller(this.api, this.cache, () => this.triggerReauth());
    this.poller.start();
    this.logger('Poller started');
  }

  private async syncCookiesToProxy(): Promise<void> {
    const cookies = this.store.cookies;
    if (Object.keys(cookies).length > 0) {
      try {
        await this.apiProxy.setCookies(cookies, API_BASE_URL);
      } catch (err) {
        this.logger(`Failed to sync cookies: ${(err as Error).message}`);
      }
    }
  }

  private createProxyFetch(): typeof fetch {
    return async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
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
    this.tfaContext = null;
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
      this.logger('TFA code sent. Starting auth server for code entry.');
      this.startAuthServer();
      return;
    }

    const gigyaResult = await gigyaLogin(fetch, this.config.username, this.config.password);
    if (gigyaResult.needsTfa) {
      this.tfaContext = { regToken: gigyaResult.regToken ?? '', gmid: gigyaResult.gmid ?? result.uuid };
      await initiateTfa(fetch, this.tfaContext);
      this.logger('TFA code sent. Starting auth server for code entry.');
      this.startAuthServer();
      return;
    }

    if (gigyaResult.id_token) {
      try {
        const proxyFetch = this.createProxyFetch();
        const authResult = await dominionLoginAuth(
          proxyFetch,
          gigyaResult.id_token,
          this.store.cookies,
        );
        this.store.token = authResult.token;
        this.store.refresh_token = authResult.refresh_token;
        this.store.token_expires = Math.floor(Date.now() / 1000) + 25;
        this.store.uuid = authResult.uuid;
        this.logger('Dominion auth successful');
        await saveSession(this.sessionPath, this.store);
        this.startPoller();
      } catch (authErr) {
        this.logger(`Dominion login auth failed: ${(authErr as Error).message}`);
      }
    }
  }

  private startAuthServer(): void {
    if (this.authServer) {
      this.authServer.close();
      this.authServer = null;
    }
    const adminPort = parseInt(process.env.ADMIN_PORT || '8080', 10);

    this.authServer = createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/admin/tfa') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(TFA_HTML);
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

      res.writeHead(404);
      res.end();
    });

    this.authServer.listen(adminPort, '0.0.0.0', () => {
      this.logger(`TFA entry UI at http://localhost:${adminPort}/admin/tfa`);
    });
  }

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
        outputSchema: z.object({ data: z.any().nullable(), error: z.string().optional() }),
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
        outputSchema: z.object({ data: z.array(z.any()), error: z.string().optional() }),
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
        outputSchema: z.object({ data: z.array(z.any()), error: z.string().optional() }),
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
