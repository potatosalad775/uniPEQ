import { describe, expect, it } from 'vitest';
import { BridgeError, guessProtocol, openDevice } from '@potatosalad775/eqcaps-device-bridge';
import type { DeviceIoPlugin, NativeUsbDevice } from '@/transports/native/deviceIo';
import { parseReportDescriptor } from '@/transports/native/hidReportDescriptor';
import { openNativeHid } from '@/transports/native/nativeHidTransport';

// Vendor collection with report 0x4B (63-byte input and output), the shape walkplay dongles
// use, plus a consumer-control collection with report 1 (one byte of key bits).
const WALKPLAY_DESCRIPTOR = [
  0x06, 0x00, 0xff, 0x09, 0x01, 0xa1, 0x01,
  0x85, 0x4b, 0x15, 0x00, 0x26, 0xff, 0x00, 0x75, 0x08, 0x95, 0x3f,
  0x09, 0x01, 0x81, 0x02,
  0x09, 0x01, 0x91, 0x02,
  0xc0,
  0x05, 0x0c, 0x09, 0x01, 0xa1, 0x01,
  0x85, 0x01, 0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x08,
  0x09, 0xe9, 0x09, 0xea, 0x81, 0x02,
  0xc0,
];

const b64 = (bytes: ArrayLike<number>) => btoa(String.fromCharCode(...Array.from(bytes)));
const unb64 = (data: string) => Array.from(atob(data), (c) => c.charCodeAt(0));

describe('parseReportDescriptor', () => {
  it('reads collections, report ids and sizes', () => {
    const parsed = parseReportDescriptor(WALKPLAY_DESCRIPTOR);
    expect(parsed.numbered).toBe(true);
    expect(parsed.collections).toEqual([
      {
        usagePage: 0xff00,
        usage: 1,
        inputReports: [{ reportId: 0x4b, size: 63 }],
        outputReports: [{ reportId: 0x4b, size: 63 }],
        featureReports: [],
        children: [],
      },
      {
        usagePage: 0x0c,
        usage: 1,
        inputReports: [{ reportId: 1, size: 1 }],
        outputReports: [],
        featureReports: [],
        children: [],
      },
    ]);
    expect(parsed.sizes.output.get(0x4b)).toBe(63);
  });

  it('handles unnumbered reports, nested collections and push/pop', () => {
    const parsed = parseReportDescriptor([
      0x06, 0xa0, 0xff, 0x09, 0x01, 0xa1, 0x01, // vendor 0xFFA0 application
      0x09, 0x02, 0xa1, 0x02, // logical child
      0x75, 0x08, 0x95, 0x40, 0xa4, // 64 bytes, pushed
      0x95, 0x02, 0xb1, 0x02, // feature: 2 bytes
      0xb4, 0x81, 0x02, // popped back to 64: input
      0xc0, 0xc0,
    ]);
    expect(parsed.numbered).toBe(false);
    const [app] = parsed.collections;
    expect(app).toMatchObject({ usagePage: 0xffa0, usage: 1, inputReports: [] });
    expect(app!.children[0]).toMatchObject({
      usage: 2,
      inputReports: [{ reportId: 0, size: 64 }],
      featureReports: [{ reportId: 0, size: 2 }],
    });
  });
});

/** A DeviceIo plugin with one walkplay dongle that answers band and preamp reads. */
function fakePlugin(sent: { reportId: number; data: number[] }[]) {
  const listeners = new Map<string, Set<(e: never) => void>>();
  const emit = (event: string, e: unknown) => listeners.get(event)?.forEach((l) => l(e as never));
  const bands = [
    { freq: 50, q: 0.75, gain: 3.5 },
    { freq: 1000, q: 2, gain: -6.25 },
  ];
  const plugin: DeviceIoPlugin = {
    list: async () => ({ devices: [device] }),
    requestPermission: async () => ({ granted: true }),
    describe: async () => ({
      interfaces: [{ number: 3, claimed: true, endpoints: 2, reportDescriptor: b64(WALKPLAY_DESCRIPTOR) }],
    }),
    open: async () => ({ handle: 7, inputEndpoint: true, outputEndpoint: true }),
    async sendReport({ handle, reportId, data }) {
      const d = unb64(data);
      sent.push({ reportId, data: d });
      const answer = new Array(63).fill(0);
      if (d[0] === 0x80 && d[1] === 0x09) {
        const band = bands[d[4]!] ?? { freq: 0, q: 0, gain: 0 };
        answer.splice(0, 5, 0x80, 0x09, 0x18, 0x00, d[4]!);
        const gain = Math.round(band.gain * 256) & 0xffff;
        answer.splice(27, 7, band.freq & 0xff, band.freq >> 8, (band.q * 256) & 0xff, (band.q * 256) >> 8, gain & 0xff, gain >> 8, 2);
      } else if (d[0] === 0x80 && d[1] === 0x03) {
        answer.splice(0, 5, 0x80, 0x03, 0x02, 0x00, 0xfd);
      } else return;
      // Another handle's traffic must be ignored.
      emit('inputReport', { handle: 99, data: b64([0x4b, 0x80, 0x09, 0, 0, 0]) });
      queueMicrotask(() => emit('inputReport', { handle, data: b64([0x4b, ...answer]) }));
    },
    sendFeatureReport: async () => {},
    receiveFeatureReport: async () => ({ data: '' }),
    close: async () => {},
    addListener: (async (event: string, listener: (e: never) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return { remove: async () => void listeners.get(event)!.delete(listener) };
    }) as DeviceIoPlugin['addListener'],
  };
  return { plugin, emit, listeners };
}

const device: NativeUsbDevice = {
  deviceName: '/dev/bus/usb/001/002',
  vendorId: 0x3302,
  productId: 0xc20f,
  productName: 'Protocol Micro',
  manufacturerName: '',
  hasPermission: false,
  hidInterfaces: [3],
};

describe('openNativeHid', () => {
  it('runs the eqcaps walkplay pull over the plugin', async () => {
    const sent: { reportId: number; data: number[] }[] = [];
    const { plugin, listeners } = fakePlugin(sent);
    const transport = await openNativeHid(device, plugin);
    expect(transport.collections[0]!.usagePage).toBe(0xff00);

    const bridge = openDevice(transport, guessProtocol(device.vendorId)!, {
      profile: { bandCount: 2 },
      log: () => {},
    });
    const result = await bridge.pull();
    expect(result.filters).toEqual([
      { type: 'PK', freq: 50, q: 0.75, gain: 3.5 },
      { type: 'PK', freq: 1000, q: 2, gain: -6.25 },
    ]);
    expect(result.preamp).toBe(-3);

    // Report id passed separately; data padded to the descriptor's 63 bytes.
    expect(sent[0]!.reportId).toBe(0x4b);
    expect(sent[0]!.data).toEqual([0x80, 0x09, 0x00, 0x00, 0x00, 0x00, ...new Array(57).fill(0)]);

    await bridge.close();
    expect(listeners.get('inputReport')!.size).toBe(0);
  });

  it('rejects with a transport error after the device is detached', async () => {
    const { plugin, emit } = fakePlugin([]);
    const transport = await openNativeHid({ ...device, hasPermission: true }, plugin);
    emit('deviceDetached', { deviceName: device.deviceName });
    const error = await transport.sendReport(0x4b, new Uint8Array([1])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BridgeError);
    expect((error as BridgeError).code).toBe('transport');
  });

  it('fails when no interface descriptor could be read', async () => {
    const { plugin } = fakePlugin([]);
    plugin.describe = async () => ({ interfaces: [{ number: 3, claimed: false, endpoints: 2 }] });
    await expect(openNativeHid(device, plugin)).rejects.toMatchObject({ code: 'transport' });
  });

  it('maps a denied permission to a transport error', async () => {
    const { plugin } = fakePlugin([]);
    plugin.requestPermission = async () => ({ granted: false });
    await expect(openNativeHid(device, plugin)).rejects.toMatchObject({ code: 'transport' });
  });
});
