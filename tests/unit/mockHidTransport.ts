/**
 * MockTransport for handler tests: records every sent report and replies via
 * a scripted responder (responses keyed by command byte, like the devicePEQ
 * sequence-mode captures).
 */
import type { DataMeta, HidTransport, Unsubscribe } from '@/core/transport';

export interface SentReport {
  reportId: number;
  data: number[];
}

export type Responder = (reportId: number, data: Uint8Array) => number[][] | undefined;

export class MockHidTransport implements HidTransport {
  readonly kind = 'usb-hid' as const;
  sent: SentReport[] = [];
  private dataCallbacks = new Set<(bytes: Uint8Array, meta?: DataMeta) => void>();
  private disconnectCallbacks = new Set<() => void>();

  constructor(private responder: Responder = () => undefined) {}

  async open(): Promise<void> {}
  async close(): Promise<void> {
    for (const cb of this.disconnectCallbacks) cb();
  }

  async write(bytes: Uint8Array, opts?: { reportId?: number }): Promise<void> {
    await this.sendReport(opts?.reportId ?? 0, bytes);
  }

  async sendReport(reportId: number, data: Uint8Array): Promise<void> {
    this.sent.push({ reportId, data: Array.from(data) });
    const responses = this.responder(reportId, data);
    if (!responses) return;
    for (const response of responses) {
      // Deliver async like a real input report.
      setTimeout(() => {
        for (const cb of this.dataCallbacks) cb(new Uint8Array(response), { reportId });
      }, 0);
    }
  }

  async sendFeatureReport(): Promise<void> {
    throw new Error('not implemented in mock');
  }

  async receiveFeatureReport(): Promise<Uint8Array> {
    throw new Error('not implemented in mock');
  }

  onData(cb: (bytes: Uint8Array, meta?: DataMeta) => void): Unsubscribe {
    this.dataCallbacks.add(cb);
    return () => this.dataCallbacks.delete(cb);
  }

  onDisconnect(cb: () => void): Unsubscribe {
    this.disconnectCallbacks.add(cb);
    return () => this.disconnectCallbacks.delete(cb);
  }
}
