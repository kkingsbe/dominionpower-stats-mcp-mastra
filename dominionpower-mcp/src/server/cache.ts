import type { DominionEnergyData } from '../dominion/types.js';

export class DataCache {
  private data: DominionEnergyData | null = null;
  private lastPollTime: number | null = null;
  private error: Error | null = null;

  getData(): DominionEnergyData | null {
    return this.data;
  }

  getLastPollTime(): number | null {
    return this.lastPollTime;
  }

  getError(): Error | null {
    return this.error;
  }

  update(data: DominionEnergyData): void {
    this.data = data;
    this.lastPollTime = Date.now();
    this.error = null;
  }

  setError(err: Error): void {
    this.error = err;
  }

  clearError(): void {
    this.error = null;
  }
}
