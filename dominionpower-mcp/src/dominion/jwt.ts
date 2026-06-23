export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const base64 = padded + '='.repeat(padLen);
    const json = Buffer.from(base64, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

export function jwtExpiry(
  token: string | null | undefined,
  fallbackSeconds: number = 30,
): number {
  if (!token) return 0;
  const claims = decodeJwtPayload(token);
  if (claims && typeof claims.exp === 'number') return claims.exp;
  return Math.floor(Date.now() / 1000) + fallbackSeconds;
}
