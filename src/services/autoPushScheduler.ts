/**
 * Debounced auto-push. Coalesces edits: only the latest state is pushed, and
 * a push in flight defers the next one until it finishes.
 */
export type SyncStatus = 'idle' | 'editing' | 'pending' | 'pushing' | 'synced' | 'error';

export class AutoPushScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pushInFlight = false;
  private dirtyWhilePushing = false;
  private enabled = true;

  constructor(
    private pushFn: () => Promise<void>,
    private onStatus: (status: SyncStatus) => void,
    public delayMs = 1500,
  ) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancel();
  }

  /** Call on every EQ edit. */
  notifyChange(): void {
    if (!this.enabled) {
      this.onStatus('editing');
      return;
    }
    this.onStatus('pending');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      // Status already flips to 'error' inside firePush; avoid unhandled rejection.
      this.firePush().catch(() => undefined);
    }, this.delayMs);
  }

  /** Immediate push (manual-save mode or "push now"). */
  async pushNow(): Promise<void> {
    this.cancel();
    await this.firePush();
  }

  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private async firePush(): Promise<void> {
    if (this.pushInFlight) {
      this.dirtyWhilePushing = true;
      return;
    }
    this.pushInFlight = true;
    this.onStatus('pushing');
    try {
      await this.pushFn();
      if (this.dirtyWhilePushing) {
        this.dirtyWhilePushing = false;
        this.pushInFlight = false;
        await this.firePush();
        return;
      }
      this.onStatus('synced');
    } catch (e) {
      this.onStatus('error');
      throw e;
    } finally {
      this.pushInFlight = false;
    }
  }
}
