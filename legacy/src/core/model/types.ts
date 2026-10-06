/**
 * Core domain types shared across the whole app.
 * This module is platform-agnostic: no DOM, no Capacitor, no navigator.*.
 */

/** All filter types the preset model can express. Devices support subsets. */
export type FilterType =
  | 'PK'   // peaking
  | 'LSQ'  // low shelf
  | 'HSQ'  // high shelf
  | 'LPF'  // low pass
  | 'HPF'  // high pass
  | 'BPF'  // band pass
  | 'NOTCH'
  | 'APF'  // all pass
  | 'BSF'  // band stop
  | 'CQ';  // constant Q

export interface Filter {
  type: FilterType;
  freq: number;   // Hz
  gain: number;   // dB
  q: number;
  enabled: boolean;
}

/** Current editable EQ state for a connected device (or the demo editor). */
export interface EqState {
  filters: Filter[];
  pregain: number; // dB, ignored when constraints.deviceHandlesPregain
}

/** Per-device PEQ capability envelope. Field names match devicePEQ 1:1. */
export interface PeqConstraints {
  minGain: number;
  maxGain: number;
  maxFilters: number;
  supportsLSFilter: boolean;
  supportsHSFilter: boolean;
  deviceHandlesPregain: boolean;
  supportsManualGlobalGain: boolean;
  supportsLPFilter?: boolean;
  supportsHPFilter?: boolean;
  supportsBPFilter?: boolean;
  supportsNotchFilter?: boolean;
  supportsAllPassFilter?: boolean;
  supportsBandStopFilter?: boolean;
  supportsConstantQFilter?: boolean;
  minQ: number;
  maxQ: number;
  minFreq?: number; // defaults 20
  maxFreq?: number; // defaults 20000
  /** Devices (e.g. Edifier) that only accept discrete frequencies. */
  freqSnapTable?: number[];
}

export interface Slot {
  id: number;
  name: string;
}

/** Extra (non-EQ) device features surfaced in the UI when supported. */
export interface DeviceExtras {
  battery?: { supported: boolean };
  eqEnabled?: { supported: boolean };
  dacFilter?: { supported: boolean; options?: string[] };
  dacBalance?: { supported: boolean };
  dacWorkMode?: { supported: boolean };
  gainMode?: { supported: boolean };
  micGain?: { supported: boolean; minDb?: number; maxDb?: number; note?: string };
  denoise?: { supported: boolean; note?: string };
}

export type TransportKind = 'usb-hid' | 'usb-serial' | 'ble' | 'spp' | 'http' | 'demo';

export type DeviceStatus = 'verified' | 'experimental' | 'community';

/** Raw device JSON file shape (devices/<brand>/<model>.json). */
export interface DeviceFile {
  id: string;               // "brand/model"
  name: string;
  aliases?: string[];
  brand?: string;
  match?: MatchBlock;
  handlerId?: string;
  transports?: TransportKind[];
  constraintsRef?: string;
  constraintsOverride?: Partial<PeqConstraints>;
  modelConfig?: ModelConfig;
  extras?: DeviceExtras;
  status?: DeviceStatus;
}

export interface MatchBlock {
  usb?: {
    vendorIds?: number[];
    productIds?: number[];
    productNames?: string[]; // exact match against HID productName
  };
  ble?: { services?: string[]; namePrefixes?: string[] };
  walkplayScheme?: number;
  demo?: boolean;
}

/** Handler-specific knobs; superset of devicePEQ modelConfig fields we use. */
export interface ModelConfig {
  reportId?: number;
  saveCommandId?: number;
  firstWritableEQSlot?: number;
  maxWritableEQSlots?: number;
  disconnectOnSave?: boolean;
  disabledPresetId?: number;
  availableSlots?: Slot[];
  pushMode?: 'auto' | 'manual';
  [key: string]: unknown;
}

/** Brand defaults file shape (devices/<brand>/_brand.json). */
export interface BrandFile {
  brand: string;
  defaults?: {
    handlerId?: string;
    transports?: TransportKind[];
    usb?: { vendorIds?: number[] };
    constraintsRef?: string;
    modelConfig?: ModelConfig;
  };
  sharedSlotSets?: Record<string, Slot[]>;
}

/** Constraint profile file shape (devices/_profiles/*.json). */
export interface ProfileFile {
  id: string;
  description?: string;
  peqConstraints: PeqConstraints;
  extras?: DeviceExtras;
}

/** Fully merged, ready-to-use device profile handed to handlers and the UI. */
export interface ResolvedDeviceProfile {
  id: string;
  name: string;
  brand: string;
  handlerId: string;
  transports: TransportKind[];
  match: MatchBlock;
  constraints: PeqConstraints;
  modelConfig: ModelConfig;
  extras: DeviceExtras;
  status: DeviceStatus;
}

// ── Presets ────────────────────────────────────────────────────────────────

export interface PeqPreset {
  schemaVersion: 1;
  id: string;   // uuid
  name: string;
  description?: string;
  tags: string[];
  createdAt: string; // ISO
  updatedAt: string;
  source?: { deviceId?: string; app: 'uniPEQ'; appVersion: string };
  pregain: number | 'auto';
  filters: Filter[];
}

// ── Handler results ────────────────────────────────────────────────────────

export interface PullResult {
  filters: Filter[];
  globalGain: number;
  /** Device cannot be read back (e.g. Edifier); UI shows "state unknown". */
  writeOnly?: boolean;
}

export interface PushResult {
  /** Device drops the connection after a save (several FiiO dongles). */
  deviceWillDisconnect: boolean;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
