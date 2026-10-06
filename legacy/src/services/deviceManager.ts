/**
 * DeviceManager: discover → match → open transport → resolve profile → bind
 * handler. The stores talk to this; handlers and transports stay decoupled.
 */
import type { Filter, PullResult, PushResult, ResolvedDeviceProfile } from '@/core/model/types';
import type { HandlerContext, ProtocolHandler, Transport } from '@/core/transport';
import { getHandler } from '@/core/handlers';
import { getRegistry } from '@/core/registry';
import { DemoTransport } from '@/transports/demo/demoTransport';
import { WebHidTransport } from '@/transports/web/webHidTransport';
import { listGrantedHidDevices, requestHidDevice, webHidSupported } from '@/transports/web/discovery';
import { logger } from './logger';

export interface ConnectionCandidate {
  key: string;
  label: string;
  transportKind: 'usb-hid' | 'demo';
  profiles: ResolvedDeviceProfile[];
  hidDevice?: HIDDevice;
}

export interface ActiveConnection {
  profile: ResolvedDeviceProfile;
  transport: Transport;
  handler: ProtocolHandler;
  ctx: HandlerContext;
}

export class DeviceManager {
  private connection: ActiveConnection | undefined;
  onDisconnected: (() => void) | undefined;

  get registry() {
    return getRegistry();
  }

  get active(): ActiveConnection | undefined {
    return this.connection;
  }

  /** Passively listable candidates: demo device + previously-granted HID. */
  async listCandidates(): Promise<ConnectionCandidate[]> {
    const candidates: ConnectionCandidate[] = this.registry.matchDemo().map((profile) => ({
      key: `demo:${profile.id}`,
      label: profile.name,
      transportKind: 'demo' as const,
      profiles: [profile],
    }));
    if (webHidSupported()) {
      for (const { device, candidates: profiles } of await listGrantedHidDevices(this.registry)) {
        candidates.push({
          key: `hid:${device.vendorId}:${device.productId}:${device.productName}`,
          label: device.productName || profiles[0].name,
          transportKind: 'usb-hid',
          profiles,
          hidDevice: device,
        });
      }
    }
    return candidates;
  }

  /** Browser picker (must be called from a user gesture). */
  async requestNewHidDevice(): Promise<ConnectionCandidate | undefined> {
    const discovered = await requestHidDevice(this.registry);
    if (!discovered) return undefined;
    if (discovered.candidates.length === 0) {
      throw new Error(`No device DB entry matches "${discovered.device.productName}"`);
    }
    return {
      key: `hid:${discovered.device.vendorId}:${discovered.device.productId}:${discovered.device.productName}`,
      label: discovered.device.productName,
      transportKind: 'usb-hid',
      profiles: discovered.candidates,
      hidDevice: discovered.device,
    };
  }

  /**
   * Connect a candidate. When several profiles match, `profileId` picks one
   * (UI shows a disambiguation sheet); defaults to the best match.
   */
  async connect(candidate: ConnectionCandidate, profileId?: string): Promise<ActiveConnection> {
    await this.disconnect();
    const profile = profileId
      ? candidate.profiles.find((p) => p.id === profileId) ?? candidate.profiles[0]
      : candidate.profiles[0];

    let transport: Transport;
    if (candidate.transportKind === 'demo') {
      transport = new DemoTransport();
    } else {
      if (!candidate.hidDevice) throw new Error('HID candidate has no device handle');
      transport = new WebHidTransport(candidate.hidDevice);
    }

    await transport.open();
    const handler = getHandler(profile.handlerId);
    const ctx: HandlerContext = { transport, profile, log: logger };
    this.connection = { profile, transport, handler, ctx };
    transport.onDisconnect(() => {
      if (this.connection?.transport === transport) {
        this.connection = undefined;
        this.onDisconnected?.();
      }
    });
    logger.info(`Connected: ${profile.name} (${profile.handlerId} over ${transport.kind})`);
    return this.connection;
  }

  async disconnect(): Promise<void> {
    if (!this.connection) return;
    const { transport, profile } = this.connection;
    this.connection = undefined;
    try {
      await transport.close();
    } catch (e) {
      logger.warn(`Error closing transport for ${profile.name}:`, (e as Error).message);
    }
  }

  private require(): ActiveConnection {
    if (!this.connection) throw new Error('No device connected');
    return this.connection;
  }

  async getCurrentSlot(): Promise<number> {
    const { handler, ctx } = this.require();
    return handler.getCurrentSlot(ctx);
  }

  async pull(slot: number): Promise<PullResult> {
    const { handler, ctx } = this.require();
    return handler.pullFromDevice(ctx, slot);
  }

  async push(slot: number, pregain: number, filters: Filter[]): Promise<PushResult> {
    const { handler, ctx } = this.require();
    const result = await handler.pushToDevice(ctx, slot, pregain, filters);
    if (result.deviceWillDisconnect) {
      logger.info(`${ctx.profile.name} disconnects after save (disconnectOnSave)`);
      await this.disconnect();
      this.onDisconnected?.();
    }
    return result;
  }

  async enablePEQ(enabled: boolean, slotId: number): Promise<void> {
    const { handler, ctx } = this.require();
    return handler.enablePEQ(ctx, enabled, slotId);
  }
}

export const deviceManager = new DeviceManager();
