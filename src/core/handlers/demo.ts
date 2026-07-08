/**
 * Demo protocol handler for the virtual demo device.
 * Talks the same JSON-over-bytes protocol the DemoTransport implements, so
 * the whole handler → transport pipeline is exercised without hardware.
 */
import type { Filter, PullResult, PushResult } from '../model/types';
import type { HandlerContext, ProtocolHandler } from '../transport';

interface DemoRequest {
  op: 'getSlot' | 'pull' | 'push' | 'enable';
  slot?: number;
  pregain?: number;
  filters?: Filter[];
  enabled?: boolean;
}

interface DemoResponse {
  op: string;
  slot?: number;
  pregain?: number;
  filters?: Filter[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function exchange(ctx: HandlerContext, request: DemoRequest): Promise<DemoResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Demo device did not respond'));
    }, 2000);
    const unsubscribe = ctx.transport.onData((bytes) => {
      const response = JSON.parse(decoder.decode(bytes)) as DemoResponse;
      if (response.op === request.op) {
        clearTimeout(timer);
        unsubscribe();
        resolve(response);
      }
    });
    void ctx.transport.write(encoder.encode(JSON.stringify(request)));
  });
}

export const demoHandler: ProtocolHandler = {
  async getCurrentSlot(ctx: HandlerContext): Promise<number> {
    const response = await exchange(ctx, { op: 'getSlot' });
    return response.slot ?? 0;
  },

  async pullFromDevice(ctx: HandlerContext, slot: number): Promise<PullResult> {
    const response = await exchange(ctx, { op: 'pull', slot });
    return { filters: response.filters ?? [], globalGain: response.pregain ?? 0 };
  },

  async pushToDevice(ctx: HandlerContext, slot: number, pregain: number, filters: Filter[]): Promise<PushResult> {
    await exchange(ctx, { op: 'push', slot, pregain, filters });
    return { deviceWillDisconnect: false };
  },

  async enablePEQ(ctx: HandlerContext, enabled: boolean, slot: number): Promise<void> {
    await exchange(ctx, { op: 'enable', enabled, slot });
  },
};
