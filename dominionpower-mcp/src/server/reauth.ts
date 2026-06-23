export class ReauthHandler {
  private running = false;

  constructor(
    private readonly launchBrowser: () => void,
    private readonly onComplete: () => void,
  ) {}

  trigger(): void {
    if (this.running) return;
    this.running = true;
    this.launchBrowser();
  }

  complete(): void {
    this.running = false;
    this.onComplete();
  }
}
