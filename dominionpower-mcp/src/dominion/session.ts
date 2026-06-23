import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import type { SessionData } from './types.js';

export type SessionStore = SessionData;

export async function loadSession(filePath: string): Promise<SessionStore | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    return JSON.parse(raw) as SessionStore;
  } catch {
    return null;
  }
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
