/**
 * HTTP transport (WiiM RPC, Luxsin X9). Request/response rather than stream;
 * network handlers use the richer request() API directly.
 */
import type { DataMeta, HttpTransport, Unsubscribe } from '@/core/transport';

export class FetchHttpTransport implements HttpTransport {
  readonly kind = 'http' as const;
  private dataCallbacks = new Set<(bytes: Uint8Array, meta?: DataMeta) => void>();
  private disconnectCallbacks = new Set<() => void>();

  constructor(readonly baseUrl: string) {}

  async open(): Promise<void> {
    // No persistent connection; nothing to do.
  }

  async close(): Promise<void> {
    for (const cb of this.disconnectCallbacks) cb();
  }

  async request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(new URL(path, this.baseUrl).toString(), init);
  }

  /** Stream-style write: POSTs bytes to the base URL and emits the response. */
  async write(bytes: Uint8Array): Promise<void> {
    const response = await this.request('', { method: 'POST', body: bytes.slice() });
    const body = new Uint8Array(await response.arrayBuffer());
    for (const cb of this.dataCallbacks) cb(body);
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
