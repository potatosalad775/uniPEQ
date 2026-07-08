/**
 * FiiO / JadeAudio / SnowSky USB HID protocol handler.
 * Byte-level logic ported verbatim from devicePEQ fiioUsbHidHandler.js;
 * only the I/O surface changed (HidTransport + ResolvedDeviceProfile).
 */
import type { Filter, FilterType, PullResult, PushResult } from '../model/types';
import type { HandlerContext, HidTransport, ProtocolHandler } from '../transport';
import { fiioGainBytesFromValue, fiioGainValueFromBytes, splitUnsignedValue } from '../codec/bytes';

const PEQ_FILTER_COUNT = 0x18;
const PEQ_GLOBAL_GAIN = 0x17;
const PEQ_FILTER_PARAMS = 0x15;
const PEQ_PRESET_SWITCH = 0x16;
const PEQ_SAVE_TO_DEVICE = 0x19;

const SET_HEADER1 = 0xaa;
const SET_HEADER2 = 0x0a;
const GET_HEADER1 = 0xbb;
const GET_HEADER2 = 0x0b;
const END_HEADERS = 0xee;

const RESPONSE_TIMEOUT_MS = 10000;

function hid(ctx: HandlerContext): HidTransport {
  return ctx.transport as HidTransport;
}

function reportId(ctx: HandlerContext): number {
  return (ctx.profile.modelConfig.reportId as number | undefined) ?? 7;
}

function convertFromFilterType(filterType: FilterType): number {
  const mapping: Partial<Record<FilterType, number>> = { PK: 0, LSQ: 1, HSQ: 2 };
  return mapping[filterType] ?? 0;
}

function convertToFilterType(datum: number): FilterType {
  switch (datum) {
    case 1: return 'LSQ';
    case 2: return 'HSQ';
    default: return 'PK';
  }
}

function setPacket(command: number, payloadLength: number, payload: number[]): Uint8Array {
  return new Uint8Array([SET_HEADER1, SET_HEADER2, 0, 0, command, payloadLength, ...payload, END_HEADERS]);
}

function getPacket(command: number, payload: number[] = [0, 0]): Uint8Array {
  return new Uint8Array([GET_HEADER1, GET_HEADER2, 0, 0, command, ...payload, END_HEADERS]);
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll `condition` every 100 ms; resolve when true, reject on timeout. */
function waitFor(condition: () => boolean, timeoutMs = RESPONSE_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    if (condition()) return resolve();
    const interval = setInterval(() => {
      if (condition()) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve();
      }
    }, 100);
    const timer = setTimeout(() => {
      clearInterval(interval);
      reject(new Error('Timeout waiting for device response'));
    }, timeoutMs);
  });
}

export const fiioUsbHid: ProtocolHandler = {
  async getCurrentSlot(ctx: HandlerContext): Promise<number> {
    const device = hid(ctx);
    let currentSlot = -99;

    const unsubscribe = device.onData((data) => {
      if (data[0] === GET_HEADER1 && data[1] === GET_HEADER2 && data[4] === PEQ_PRESET_SWITCH) {
        const presetId = data[6];
        currentSlot = presetId === ctx.profile.modelConfig.disabledPresetId ? -1 : presetId;
      }
    });
    try {
      await device.sendReport(reportId(ctx), getPacket(PEQ_PRESET_SWITCH));
      await waitFor(() => currentSlot > -99);
      return currentSlot;
    } finally {
      unsubscribe();
    }
  },

  async pullFromDevice(ctx: HandlerContext, _slot: number): Promise<PullResult> {
    const device = hid(ctx);
    const rid = reportId(ctx);
    const filters: Filter[] = [];
    let peqCount = -1;
    let globalGain = 0;

    const unsubscribe = device.onData((data) => {
      if (data[0] !== GET_HEADER1 || data[1] !== GET_HEADER2) return;
      switch (data[4]) {
        case PEQ_FILTER_COUNT: {
          peqCount = data[6];
          // Fetch each filter's params once we know the count.
          for (let i = 0; i < peqCount; i++) {
            void device.sendReport(rid, getPacket(PEQ_FILTER_PARAMS, [1, i, 0]));
          }
          break;
        }
        case PEQ_FILTER_PARAMS: {
          const index = data[6];
          const gain = fiioGainValueFromBytes(data[7], data[8]);
          const freq = (data[9] << 8) | data[10];
          const q = ((data[11] << 8) | data[12]) / 100 || 1;
          filters[index] = {
            type: convertToFilterType(data[13]),
            freq,
            gain,
            q,
            enabled: Boolean(gain || freq || q),
          };
          break;
        }
        case PEQ_GLOBAL_GAIN:
          globalGain = fiioGainValueFromBytes(data[6], data[7]);
          break;
        default:
          ctx.log.debug('fiioUsbHid: unhandled response type', data[4]);
      }
    });

    try {
      await device.sendReport(rid, getPacket(PEQ_PRESET_SWITCH));
      await device.sendReport(rid, getPacket(PEQ_FILTER_COUNT));
      await device.sendReport(rid, getPacket(PEQ_GLOBAL_GAIN));
      await waitFor(() => peqCount >= 0 && filters.filter(Boolean).length === peqCount);
      return { filters: filters.filter(Boolean), globalGain };
    } finally {
      unsubscribe();
    }
  },

  async pushToDevice(ctx: HandlerContext, slot: number, pregain: number, filters: Filter[]): Promise<PushResult> {
    const device = hid(ctx);
    const rid = reportId(ctx);
    const { maxGain, maxFilters } = ctx.profile.constraints;

    // FiiO devices cut max SPL by maxGain internally, so maxGain + pregain is safe.
    const globalGain = Math.round((maxGain + pregain) * 10);
    const gainBytes = [globalGain & 0xff, (globalGain & 0xff00) >> 8];
    await device.sendReport(rid, setPacket(PEQ_GLOBAL_GAIN, 2, [gainBytes[1], gainBytes[0], 0]));

    const count = Math.min(filters.length, maxFilters);
    await device.sendReport(rid, setPacket(PEQ_FILTER_COUNT, 1, [count, 0]));
    await delay(100);

    for (let i = 0; i < count; i++) {
      const filter = filters[i];
      // Disabled bands still get written with 0 gain to clear stale device state.
      const gain = filter.enabled ? filter.gain : 0;
      const [freqHigh, freqLow] = splitUnsignedValue(filter.freq);
      const [gainHigh, gainLow] = fiioGainBytesFromValue(gain);
      const [qHigh, qLow] = splitUnsignedValue(Math.round(filter.q * 100));
      await device.sendReport(
        rid,
        setPacket(PEQ_FILTER_PARAMS, 8, [
          i, gainHigh, gainLow, freqHigh, freqLow, qHigh, qLow,
          convertFromFilterType(filter.type), 0,
        ]),
      );
    }
    await delay(100);

    const saveCmd = (ctx.profile.modelConfig.saveCommandId as number | undefined) ?? PEQ_SAVE_TO_DEVICE;
    await device.sendReport(rid, setPacket(saveCmd, 1, [slot, 0]));
    ctx.log.info('fiioUsbHid: PEQ filters pushed successfully');

    return { deviceWillDisconnect: ctx.profile.modelConfig.disconnectOnSave === true };
  },

  async enablePEQ(ctx: HandlerContext, enabled: boolean, slotId: number): Promise<void> {
    const device = hid(ctx);
    const target = enabled
      ? slotId
      : ((ctx.profile.modelConfig.disabledPresetId as number | undefined) ?? ctx.profile.constraints.maxFilters);
    await device.sendReport(reportId(ctx), setPacket(PEQ_PRESET_SWITCH, 1, [target, 0]));
  },
};
