/**
 * Virtual demo device: a Transport whose "device" is an in-memory PEQ with
 * three user slots. Lets the whole app run with zero hardware and exercises
 * the same handler → transport pipeline as real devices.
 */
import type { DataMeta, Transport, Unsubscribe } from '@/core/transport';
import type { Filter } from '@/core/model/types';

interface DemoSlotState {
  filters: Filter[];
  pregain: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function defaultFilters(): Filter[] {
  return [
    { type: 'PK', freq: 62, gain: 2, q: 0.8, enabled: true },
    { type: 'PK', freq: 250, gain: -1.5, q: 1.4, enabled: true },
    { type: 'PK', freq: 2000, gain: 1, q: 1, enabled: true },
    { type: 'HSQ', freq: 8000, gain: -2, q: 0.7, enabled: true },
  ];
}

export class DemoTransport implements Transport {
  readonly kind = 'demo' as const;
  private dataCallbacks = new Set<(bytes: Uint8Array, meta?: DataMeta) => void>();
  private disconnectCallbacks = new Set<() => void>();
  private slots = new Map<number, DemoSlotState>();
  private currentSlot = 1;
  private opened = false;

  constructor() {
    this.slots.set(1, { filters: defaultFilters(), pregain: -2 });
    this.slots.set(2, { filters: [], pregain: 0 });
    this.slots.set(3, { filters: [], pregain: 0 });
  }

  async open(): Promise<void> {
    this.opened = true;
  }

  async close(): Promise<void> {
    this.opened = false;
    for (const cb of this.disconnectCallbacks) cb();
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.opened) throw new Error('Demo transport not open');
    const request = JSON.parse(decoder.decode(bytes));
    // Simulate device latency so auto-push status transitions are visible.
    await new Promise((resolve) => setTimeout(resolve, 120));
    let response: Record<string, unknown>;
    switch (request.op) {
      case 'getSlot':
        response = { op: 'getSlot', slot: this.currentSlot };
        break;
      case 'pull': {
        const slot = this.slots.get(request.slot) ?? { filters: [], pregain: 0 };
        response = { op: 'pull', filters: slot.filters, pregain: slot.pregain };
        break;
      }
      case 'push':
        this.slots.set(request.slot, { filters: request.filters, pregain: request.pregain });
        this.currentSlot = request.slot;
        response = { op: 'push', slot: request.slot };
        break;
      case 'enable':
        if (request.enabled) this.currentSlot = request.slot;
        response = { op: 'enable' };
        break;
      default:
        response = { op: 'error', message: `unknown op ${request.op}` };
    }
    const payload = encoder.encode(JSON.stringify(response));
    for (const cb of this.dataCallbacks) cb(payload);
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
