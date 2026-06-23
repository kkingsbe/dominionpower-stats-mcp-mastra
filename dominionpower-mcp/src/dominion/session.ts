import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import type { SessionData } from './types.js';
import { jwtExpiry } from './jwt.js';

export type SessionStore = SessionData;

export async function loadSession(filePath: string): Promise<SessionStore | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let store: SessionStore;
  try {
    store = JSON.parse(raw) as SessionStore;
  } catch {
    return null;
  }
  if (store.token) {
    const jwtExp = jwtExpiry(store.token);
    if (store.token_expires < jwtExp) {
      store.token_expires = jwtExp;
    }
  }
  return store;
}

export async function saveSession(filePath: string, store: SessionStore): Promise<void> {
  const json = JSON.stringify(store, null, 2);
  let current: string | undefined;
  try {
    current = await readFile(filePath, 'utf8');
  } catch {
    // file doesn't exist yet — proceed to write
  }
  if (current === json) return;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, json, 'utf8');
}
