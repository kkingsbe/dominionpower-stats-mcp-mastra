import { chromium, type Browser, type Page } from 'playwright-chromium';
import { LOGIN_URL } from '../dominion/const.js';

export interface LoginResult {
  uuid: string;
  cookies: Record<string, string>;
  needsTfa: boolean;
  regToken?: string;
  browser?: Browser;
}

async function captureLoginResponse(
  page: Page,
): Promise<{ data: Record<string, unknown>; gmid: string } | null> {
  return new Promise((resolve) => {
    const handler = (response: { url: () => string; status: () => number; json: () => Promise<Record<string, unknown>>; request: () => { headers: () => Record<string, string> } }) => {
      if (response.url().includes('accounts.login')) {
        const cookieHeader = response.request().headers()['Cookie'] ?? '';
        const gmidMatch = cookieHeader.match(/gmid=([^;]+)/);
        const gmid = gmidMatch?.[1] ?? '';
        response.json().then((data) => {
          resolve({ data, gmid });
        }).catch(() => {
          resolve(null);
        });
      }
    };
    page.on('response', handler);
    setTimeout(() => {
      page.removeListener('response', handler);
      resolve(null);
    }, 60000);
  });
}

export async function runLoginFlow(
  username: string,
  password: string,
  browser?: Browser,
): Promise<LoginResult> {
  const ownBrowser = !browser;
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox'],
    });
  }
  try {
    const page: Page = await browser.newPage();

    const loginResponsePromise = captureLoginResponse(page);

    await page.goto(`${LOGIN_URL}?SelectedAppName=Electric`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    await page.waitForSelector('input[placeholder*="Email"]', { timeout: 15000 });

    await page.fill('input[placeholder*="Email"]', username);
    await page.fill('input[placeholder*="Password"]', password);

    await page.keyboard.press('Enter');

    const loginResponse = await loginResponsePromise;

    const cookies = await page.context().cookies();
    const cookieMap: Record<string, string> = {};
    for (const c of cookies) cookieMap[c.name] = c.value;

    if (loginResponse) {
      const { data, gmid } = loginResponse;
      const gmidCookie = cookies.find((c) => c.name === 'gmid');
      const uuid = gmidCookie?.value ?? gmid;

      if ((data as any).errorCode === 403101) {
        return {
          uuid,
          cookies: cookieMap,
          needsTfa: true,
          regToken: (data as any).regToken as string,
          ...(ownBrowser ? {} : { browser }),
        };
      }

      return {
        uuid,
        cookies: cookieMap,
        needsTfa: false,
        ...(ownBrowser ? {} : { browser }),
      };
    }

    return {
      uuid: '',
      cookies: cookieMap,
      needsTfa: false,
      ...(ownBrowser ? {} : { browser }),
    };
  } finally {
    if (ownBrowser) {
      await browser.close();
    }
  }
}
