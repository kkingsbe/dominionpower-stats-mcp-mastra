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
    if (err instanceof DominionEnergyAuthError) {
      throw new FullAuthRequiredError(err.message);
    }
    throw err;
  }
}

export class FullAuthRequiredError extends DominionEnergyAuthError {
  override readonly name = 'FullAuthRequiredError';
}
