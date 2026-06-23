import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-chromium';

export class ApiProxy {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async adoptBrowser(browser: Browser): Promise<void> {
    await this.close();
    this.browser = browser;
    const contexts = browser.contexts();
    this.context = contexts[0] ?? await browser.newContext();
    const pages = this.context.pages();
    this.page = pages[0] ?? await this.context.newPage();
  }

  async ensureBrowser(): Promise<{ context: BrowserContext; page: Page }> {
    if (this.page && this.context) {
      return { context: this.context, page: this.page };
    }
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    this.page = await this.context.newPage();
    await this.page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    return { context: this.context, page: this.page };
  }

  async setCookies(cookies: Record<string, string>, url: string): Promise<void> {
    const { context } = await this.ensureBrowser();
    const parsed = new URL(url);
    const existing = await context.cookies(parsed.origin);
    const existingNames = new Set(existing.map((c) => c.name));
    const toAdd = Object.entries(cookies)
      .filter(([name]) => !existingNames.has(name))
      .map(([name, value]) => ({
        name,
        value,
        domain: parsed.hostname,
        path: '/',
      }));
    if (toAdd.length > 0) {
      await context.addCookies(toAdd);
    }
  }

  async fetch(url: string, options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; body: string; headers: Record<string, string> }> {
    const { page } = await this.ensureBrowser();

    const reqHeaders = { ...(options?.headers ?? {}) };
    delete reqHeaders['Cookie'];
    delete reqHeaders['cookie'];

    try {
      return await page.evaluate(async (args) => {
        const res = await fetch(args.url, {
          method: args.options?.method ?? 'GET',
          headers: args.options?.headers ?? {},
          body: args.options?.body,
        });
        const headers: Record<string, string> = {};
        res.headers.forEach((value, key) => { headers[key] = value; });
        return { status: res.status, body: await res.text(), headers };
      }, { url, options: { ...options, headers: reqHeaders } });
    } catch {
      // Fallback: direct Node.js fetch (may get Incapsula without proper TLS fingerprint)
      const res = await globalThis.fetch(url, {
        method: options?.method ?? 'GET',
        headers: options?.headers ?? {},
        body: options?.body,
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => { headers[key] = value; });
      return { status: res.status, body: await res.text(), headers };
    }
  }

  getBrowserRef(): Browser | null {
    return this.browser;
  }

  async close(): Promise<void> {
    if (this.page) await this.page.close().catch(() => {});
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}
