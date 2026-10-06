/**
 * WebHID-backed HidTransport (desktop Chrome/Edge).
 * Discovery/permission (navigator.hid.requestDevice) lives in discovery.ts —
 * this class only wraps an already-granted HIDDevice.
 */
import type { DataMeta, HidTransport, Unsubscribe } from '@/core/transport';

export class WebHidTransport implements HidTransport {
  readonly kind = 'usb-hid' as const;
  private dataCallbacks = new Set<(bytes: Uint8Array, meta?: DataMeta) => void>();
  private disconnectCallbacks = new Set<() => void>();
  private inputListener = (event: HIDInputReportEvent) => {
    const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    for (const cb of this.dataCallbacks) cb(bytes, { reportId: event.reportId });
  };

  constructor(readonly device: HIDDevice) {
    navigator.hid.addEventListener('disconnect', (event) => {
      if (event.device === this.device) {
        for (const cb of this.disconnectCallbacks) cb();
      }
    });
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    this.device.addEventListener('inputreport', this.inputListener);
  }

  async close(): Promise<void> {
    this.device.removeEventListener('inputreport', this.inputListener);
    if (this.device.opened) await this.device.close();
  }

  async write(bytes: Uint8Array, opts?: { reportId?: number }): Promise<void> {
    await this.sendReport(opts?.reportId ?? 0, bytes);
  }

  async sendReport(reportId: number, data: Uint8Array): Promise<void> {
    // .slice() pins the backing store to ArrayBuffer (BufferSource excludes SharedArrayBuffer views)
    await this.device.sendReport(reportId, data.slice());
  }

  async sendFeatureReport(reportId: number, data: Uint8Array): Promise<void> {
    await this.device.sendFeatureReport(reportId, data.slice());
  }

  async receiveFeatureReport(reportId: number): Promise<Uint8Array> {
    const view = await this.device.receiveFeatureReport(reportId);
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
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
