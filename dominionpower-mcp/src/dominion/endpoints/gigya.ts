import type { SessionData } from '../types.js';
import { DominionEnergyAuthError, DominionEnergyApiError } from '../types.js';
import { AUTH_API_BASE_URL, GIGYA_API_KEY, GIGYA_AUTH_URL, GIGYA_LOGIN_ENDPOINT, GIGYA_HEADERS, GIGYA_ERROR_TFA_REQUIRED } from '../const.js';

export interface TokenRefreshResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

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

export interface DominionLoginResult {
  uuid: string;
  token: string;
  refresh_token: string;
}

export interface GigyaLoginResult {
  id_token?: string;
  needsTfa: boolean;
  regToken?: string;
  gmid?: string;
}

function extractGmid(res: Response): string | undefined {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return undefined;
  const match = setCookie.match(/gmid=([^;]+)/);
  return match?.[1];
}

export async function gigyaLogin(
  fetchFn: typeof fetch,
  loginID: string,
  password: string,
): Promise<GigyaLoginResult> {
  const url = `${GIGYA_AUTH_URL}${GIGYA_LOGIN_ENDPOINT}`;
  const body = new URLSearchParams({
    apiKey: GIGYA_API_KEY,
    loginID,
    password,
    loginMode: 'id_token',
    format: 'json',
  });
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { ...GIGYA_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new DominionEnergyAuthError(`Gigya login failed: ${res.status}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const gmid = extractGmid(res);
  if (data.errorCode !== 0) {
    if (data.errorCode === GIGYA_ERROR_TFA_REQUIRED) {
      return { needsTfa: true, regToken: (data.regToken as string) ?? undefined, gmid };
    }
    throw new DominionEnergyAuthError(`Gigya login failed: ${(data.errorDetails as string) ?? data.errorMessage as string}`);
  }
  const idToken = data.id_token as string;
  if (!idToken) {
    throw new DominionEnergyAuthError('No id_token in Gigya response');
  }
  return { id_token: idToken, needsTfa: false, gmid };
}

export async function dominionLoginAuth(
  fetchFn: typeof fetch,
  idToken: string,
  cookies?: Record<string, string>,
): Promise<DominionLoginResult> {
  const url = `${AUTH_API_BASE_URL}/Login/auth`;
  const e2eId = crypto.randomUUID();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${idToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://myaccount.dominionenergy.com',
    Referer: 'https://myaccount.dominionenergy.com/',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'e2eid': e2eId,
    'st': 'PL',
    'uid': '1',
    'pt': '',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
  };
  if (cookies) {
    const cookieEntries = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookieEntries) {
      headers.Cookie = cookieEntries;
    }
  }
  const payload = {
    username: '',
    password: '',
    guestToken: idToken,
    customattributes: {
      client: '',
      version: '',
      deviceId: '',
      deviceName: '',
      os: '',
    },
  };
  const res = await fetchFn(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new DominionEnergyAuthError(
      `Dominion login auth failed: ${res.status}`,
    );
  }
  const data = (await res.json()) as Record<string, unknown>;
  if ((data as any)?.status?.code !== 200) {
    throw new DominionEnergyAuthError(
      `Dominion login auth rejected: ${JSON.stringify(data).slice(0, 300)}`,
    );
  }
  const responseData = (data as any).data as Record<string, unknown> | undefined;
  const userInfo = (responseData?.user as Record<string, unknown>) ?? {};
  return {
    uuid: (userInfo.uuid as string) ?? '',
    token: ((responseData?.accessToken as string) ?? '') as string,
    refresh_token: ((responseData?.refreshToken as string) ?? '') as string,
  };
}
