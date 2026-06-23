import { z } from 'zod';

const configSchema = z.object({
  DOMINION_USERNAME: z.string().min(1),
  DOMINION_PASSWORD: z.string().min(1),
  DOMINION_ACCOUNT_NUMBER: z.string().min(1),
  PORT: z.coerce.number().int().nonnegative().default(8080),
  DATA_DIR: z.string().default('/data'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export interface AppConfig {
  username: string;
  password: string;
  accountNumber: string;
  port: number;
  dataDir: string;
  logLevel: string;
}

export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = configSchema.parse(env);
  return {
    username: parsed.DOMINION_USERNAME,
    password: parsed.DOMINION_PASSWORD,
    accountNumber: parsed.DOMINION_ACCOUNT_NUMBER,
    port: parsed.PORT,
    dataDir: parsed.DATA_DIR,
    logLevel: parsed.LOG_LEVEL,
  };
}
