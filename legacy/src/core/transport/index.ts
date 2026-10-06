/**
 * Transport interfaces only — implementations live in src/transports/.
 * Handlers receive an already-open Transport of the correct subtype;
 * they never discover or open devices themselves.
 */
import type { Logger, ResolvedDeviceProfile, TransportKind } from '../model/types';

export type Unsubscribe = () => void;

export interface DataMeta {
  reportId?: number;
}

export interface WriteOptions {
  reportId?: number;
}

export interface Transport {
  readonly kind: TransportKind;
  open(): Promise<void>;
  close(): Promise<void>;
  write(bytes: Uint8Array, opts?: WriteOptions): Promise<void>;
  onData(cb: (bytes: Uint8Array, meta?: DataMeta) => void): Unsubscribe;
  onDisconnect(cb: () => void): Unsubscribe;
}

/** Report-oriented HID devices (FiiO / Walkplay / KTMicro / Moondrop / …). */
export interface HidTransport extends Transport {
  readonly kind: 'usb-hid' | 'demo';
  sendReport(reportId: number, data: Uint8Array): Promise<void>;
  sendFeatureReport(reportId: number, data: Uint8Array): Promise<void>;
  receiveFeatureReport(reportId: number): Promise<Uint8Array>;
}

export interface SerialOpenOptions {
  baudRate?: number;
}

export interface SerialTransport extends Transport {
  readonly kind: 'usb-serial' | 'spp';
}

export interface HttpTransport extends Transport {
  readonly kind: 'http';
  request(path: string, init?: RequestInit): Promise<Response>;
}

export interface ProtocolHandler {
  getCurrentSlot(ctx: HandlerContext): Promise<number>;
  pullFromDevice(ctx: HandlerContext, slot: number): Promise<import('../model/types').PullResult>;
  pushToDevice(
    ctx: HandlerContext,
    slot: number,
    pregain: number,
    filters: import('../model/types').Filter[],
  ): Promise<import('../model/types').PushResult>;
  enablePEQ(ctx: HandlerContext, enabled: boolean, slotId: number): Promise<void>;
}

export interface HandlerContext {
  transport: Transport;
  profile: ResolvedDeviceProfile;
  log: Logger;
}
