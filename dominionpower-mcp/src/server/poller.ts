import type { DominionEnergyApi } from '../dominion/client.js';
import { DataCache } from './cache.js';
import { FullAuthRequiredError } from '../dominion/auth.js';

export class Poller {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly api: DominionEnergyApi,
    private readonly cache: DataCache,
    private readonly onReauth: () => void,
    private readonly intervalMs: number = 12 * 60 * 60 * 1000,
  ) {}

  start(): void {
    this.pollOnce();
    this.intervalId = setInterval(() => this.pollOnce(), this.intervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async pollOnce(): Promise<void> {
    try {
      const data = await this.api.getAllData();
      this.cache.update(data);
    } catch (err) {
      if (err instanceof FullAuthRequiredError) {
        this.onReauth();
      } else {
        this.cache.setError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }
}
