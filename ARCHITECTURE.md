# uniPEQ — Architecture & Implementation Plan

> Standalone parametric-EQ control app for USB / Bluetooth / network audio devices.
> Targets: **Desktop web (Chrome/Edge)** and **Android (Capacitor)** from one codebase.
> Origin: ports the protocol handlers and reverse-engineered device knowledge from the
> `devicePEQ` CrinGraph plugin, but is otherwise an **independent project** with no
> runtime or repo dependency on `devicePEQ`.
>
> **Stack change (2026-10-06):** the app is being rebuilt on **SvelteKit + Svelte 5 + Tailwind 4 +
> bits-ui inside Capacitor**, on the eqcaps packages. Ionic and Vue are dropped. Rationale, decisions
> and phases: [docs/rebuild-plan.md](docs/rebuild-plan.md). §3 and §8 already describe the target
> UI stack. §4–§7 and §9–§11 still describe the Ionic Vue prototype's own core (registry,
> handlers, adaptation), which eqcaps replaces; they get rewritten at the rebuild's cutover.

---

## 1. Goals & Non-Goals

### Goals
- Read/write PEQ parameters on ~20+ supported device families over USB HID, USB/BT serial,
  BLE GATT, Classic Bluetooth SPP (Android only), and HTTP.
- One TypeScript core shared by both platforms; only the transport layer differs.
- Device database managed as per-device JSON files in a `brand/device` folder structure,
  with shared constraint profiles to avoid duplication.
- User-managed **presets**: save/load/import/export EQ configurations, with automatic
  adaptation (+ visible diff) when a preset doesn't fit the target device's constraints.
- Three-tab UI: **Main** (connect + EQ control), **Presets**, **Settings**.
- Auto-push EQ changes to the device after an idle debounce; local undo/redo.

### Non-Goals (v1)
- Cloud sync / user accounts (presets are local + JSON file import/export).
- iOS (Capacitor makes it possible later, but iOS WebView has no USB/BT APIs and native
  USB access is heavily restricted — out of scope).
- Headphone frequency-response *measurement* overlays (CrinGraph / modernGraphTool's job). The
  app's own EQ response graph with draggable band nodes **is** in scope; it's the Main screen's
  centrepiece.
- The `chatWithPEQ`, `sharePEQ`, `subjectizePEQ` extras from devicePEQ.
- Firmware update, ANC control, or non-EQ device features beyond the existing "extras"
  (battery, DAC filter, etc.) already modeled in constraint profiles.

---

## 2. Platform Constraint Matrix (drives the whole design)

| API | Desktop Chrome/Edge | Android Chrome | Android WebView (Capacitor) |
|---|---|---|---|
| WebHID | ✅ | ❌ | ❌ |
| Web Serial | ✅ | ❌ | ❌ |
| WebUSB | ✅ | ✅ | ❌ |
| Web Bluetooth (BLE) | ✅ | ✅ | ❌ |
| Classic BT SPP | ~flaky (via Web Serial) | ❌ | ❌ |
| HTTP (fetch) | ✅ | ✅ | ✅ |

Conclusions:
- **Web build**: reuse the existing browser APIs behind thin transport wrappers.
- **Android build**: all device I/O goes through native Kotlin Capacitor plugins
  (USB Host, BLE, Classic SPP). Native Android is *more* capable than web here —
  Classic SPP (Edifier, and later Sony/Airoha/Maxwell from `bluetooth_tools/`) is
  reliable natively and nearly impossible on web.
- HTTP devices (WiiM, Luxsin X9) work identically everywhere via `fetch`
  (subject to WebView cleartext policy — see §10 risks).

---

## 3. High-Level Architecture

```
┌────────────────────────────────────────────────────────────┐
│  UI (SvelteKit SPA, Svelte 5 runes, Tailwind 4, bits-ui)   │
│  Screens: Main / Presets / Settings (tabs ↔ side rail)     │
│  Rune stores (.svelte.ts): device, eq(+history), presets,  │
│  settings                                                  │
├────────────────────────────────────────────────────────────┤
│  Application services                                      │
│  DeviceManager · AutoPushScheduler · PresetAdapter         │
│  UndoRedoStack · PresetStorage · i18n · Logger             │
├────────────────────────────────────────────────────────────┤
│  Core (pure TS, platform-agnostic, no DOM, no Capacitor)   │
│  • Protocol handlers (one module per vendor protocol)      │
│  • Codec primitives (CRC, linear encoders, freq tables)    │
│  • Device registry (compiled from devices/**.json)         │
│  • Constraint resolution & preset adaptation engine        │
│  • PEQ math (biquad response, pregain calc)                │
├────────────────────────────────────────────────────────────┤
│  Transport (per-platform, thin, byte-in/byte-out)          │
│  Web:     WebHID · WebSerial · WebBLE · Http               │
│  Android: NativeUsbHid · NativeUsbSerial · NativeBle ·     │
│           NativeSpp · Http   (via Capacitor plugin bridge) │
└────────────────────────────────────────────────────────────┘
```

**Dependency rule:** Core never imports from UI, Capacitor, or `navigator.*`.
Handlers receive a `Transport` instance; they neither open nor discover devices.
All discovery/permission UX lives in the platform layer + UI.

### Source layout

Prototype layout (Ionic Vue). In the rebuild everything moves under `src/lib/` (SvelteKit
convention), `src/views/` becomes `src/routes/`, and `devices/`, `core/{registry,handlers,codec,
transport,adaptation}` and `transports/web` disappear into eqcaps. See
[docs/rebuild-plan.md](docs/rebuild-plan.md).

```
uniPEQ/
├── src/
│   ├── core/
│   │   ├── model/            # Filter, EqState, PeqConstraints, Slot, DeviceProfile types
│   │   ├── math/             # biquad response, pregain/headroom calc
│   │   ├── codec/            # crc.ts, linearScale.ts, freqTable.ts, frame.ts (optional, grows over time)
│   │   ├── handlers/         # one file per protocol (ported from devicePEQ)
│   │   │   ├── index.ts      # handlerId → implementation registry
│   │   │   ├── fiioUsbHid.ts
│   │   │   ├── walkplayHid.ts
│   │   │   ├── edifierSpp.ts
│   │   │   └── ...
│   │   ├── registry/         # loads + validates + merges devices/**.json
│   │   ├── adaptation/       # preset→constraints adaptation engine + diff report
│   │   └── transport/        # Transport interface + shared framing helpers ONLY (no impls)
│   ├── transports/
│   │   ├── web/              # webHidTransport.ts, webSerialTransport.ts, webBleTransport.ts
│   │   ├── native/           # thin TS wrappers over the Capacitor plugin (usb-hid, usb-serial, ble, spp)
│   │   └── http/             # httpTransport.ts (shared both platforms)
│   ├── services/             # DeviceManager, AutoPushScheduler, PresetStorage, ...
│   ├── stores/               # Pinia: deviceStore, eqStore, presetStore, settingsStore
│   ├── views/                # MainTab.vue, PresetsTab.vue, SettingsTab.vue, TabsPage.vue
│   ├── components/           # EqBandControl, EqGraphMini, DevicePicker, PresetDiffModal, ...
│   └── i18n/                 # en.json, ko.json
├── devices/                  # ← device DB (JSON only, see §5)
│   ├── _schema/              # JSON Schema files for editor validation
│   ├── _profiles/            # shared constraint profiles
│   ├── fiio/
│   │   ├── _brand.json
│   │   ├── ka17.json
│   │   ├── jadeaudio-jiezi.json
│   │   └── ...
│   ├── moondrop/ …
│   ├── walkplay/ …           # scheme-based generic devices
│   └── ...
├── native/                   # Capacitor plugin (Kotlin) — single plugin, 4 transport modules
│   └── uni-peq-device-io/
├── tests/
│   ├── unit/                 # vitest: codecs, handlers (mock transport + byte fixtures), adaptation
│   └── fixtures/             # recorded request/response byte traces per device
└── android/                  # Capacitor Android shell (already scaffolded)
```

---

## 4. Transport Layer

### 4.1 Interface

```ts
interface Transport {
  readonly kind: 'usb-hid' | 'usb-serial' | 'ble' | 'spp' | 'http';
  open(): Promise<void>;
  close(): Promise<void>;
  write(bytes: Uint8Array, opts?: WriteOptions): Promise<void>;
  onData(cb: (bytes: Uint8Array, meta?: DataMeta) => void): Unsubscribe;
  onDisconnect(cb: () => void): Unsubscribe;
}
```

Per-kind extensions (kept minimal, only what handlers actually use today):

- **`HidTransport extends Transport`** — `sendReport(reportId, data)`,
  `sendFeatureReport(reportId, data)`, `receiveFeatureReport(reportId)`;
  `onData` meta carries `reportId`. (Needed: FiiO/Walkplay/KTMicro/Moondrop/Topping/
  Fosi/Qudelix handlers are report-oriented, not raw-stream.)
- **`SerialTransport extends Transport`** — plain byte stream; `open` takes
  `{ baudRate }`. Covers USB CDC *and* Web-Serial-over-SPP (they look identical to
  handlers today — Edifier/Nothing/JDS Labs/Moondrop Edge/Tanchjim Rita/EarFun/Airoha-serial).
- **`BleTransport extends Transport`** — `write` targets a characteristic;
  `onData` = notifications. `open` takes `{ service, writeChar, notifyChar }`
  resolved from the device profile (FiiO BLE, Airoha BLE, Moondrop GAIA).
- **`HttpTransport`** — request/response rather than stream; expose
  `request(path, init)` and let network handlers (WiiM RPC, Luxsin) use it directly.
  It implements `Transport` loosely for uniformity but handlers may use the richer API.

### 4.2 Discovery / permission model (platform service, not part of `Transport`)

```ts
interface DeviceDiscovery {
  // Web: must be called from a user gesture → browser picker.
  // Android: enumerates already-attached USB devices / scans BLE / lists bonded SPP.
  requestDevice(filter: DiscoveryFilter): Promise<DiscoveredDevice[]>;
  // Android only: attach/detach events; web: navigator.hid 'connect'/'disconnect'.
  onDeviceAttached(cb: (d: DiscoveredDevice) => void): Unsubscribe;
}
```

Key UX difference to embrace, not hide:
- **Web:** passive detection is impossible; the Main tab shows a "Connect device" button
  per transport family that triggers the browser chooser. Previously-granted devices
  (`navigator.hid.getDevices()` etc.) *can* be listed passively on page load —
  use that for the "possible list of connected devices".
- **Android:** genuinely automatic — USB attach broadcasts + BLE scan + bonded Classic
  devices let the app show a live candidate list without a picker.

### 4.3 What gets refactored out of the current connectors

The devicePEQ connectors (`usbHidConnector.js`, `usbSerialConnector.js`, …) currently mix:
1. browser `requestDevice` + filters → moves to `transports/web` discovery,
2. device-config matching (VID/PID → config entry) → moves to `core/registry` matcher,
3. DOM dialogs (e.g. the SPP disambiguation modal in `usbSerialConnector.js`) → becomes a
   Vue component driven by a `needsDisambiguation` result from the matcher,
4. handler dispatch (`device.handler.pushToDevice(...)`) → moves to `DeviceManager`.

Handlers currently reach into `deviceDetails.rawDevice` / `deviceDetails.writable.write(...)`.
The port changes their signature to receive a typed transport + resolved profile:

```ts
interface ProtocolHandler {
  getCurrentSlot(ctx: HandlerContext): Promise<number>;
  pullFromDevice(ctx: HandlerContext, slot: number): Promise<PullResult>;
  pushToDevice(ctx: HandlerContext, slot: number, pregain: number, filters: Filter[]): Promise<PushResult>;
  enablePEQ(ctx: HandlerContext, enabled: boolean, slotId: number): Promise<void>;
}

interface HandlerContext {
  transport: Transport;          // already-open, correct subtype for the handler
  profile: ResolvedDeviceProfile; // merged JSON config: slots, reportId, constraints, quirks
  log: Logger;
}
```

`PushResult` carries flags the UI needs (e.g. `deviceWillDisconnect` for
`disconnectOnSave` devices). This is the **only** breaking change to handler code; the
byte-level logic ports verbatim.

---

## 5. Device Database (Tier 1 — data)

### 5.1 File layout & inheritance

One JSON file per device, grouped by brand, plus shared profiles. Resolution merges
four layers (later wins):

```
constraint profile (_profiles/) → brand defaults (_brand.json) → device file → device "overrides" block
```

**`devices/_profiles/peq10Band12dBAllFilters7.json`** (ported 1:1 from
`peqConstraintsConfig.json` entries — same field names, so migration is mechanical):

```json
{
  "id": "peq10Band12dBAllFilters7",
  "description": "10-band PEQ, ±12 dB, all 7 FiiO filter types, pregain",
  "peqConstraints": { "minGain": -12, "maxGain": 12, "maxFilters": 10, "...": "..." },
  "extras": { }
}
```

**`devices/fiio/_brand.json`** — replaces the per-vendor `defaultModelConfig` in
`usbDeviceConfig.js`:

```json
{
  "brand": "FiiO",
  "defaults": {
    "handlerId": "fiioUsbHid",
    "transports": ["usb-hid"],
    "usb": { "vendorIds": [10610, 2578] },
    "modelConfig": { "reportId": 7, "disconnectOnSave": true, "availableSlots": ["$fiioStandardSlots"] }
  },
  "sharedSlotSets": { "fiioStandardSlots": [ {"id": 0, "name": "Jazz"}, "..." ] }
}
```

**`devices/fiio/jadeaudio-jiezi.json`**:

```json
{
  "id": "fiio/jadeaudio-jiezi",
  "name": "JadeAudio JIEZI",
  "aliases": [],
  "match": {
    "usb": { "productNames": ["JadeAudio JIEZI"] }
  },
  "constraintsRef": "peq5Band12dBAllFilters7",
  "constraintsOverride": {},
  "modelConfig": {
    "reportId": 2,
    "firstWritableEQSlot": 160,
    "maxWritableEQSlots": 3,
    "disabledPresetId": 240,
    "availableSlots": [ {"id": 0, "name": "Jazz"}, "...", {"id": 240, "name": "Close EQ"} ]
  },
  "status": "verified"
}
```

Design points:
- **`handlerId` is a string**, resolved through `core/handlers/index.ts`. JSON stays
  pure data; no imports. Adding a variant of a known device = one JSON file, zero code.
- **Scheme-based families** (Walkplay `SchemeNo10..21`): the walkplay handler reads the
  scheme number from the device at connect time. Model as `devices/walkplay/scheme-13.json`
  etc., with `match: { "walkplayScheme": 13 }` — the registry supports post-connect
  re-resolution (connect with generic profile → handler reports scheme → registry swaps
  in the specific profile). Same mechanism serves FiiO name-based identification
  (HID product name → device file).
- **`match` block** supports: USB `vendorIds`/`productIds`/`productNames` (exact +
  pattern), BLE service UUIDs + name prefixes, SPP service class UUIDs, HTTP (manual
  entry / mDNS later). Multiple matches → disambiguation UI (replaces the cookie-based
  modal in devicePEQ).
- **`status`**: `"verified" | "experimental" | "community"` — drives the experimental
  warning UI that plugin.js currently implements ad hoc.
- **Validation**: JSON Schema files in `devices/_schema/` (editor autocomplete +
  `$schema` refs), plus zod validation of every file in a vitest suite so CI catches a
  bad device file. Registry is compiled at build time via `import.meta.glob('/devices/**/*.json', { eager: true })`
  — no runtime fetch, works offline, tree-shakes into the bundle.

### 5.2 Migration source map

| devicePEQ source | uniPEQ destination |
|---|---|
| `peqConstraintsConfig.json` `constraints.*` | `devices/_profiles/*.json` (1 file each) |
| `usbDeviceConfig.js` vendor `defaultModelConfig` | `devices/<brand>/_brand.json` |
| `usbDeviceConfig.js` per-device `modelConfig` | `devices/<brand>/<model>.json` |
| `usbSerialDeviceConfig.js` | same, `transports: ["usb-serial"]` (+ SPP UUIDs in `match`) |
| `bluetoothBleDeviceConfig.js` | same, `transports: ["ble"]` + GATT UUIDs in `match` |
| `networkDeviceConfig.js` | `devices/<brand>/<model>.json`, `transports: ["http"]` |
| `deviceNames` arrays in constraints config | inverted: each device file carries `constraintsRef` |

A one-off migration script (`scripts/migrate-device-db.ts`) generates the initial tree
from the four config files, then the JS configs are deleted — JSON becomes the source
of truth.

---

## 6. Protocol Handlers (Tier 2 — code)

Ported from devicePEQ essentially verbatim (byte logic untouched), converted to TS,
`HandlerContext` signature, `console.log` → injected logger.

| Handler | Transport | Port notes |
|---|---|---|
| `fiioUsbHid` | usb-hid | Largest surface (KA17/QX13/K17/BTR/Snowsky/JadeAudio…). Port first. |
| `walkplayHid` | usb-hid | Scheme detection → registry re-resolution (§5.1). |
| `moondropUsbHid`, `moondropOldFashionedUsbHid` | usb-hid | |
| `ktmicroUsbHid` | usb-hid | Kiwi Ears / Tanchjim / CDSP family. |
| `toppingUsbHid`, `fosiAudioUsbHid`, `qudelixUsbHid` | usb-hid | Qudelix is stateful — keep custom. |
| `fiioUsbSerial`, `moondropEdgeUsbSerial`, `ritaUsbSerial`, `nothingUsbSerial`, `earfunUsbSerial`, `jdsLabsUsbSerial`, `airohaUsbSerial` | usb-serial | Stream-based; identical over CDC and SPP-serial. |
| `edifierSpp` (`edifierUsbSerialHandler`) | spp / usb-serial | Write-only; freq lookup table; keep `writeOnly` flag in `PullResult`. |
| `fiioSppSerial` | spp | Web-flaky today → primary value on Android native SPP. |
| `fiioBle`, `airohaBle` | ble | GATT UUIDs move into device JSON `match`/`connect` blocks. |
| `wiimNetwork`, `luxsinNetwork` | http | Use `HttpTransport.request`. |

**Codec toolkit (`core/codec/`)** — extract only what's already duplicated
(checksum-sum-&-0xFF, baseline+value×scale encoders, freq lookup tables, frame builder).
Deliberately *not* a goal to make handlers declarative; at ~20 devices the uniform
`ProtocolHandler` interface is the modularity. Revisit if the DB approaches 30+.

---

## 7. Preset System

### 7.1 Preset model (device-independent "ideal" representation)

```ts
interface PeqPreset {
  schemaVersion: 1;
  id: string;               // uuid
  name: string;
  description?: string;
  tags: string[];
  createdAt: string;        // ISO
  updatedAt: string;
  source?: { deviceId?: string; app: 'uniPEQ'; appVersion: string };
  pregain: number | 'auto'; // 'auto' → computed from max positive gain
  filters: Array<{
    type: 'PK' | 'LSQ' | 'HSQ' | 'LPF' | 'HPF' | 'BPF' | 'NOTCH' | 'APF' | 'BSF' | 'CQ';
    freq: number; gain: number; q: number; enabled: boolean;
  }>;
}
```

Presets are stored **unconstrained** (any band count, any ranges). Constraints apply
only at *apply-time*, per target device. The preset file itself is never mutated by
adaptation.

- **Storage**: Capacitor `Preferences` for the index + individual presets as JSON via
  `Filesystem` (Android) / IndexedDB-backed shim (web). Abstracted behind `PresetStorage`.
- **Import/export**: single-preset `.json` and multi-preset bundle. Export via
  `Filesystem.writeFile` + share sheet (Android) / download (web). Import validates
  against the schema, migrates older `schemaVersion`s. Also accept AutoEq-style
  ParametricEQ txt as an import format (cheap win, well-specified).

### 7.2 Adaptation engine (`core/adaptation/`) — *auto-adapt + show diff*

Pure function; central piece, fully unit-tested:

```ts
adaptPresetToConstraints(preset: PeqPreset, c: PeqConstraints): {
  adapted: EqState;
  changes: AdaptationChange[];   // structured, renderable diff
  lossScore: number;             // 0 = perfect fit
}
```

Pipeline (each step appends `AdaptationChange` entries):
1. **Filter-type conversion** — unsupported types: LS/HS → PK approximation at shelf
   corner; LP/HP/BP/Notch/AP unsupported → drop with warning (no honest PK equivalent).
2. **Band reduction** — if `filters.length > maxFilters`: drop disabled bands first,
   then lowest `|gain|` bands; merge near-duplicate center frequencies (within ⅓ octave,
   same type) before dropping.
3. **Range clamping** — gain → `[minGain, maxGain]`, Q → `[minQ, maxQ]`, freq → device
   freq range (and snap-to-table for devices like Edifier — table exposed via profile).
4. **Pregain** — if `deviceHandlesPregain`, drop manual pregain (note it); else compute/clamp.

UI: `PresetDiffModal` lists changes ("Band 9 (6.3 kHz, +2 dB) dropped — device supports
8 bands", "Gain +14 dB → +12 dB") with **Apply** / **Cancel**. `lossScore` also lets the
Presets tab badge each preset with a compatibility indicator for the currently
connected device.

The same engine runs **device→device**: "pull from device A, save preset, apply to
device B" needs no extra code path.

---

## 8. UI / Application Behavior

Layout principles (rebuild): **the EQ graph is the main element**, and desktop and phone both get an
intentional layout. Below ~900 px: bottom tab bar, graph above the band list, band editor in a
bottom sheet. Above it: side rail, with graph and band editor side by side. Colors come only from
semantic tokens (OKLCH, DaisyUI naming, light + dark), the same structure as modernGraphTool's
`theme.css`. Component and push-path sources: [docs/reuse-from-modernGraphTool.md](docs/reuse-from-modernGraphTool.md).

### 8.1 Main tab

Flow: *connect → detect/select → EQ control → auto-push*.

1. **Connection area** — platform-aware:
   - Android: live list of detected candidates (USB attached, BLE scan results, bonded
     SPP devices), auto-refreshing; tap to connect.
   - Web: previously-authorized devices listed immediately; "Add device…" buttons per
     transport open browser pickers.
   - Ambiguous matches → device disambiguation sheet (persisted choice per physical device).
2. **EQ control panel** (shown when connected):
   - Slot selector (from profile `availableSlots`, writable slots highlighted).
   - Per-band controls: type / freq / gain / Q — rendered from `PeqConstraints`
     (band count, allowed types, ranges, steps). Interactive response graph
     (SVG, `biquad.ts` response, draggable band nodes; replaces the prototype's mini canvas preview).
   - Pregain control (hidden when `deviceHandlesPregain`).
   - EQ on/off toggle (`enablePEQ`), extras (battery, DAC filter…) when profile says so.
   - **Undo/redo buttons**, **Load preset** button (opens preset picker + diff modal),
     **Save as preset**.
3. **Auto-push** (`AutoPushScheduler`):
   - Debounce, default **1.5 s** after last control interaction (configurable in Settings).
   - Coalesce: only latest state is pushed; a push in flight defers the next one.
   - Status chip: `editing → pending → pushing → synced / error`.
   - **Exception:** devices with `disconnectOnSave: true` (several FiiO) or slot-commit
     semantics don't get auto-push — profile flag `pushMode: "auto" | "manual"` swaps
     the UI to an explicit **Save to device** button. Write-only devices (Edifier) show
     a "device state unknown / write-only" hint on connect.
4. **Undo/redo** (`UndoRedoStack`): snapshots of `EqState` (≤ a few hundred bytes each),
   capped at ~100 entries, per connection session. Coalesces slider drags (snapshot on
   release, not per tick). Undo/redo marks state dirty → flows through the same
   auto-push/manual-save path.

### 8.2 Presets tab
- List with search/tags; compatibility badge vs. currently connected device.
- CRUD: rename, duplicate, delete, edit metadata.
- Import (file picker, validates + migrates) / Export (single or bundle).
- "Apply to connected device" → same diff modal as Main tab.

### 8.3 Settings tab
- Theme: system / light / dark (`.dark` on `<html>`, semantic CSS tokens).
- Language: en / ko initially (Paraglide JS, compile-time messages, as in modernGraphTool).
- Auto-push delay slider + disable toggle (manual mode).
- Diagnostics: verbose byte-level logging toggle, in-app log viewer, export log —
  replaces devicePEQ's feedback-form log collection; essential for community protocol debugging.
- About / device DB version / licenses.

### 8.4 Stores (rune classes in `.svelte.ts`; Pinia in the prototype)
- `deviceStore` — discovery list, connection state, resolved profile, extras state.
- `eqStore` — current `EqState`, dirty flag, history (undo/redo), sync status.
- `presetStore` — index + lazy-loaded bodies.
- `settingsStore` — persisted via Capacitor `Preferences`.

---

## 9. Android Native Layer (Capacitor plugin)

One local Capacitor plugin **`uni-peq-device-io`** (Kotlin), four transport modules
behind a shared event bridge (`deviceAttached`, `deviceDetached`, `data`,
`disconnected` events; methods return promises). Kept as a single plugin so permission
plumbing and the JS bridge are written once.

| Module | Android API | Notes |
|---|---|---|
| **UsbHid** | `UsbManager` + `UsbDeviceConnection` | Claim HID interface; interrupt IN endpoint read loop → `data` events; output via interrupt OUT or `controlTransfer` SET_REPORT; feature reports via control transfers (needed for `sendFeatureReport`/`receiveFeatureReport` parity). Handle `ACTION_USB_PERMISSION` flow + attach/detach broadcasts. **Caveat:** Android may route HID audio-device interfaces to the system; must claim with `forceClaim`. Risk item — validate early with a real FiiO device (M3 spike). |
| **UsbCdcSerial** | `usb-serial-for-android` lib (or raw bulk transfer) | CDC-ACM for the usb-serial handler family; baud from profile. |
| **BleGatt** | `BluetoothLeScanner` + `BluetoothGatt` | Scan filtered by service UUIDs from device DB; MTU negotiation; notify subscriptions → `data` events. |
| **ClassicSpp** | `BluetoothSocket` (RFCOMM) | Connect by UUID to bonded devices; read-loop thread → `data` events. Unlocks Edifier reliably; later Sony/Airoha/Maxwell from `bluetooth_tools/`. |

Permissions: `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` (API 31+, with
`neverForLocation`), legacy BT + location for API ≤ 30, USB host feature declaration,
optional `usb-device` intent filters in the manifest for launch-on-attach.

TS wrappers in `src/transports/native/` adapt the plugin API to the `Transport`
subtypes — handlers cannot tell native from web.

---

## 10. Testing Strategy

- **Unit (vitest)** — the big win of the transport split: every handler tested against a
  `MockTransport` replaying recorded byte fixtures (`tests/fixtures/<device>/*.json`
  captured from real devices via the diagnostics logger). Assert exact request bytes +
  decoded pull results. Codec + adaptation engine get exhaustive property-style tests
  (clamping, band reduction, type conversion).
- **Device DB validation suite** — zod-validate every `devices/**.json`; cross-checks
  (every `constraintsRef` resolves, every `handlerId` exists, no duplicate matches).
- **Component/e2e (cypress, already scaffolded)** — tab flows, preset CRUD,
  diff modal, undo/redo, auto-push debounce (with a fake device driver injected).
- **On-device matrix** — manual checklist per transport per platform; keep the
  `universal-device-diagnostic` idea from devicePEQ as a hidden diagnostics screen.

CI: lint + typecheck + vitest + DB validation on every push; `vite build` web; Android
debug build on tags.

---

## 11. Milestones & Task List

### M0 — Foundation (repo & schema)
- [ ] Strip Ionic starter placeholder content; set `appId` (e.g. `com.pragmagic.unipeq`), app name, icons.
- [ ] Add Pinia, vue-i18n, ESLint/Prettier config, strict `tsconfig`.
- [ ] Define core types: `Filter`, `EqState`, `PeqConstraints`, `Slot`, `DeviceProfile`, `Transport` hierarchy, `ProtocolHandler`, `HandlerContext`.
- [ ] Design + write `devices/_schema/*.schema.json` (profile, brand, device).
- [ ] Write `scripts/migrate-device-db.ts`; generate initial `devices/` tree from the four devicePEQ config files; hand-review output.
- [ ] Registry loader (`import.meta.glob`) + merge/resolution logic + zod validation suite.

### M1 — Core port + web transports (goal: web parity with devicePEQ)
- [ ] Implement web transports: WebHID, WebSerial, WebBLE, HTTP + web `DeviceDiscovery`.
- [ ] `MockTransport` + fixture format + first fixtures.
- [ ] Port handlers in order: `fiioUsbHid` → `walkplayHid` (incl. scheme re-resolution) → `ktmicroUsbHid` → `moondrop*` → remaining HID → serial family → `edifierSpp` → BLE pair → network pair. One PR per handler, each with fixture tests.
- [ ] `DeviceManager` service: discover → match → disambiguate → open transport → resolve profile → bind handler.
- [ ] Throwaway dev page (list devices, pull, edit JSON, push) to validate core before real UI exists.
- [ ] Verify on real hardware: at least one device per transport family.

### M2 — Application UI
- [ ] Tabs skeleton, theme, i18n plumbing (en first, ko strings alongside).
- [ ] Main tab: connection area (web variant), slot selector, band controls rendered from constraints, pregain, extras, response-curve preview.
- [ ] `eqStore` + `UndoRedoStack` (drag coalescing) + undo/redo UI.
- [ ] `AutoPushScheduler` + sync-status chip + manual-save mode for `disconnectOnSave`/`pushMode:"manual"` profiles.
- [ ] Preset model, `PresetStorage` (web shim + Capacitor impl), Presets tab CRUD.
- [ ] Adaptation engine + `PresetDiffModal` + compatibility badges.
- [ ] Import/export (JSON; AutoEq txt import).
- [ ] Settings tab (theme, language, auto-push delay, diagnostics log viewer/export).
- [ ] Cypress flows for the above.

### M3 — Android native
- [ ] **Spike first:** Kotlin proof-of-concept — claim FiiO HID interface, exchange one report on a real device (de-risks the biggest unknown, §9 UsbHid caveat). *Moved ahead of everything else as rebuild Phase 0; its TS wrapper targets the eqcaps bridge's `HidTransport`.*
- [ ] Scaffold `uni-peq-device-io` plugin; event bridge; permission flows.
- [ ] UsbHid module + native `HidTransport` wrapper → verify FiiO/Walkplay on Android.
- [ ] UsbCdcSerial module → verify one serial device.
- [ ] BleGatt module → verify FiiO BLE or Airoha.
- [ ] ClassicSpp module → verify Edifier W830NB.
- [ ] Android `DeviceDiscovery` (attach broadcasts, BLE scan, bonded list) + auto-detect UX on Main tab.
- [ ] WebView specifics: cleartext-HTTP policy for WiiM/Luxsin (network security config), keep-screen-on during long writes, lifecycle handling (connection teardown on background).

### M4 — Polish & release
- [ ] Korean translation pass; experimental-device warning flow; error taxonomy + user-facing messages (permission denied / device busy / write failed / disconnected mid-write).
- [ ] On-device test matrix executed and recorded.
- [ ] Icons/splash, Play Store internal-testing track, web deploy (static host; needs HTTPS for the device APIs).
- [ ] Docs: `devices/README.md` — "how to add a device" (JSON-only path + handler path), fixture-capture guide.

---

## 12. Risks & Open Questions

| # | Risk / question | Mitigation / decision needed |
|---|---|---|
| 1 | **Android USB HID claim** — audio-class composite devices may not release the HID interface to apps, or `forceClaim` may fail on some OEM builds. | M3 spike is scheduled first; if a specific family fails, it stays web/desktop-only and the DB `transports` field gates UI availability per platform. |
| 2 | **Walkplay/scheme re-resolution** — profile is only fully known post-connect. | Registry designed for two-phase resolution (§5.1); UI shows generic constraints until scheme arrives. |
| 3 | **Qudelix / Airoha stateful protocols** — most complex handlers; port late, budget extra fixture work. | They keep custom code; the handler interface already tolerates statefulness. |
| 4 | **HTTP devices from Android WebView** — cleartext + LAN discovery (no mDNS in v1 → manual IP entry, as devicePEQ does). | Network security config allows cleartext for local ranges; mDNS via a Capacitor plugin is a later nicety. |
| 5 | **Web SPP (Edifier via Web Serial)** — flaky today. Keep web support, or make Edifier Android-only? | Keep: `transports: ["usb-serial", "spp"]` with `status: "experimental"` on web; native SPP is the recommended path. |
| 6 | **Preset ↔ slot semantics** — some devices store per-slot EQ (FiiO USER1-10); app presets are separate from device slots. UI must keep the two concepts visually distinct (app preset library vs. device slot selector). | Addressed in Main-tab design; watch for user confusion in testing. |
| 7 | **devicePEQ drift** — devicePEQ keeps evolving after the port (it has active commits). | Accepted per project decision: one-time port, no ongoing sync. Track manually if a critical protocol fix lands there during M1. |
| 8 | **Freq snap tables** (Edifier) live in handler code but the adaptation engine needs them for diff preview. | Profile may declare `freqSnapTable` (data) that both handler and adaptation engine read — single source. |
