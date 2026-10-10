# uniPEQ — Architecture

> Parametric-EQ control app for USB and Bluetooth audio devices with a hardware EQ.
> Targets: **desktop web (Chrome/Edge)** and **Android (Capacitor)** from one codebase.
> Stack: **SvelteKit 2 (static SPA) + Svelte 5 + Tailwind 4 + bits-ui inside Capacitor 8**, on the
> [eqcaps](https://github.com/potatosalad775/eqcaps) packages, which own the device database, the
> protocols and the browser transports. How the app got here (the Ionic Vue prototype, its
> replacement, every decision since): [docs/rebuild-plan.md](docs/rebuild-plan.md). "Decision N"
> below refers to that file.

---

## 1. Goals & Non-Goals

### Goals
- Read and write the PEQ of the devices eqcaps knows, over USB HID, USB / Bluetooth serial and
  BLE GATT, in a desktop browser and in the Android app. One TypeScript engine on both; only the
  transports differ.
- The device's own limits drive the editor: band count, ranges, steps, filter types, presets.
  Every write is fitted to them, and anything that had to change is shown before it is written.
- Local presets: save, load, import and export (JSON, EqualizerAPO / AutoEq text), with a fit
  badge against the connected device.
- Three tabs: **EQ** (device + editor), **Presets**, **Settings**.
- Auto-write after an idle delay (manual Write for devices that restart to save); undo/redo.

### Non-Goals (v1)
- A device database or protocol code of our own: a missing device or a protocol bug is fixed in
  eqcaps.
- Network devices (WiiM, Luxsin) and non-EQ extras: dropped for now (decision 6).
- Cloud sync or accounts. iOS (its WebView has no USB or Bluetooth APIs).
- Frequency-response measurement overlays (modernGraphTool's job). The app's own EQ response graph
  with draggable band nodes is in scope; it is the EQ tab's centrepiece.

---

## 2. Platform Constraint Matrix

| API | Desktop Chrome/Edge | Android Chrome | Android WebView (Capacitor) |
|---|---|---|---|
| WebHID | ✅ | ❌ | ❌ |
| Web Serial | ✅ | ❌ | ❌ |
| WebUSB | ✅ | ✅ (HID class blocked) | ❌ |
| Web Bluetooth (BLE) | ✅ | ✅ | ❌ |
| Classic BT SPP | flaky (via Web Serial) | ❌ | ❌ |

Conclusions:
- **Web:** the bridge's browser transports (`@potatosalad775/eqcaps-device-bridge/browser`). WebHID
  is wired up; Web Serial and Web Bluetooth are Phase 5.
- **Android:** every byte goes through the app's own protocol-free Kotlin plugin
  (`native/device-io`, §9). USB HID works; USB serial, BLE and Classic SPP are Phase 6, postponed.
  Android Chrome can't reach HID at all, which is why Android is an app and not a web page.

---

## 3. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ UI: src/routes (one route per tab) + src/lib/components          │
│   atoms · layout · eq · device · presets · settings              │
├──────────────────────────────────────────────────────────────────┤
│ State: src/lib/stores (rune classes in .svelte.ts)               │
│   eq-store · eq-constraint-store · device-peq-store ·            │
│   preset-store · settings-store · notice-store                   │
│ Actions: src/lib/services                                        │
│   device-peq-service (connect, read, write, auto-write) ·        │
│   eqcaps-client · preset-storage · undo-redo-stack · logger      │
├──────────────────────────────────────────────────────────────────┤
│ App logic, framework-free                                        │
│   src/lib/device-peq: connect flows, push plan, sync status,     │
│     writable presets, errors, demo device                        │
│   src/lib/eq: filter model, biquad response, fit helpers,        │
│     preamp, graph scales, preset files, APO text                 │
├──────────────────────────────────────────────────────────────────┤
│ eqcaps (npm)                                                     │
│   core: profiles, resolveSlot, fit / complete / validate         │
│   client: index + profiles from the CDN, matchDevice, cache      │
│   device-bridge: protocol handlers, openDevice, transports       │
├──────────────────────────────────────────────────────────────────┤
│ Transports (bytes only)                                          │
│   Web: bridge/browser (WebHID; Web Serial, Web Bluetooth)        │
│   Android: src/lib/transports/native → DeviceIo plugin (Kotlin)  │
│   Demo: DemoHidTransport (simulated fiio-usb-hid)                │
└──────────────────────────────────────────────────────────────────┘
```

Rules:
- **Protocols and device data are eqcaps'.** The app never encodes a byte. The Kotlin plugin moves
  bytes and knows no vendor (eqcaps D27).
- **Boot bundle:** only `eqcaps-core` may be in it. `device-peq/connect.ts`, the bridge, the client
  and the embedded snapshot are reached through dynamic `import()`.
- **Edits go through `eqStore` methods**, never by assigning `filters`; each is an undo step or
  joins one (§7).
- **Capacitor stays in `src/lib/platform/` and `src/lib/transports/native/`.** Every platform export
  is a no-op on the web, so callers don't branch.

### Source layout

```
uniPEQ/
├── src/
│   ├── routes/                 # +page.svelte (EQ), presets/, settings/; ssr = false
│   ├── service-worker.ts       # web build's offline cache (registered by platform/pwa)
│   └── lib/
│       ├── components/
│       │   ├── atoms/          # Button, Switch, ListRow, Sheet, Menu, Slider, … (from modernGraphTool)
│       │   ├── layout/         # AppShell (tab bar ↔ side rail), PageHeader, Toast, BuildBadge
│       │   ├── eq/             # EqAppBar, EqGraph, BandList / BandEditor / BandSheet, Preamp*
│       │   ├── device/         # DeviceChip, DevicePanel, DeviceSheet, SyncBar, Review / Push dialogs
│       │   ├── presets/        # PresetsPanel, picker / save / edit dialogs
│       │   └── settings/       # LogDialog
│       ├── device-peq/         # connect, push-plan, sync-status, panel-status, writable, preset(-fit),
│       │                       # errors, demo, types (modernGraphTool's device-peq, adapted)
│       ├── eq/                 # model, biquad, eq-constraint, eq-preamp, preset-file, eq-apo, graph-scale, nudge
│       ├── services/           # device-peq-service, eqcaps-client, preset-storage, undo-redo-stack, logger
│       ├── stores/             # rune-class stores (above)
│       ├── platform/           # native.ts (back button, system bars), pwa (service worker), back-button,
│       │                       # haptics, save-file, build
│       ├── transports/native/  # DeviceIo typings, native HidTransport, HID report descriptor parser
│       ├── styles/theme.css    # semantic colour tokens
│       └── data/               # eqcaps-bundle.json (offline snapshot)
├── messages/                   # Paraglide strings: en.json, ko.json
├── native/device-io/           # Capacitor plugin `uni-peq-device-io` (Kotlin, Android only)
├── android/                    # Capacitor Android project
├── scripts/                    # android-install, android-hid-spike, data-snapshot
└── docs/                       # rebuild-plan.md (decisions, open items)
```

---

## 4. Devices and Transports

### 4.1 Transport interfaces

Handlers see only the bridge's two interfaces (`eqcaps-device-bridge/src/transport.ts`):

- **`HidTransport`**: `vendorId`, `productId`, `productName`, `collections` (from the report
  descriptor), `sendReport`, `sendFeatureReport`, `receiveFeatureReport`, `onInputReport`, `close`.
- **`StreamTransport`** (`kind: 'serial' | 'ble'`): `write`, `read(timeoutMs)` (buffered, nothing
  lost between reads), `close`; serial ports carry their USB ids or SPP service class, BLE devices
  their advertised name. Framing is the handler's job.

Implementations:

| Where | HID | Serial / BLE |
|---|---|---|
| Browser | bridge `requestHidDevice` / `grantedHidDevice` (WebHID) | bridge `requestSerialPort`, `requestBleDevice` (Phase 5) |
| Android | `transports/native/native-hid-transport.ts` over DeviceIo | Phase 6 (postponed) |
| Demo | `DemoHidTransport` in `device-peq/demo.ts` | — |

### 4.2 Connecting (`device-peq/connect.ts`)

A chooser gives an identity (USB ids and product string, or a Bluetooth name / service class).
The eqcaps client's `matchDevice` turns it into profiles; the profile's `protocol` says which
handler drives it; the bridge's `openDevice` opens it. The result:

- `connected`, with a `DeviceConnection` whose `profileSource` is `device` (its own profile),
  `group` (a family profile its identity can't narrow) or `guess` (no profile: `guessProtocol` by
  vendor id and a profile built from the handler's codec, `analyzeCodec`, flagged experimental);
- `choose`: several profiles fit, or (Android) several devices are attached; the user picks;
- `cancelled`, `unsupported` (nothing to drive it), `no-device` (Android: nothing drivable attached).

**Web:** the browser's chooser, filtered to the database's devices plus the vendors the bridge can
guess. **Android:** no chooser; `connectNativeHid` lists attached USB HID devices, keeps the
drivable ones, opens a single one after the system permission prompt, and asks when there are
several. The service follows the plugin's USB events (`watchUsb`): plugging in a drivable device
while nothing is connected and the app is in view connects it; unplugging the connected one
(matched by `DeviceConnection.usbDeviceName`) disconnects it at once, keeping the known device.

The connect flow lives in `device-peq-service.svelte.ts`, not in a screen, so a connection outlives
tab switches. Before a connection, the phone's device chip connects straight away; the device sheet
opens only when the attempt needs a pick or has something to say.

### 4.3 Device data (`services/eqcaps-client.ts`, decision 3)

- `index.json` and profiles come from the eqcaps CDN, revalidated on every launch (`ttl: 0`) and
  cached in localStorage, so a fixed or added profile reaches users without an app update.
- The embedded snapshot (`src/lib/data/eqcaps-bundle.json`, `npm run data:snapshot` before a
  release) is used only when neither network nor cache answers: an offline first launch.
- **Writable presets** (decision 1): eqcaps marks the user memories `writable` (format 1.1) where
  a list mixes them with built-in curves; `devicePeqStore.writableSlots` takes the marked ones, or
  every preset but the bypass one when none is marked.
- **Demo device** (decision 2): an app-local profile and a simulated `fiio-usb-hid` device that runs
  the real bridge code. Offered in every build (decision 26), so the app can be tried, and
  reviewed, without hardware. Its connection's `profileSource` is `demo`: the device panel shows a
  "Simulated device" badge and a note, without an eqcaps status or links.

---

## 5. Reading and Writing

`src/lib/device-peq/` follows modernGraphTool's `device-peq/AGENTS.md` invariants, with the third
changed by decision 25:

1. **Fit before every write.** The bridge never clamps or pads. `push-plan.ts` runs eqcaps `fit`
   and `complete` and reports what changed; a write whose values had to change waits for review.
2. **Never retarget.** Read and write only a reachable preset: on a built-in preset Write is off,
   it is never redirected to another slot.
3. **The device's EQ is what the list edits.** Connecting, and picking another preset in Device
   EQ, read it into the list as a fresh start (no undo back past it, `eqStore.open`), unless the
   list holds changes the device never got (`devicePeqStore.unwritten` / `hasUnwritten`); then the
   sync bar offers Write and Read. The Read button's read stays an undo step. Nothing ever refits
   the list on its own: a list that doesn't fit is flagged, and **Fit** (`fitFilters`) is the
   user's action.
4. **One status line**: the EQ tab's sync bar (`device-peq/sync-status.ts`, ranked over
   `panel-status.ts`), also the live region screen readers hear. The device chip's dot repeats it.

Writing:
- **Auto-write** (`device-peq-service.svelte.ts`, decision 20): after `autoPushDelayMs` idle
  (default 1.5 s), only the latest state, edits during a write coalesced into the next one; pauses
  for review when a write would change values. A failed write stops auto-write on that connection.
- **Manual-save mode:** a device with `disconnectOnSave` gets no auto-write, only Write, then
  Reconnect.
- **Review** is `devicePeqService.review`, shown by `ReviewDialog`; the sync bar's Write and the
  device panel share it.
- **No editing while disconnected** (decision 25): `devicePeqStore.canEdit` (connected and not
  waiting to reconnect), surfaced as `eqConstraintStore.editable`, gates the graph, band and preamp
  rows and editors, Add, Fit, undo/redo and Load preset. A disconnect keeps
  `devicePeqStore.knownDevice`, so the list stays on screen read-only (it can still be saved as a
  preset) and the sync bar offers Connect.

---

## 6. EQ Model and Constraints

- **Filters** (`eq/model.ts`) use eqcaps type codes (`PK LSC HSC LPQ HPQ BP NO AP`), in eqcaps units
  (Hz, dB, RBJ Q). No per-band on/off (decision 22): no protocol has one.
- **Preamp:** derived from the filters while Auto (`eq/eq-preamp.ts`, never positive), else the value
  read or set. How it is shown follows the profile's `preamp.mode` (`eq/preamp-control.ts`).
- **Constraints** (`stores/eq-constraint-store.svelte.ts`): the connected (or last known) profile,
  resolved per band with `resolveSlot`: ranges, steps, fixed value lists, locked fields, allowed
  types. `UNCONSTRAINED` is only the placeholder before any device.
- **Fixed band counts** (decision 23): with a profile `bandCount` the list is that many rows; a band
  is reset rather than removed; shorter presets are padded.
- **Edits** go through `eqStore` (`update`, `add`, `remove`, `setPreamp`, `setAutoPreamp`,
  `replace`, `undo`, `redo`; a band reset is an `update` to `flatBand`). An edit first projects only the fields it changes onto the band's slot
  (`editFilter`). Slider drags and held keys coalesce into one undo step by a key; a gesture calls
  `record()` at its start.
- **Graph** (`components/eq/EqGraph.svelte`, `eq/graph-scale.ts`): one SVG on pointer events; drag
  for frequency and gain, pinch or wheel for Q, focusable nodes with musical keyboard steps
  (`eq/nudge.ts`).

---

## 7. Presets

- **Format** (`eq/preset-file.ts`): `PeqPreset` schemaVersion 2 with eqcaps type codes; v1 files
  (the prototype's) are migrated whenever read, stored as v2 on the next save.
- **Storage** (`services/preset-storage.ts`): an index plus one entry per preset in Web Storage,
  which the Android WebView keeps. Presets are stored unconstrained; constraints apply only when
  loaded onto a device.
- **Import:** JSON (always a fresh id) and EqualizerAPO / AutoEq text (`eq/eq-apo.ts`).
  **Export:** JSON or APO text, downloaded on the web; on Android written to the cache and handed to
  the share sheet (`platform/save-file.ts`).
- **Fit badge** per preset while connected (`device-peq/preset-fit.ts`): the same `planPush` a
  write runs.

---

## 8. UI

Layout principles: the EQ graph is the main element; desktop and phone each get an intentional
layout. One breakpoint, `wide:` (900 px): side rail and two columns above it, bottom tab bar
below. Touch sizing follows the pointer, not the width (`touch:` variant, 48 px targets). Colours
come only from the semantic tokens in `src/lib/styles/theme.css` (light + dark). Atoms and
`device-peq/` files copied from modernGraphTool name their source path and commit in a header
comment.

### 8.1 EQ tab
- **Phone** (decisions 22, 23): app bar (device chip, undo/redo, overflow menu with Load preset,
  Save preset, Fit), the graph pinned edge to edge, the preamp row and band rows as the only
  scrolling part, the sync bar above the tab bar. The device panel is a sheet from the chip; the
  selected band's editor and the preamp editor are sheets.
- **Wide:** graph on the left; device panel and the band card on the right, the selected row opening
  its editor in place.
- **Disconnected:** the graph and the rows stay, dimmed and read-only, until the device is back.
- **No device:** a prompt to connect (and the demo device); nothing to
  edit until a profile says what the device accepts.

### 8.2 Presets tab
Search over names and tags, save, rename, duplicate, edit tags, import, export, delete, and the fit
badge against the connected device.

### 8.3 Settings tab
Theme (system / light / dark), language (en / ko, Paraglide), auto-write switch and delay, verbose
logging with a log viewer (clear, export), the eqcaps data version and profile count, version.

### 8.4 Stores
- `device-peq-store` — connection, profile, presets (slots), selection, read / write targets, sync
  flags, `knownDevice`, status message.
- `eq-store` — filters, preamp, Auto preamp, selected band, undo/redo history.
- `eq-constraint-store` — the per-band domains and the fitted list, derived.
- `preset-store` — index and bodies over `preset-storage`.
- `settings-store` — theme, auto-write, logging; localStorage key `unipeq.settings`.
- `notice-store` — the shell's toast.
- `update-store` — a newer version (a waiting service worker, or a GitHub release for the sideload
  APK) for the shell's `UpdatePrompt`.

### 8.5 Platform shell
- Android back is a handler stack (`platform/back-button.ts`): overlays register with `onBack()`;
  the shell sends other tabs home; on home the app goes to the background, so a connection
  survives.
- System bars through Capacitor core `SystemBars`; content pads with `--inset-*` from `layout.css`.
- Haptics on native only (a tick per write, an error buzz on failure).
- Dev and debug builds show a DEV / DEBUG badge in each header; a release (`vite build`,
  production mode) drops it.
- The web build is an installable PWA: `static/manifest.webmanifest` (icons from
  `npm run icons`) and `src/service-worker.ts`, registered by `platform/pwa.ts` on the web only
  (not on native, not in `vite dev`). The worker precaches the shell, chunks and `static/` per
  build version and answers every navigation with the cached shell, so the app runs offline;
  Pretendard's subsets are cached as they load. A newer deploy's worker waits: the page checks
  hourly and on becoming visible, and `UpdatePrompt` offers Reload, never automatic, because a
  reload drops the device connection and unwritten edits.
- Updates on Android: Play updates its own installs. The sideload APK attached to GitHub releases
  (app id `kr.potatosalad775.unipeq.sideload`, so it sits beside the Play app;
  `VITE_DISTRIBUTION=github`, `distribution` in `platform/build.ts`) asks GitHub's
  `releases/latest` at launch and on resume, at most every 6 hours (`platform/release-updates.ts`,
  `services/release-check.ts`); a newer release with its APK attached shows in `UpdatePrompt` with
  Download (the release page). A dismissed version isn't offered again.

---

## 9. Android Native Layer (`native/device-io`)

One local Capacitor plugin, **`DeviceIo`** (package `uni-peq-device-io`, a `file:` dependency so
`cap sync` registers it; decision 14). Kotlin only; its typings and the `HidTransport` wrapper are
in `src/lib/transports/native/`. It moves bytes and knows no protocol.

**USB HID** (`DeviceIoPlugin.kt`, `UsbHidConnection.kt`), working on real hardware since Phase 0:

| Call / event | What it does |
|---|---|
| `list()` | Attached USB devices: ids, names, permission, HID interface numbers |
| `requestPermission({ deviceName })` | The system's USB permission prompt |
| `describe({ deviceName })` | Force-claims each HID interface and reads its report descriptor |
| `open({ deviceName, interfaceNumber })` | Claims the interface, starts the interrupt IN loop, returns a handle |
| `sendReport` / `sendFeatureReport` / `receiveFeatureReport` | Interrupt OUT or SET_REPORT; feature reports over control transfers |
| `close({ handle })` | Releases the interface |
| `inputReport` event | Interrupt IN packets, report id first on numbered reports |
| `deviceAttached` / `deviceDetached` events | USB broadcasts |

Bytes cross the bridge as base64; failures reject with code `transport`. Android may give a USB
audio device's HID interface to the system, so the plugin claims with `force = true`.

**Planned (Phase 6, postponed until serial and Bluetooth are decided):** `StreamTransport` modules for USB serial (CDC-ACM or
`usb-serial-for-android`), BLE GATT (`BluetoothGatt`, MTU, notifications) and Classic SPP
(`BluetoothSocket` RFCOMM to bonded devices), with `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT`
(`neverForLocation`) on API 31+.

---

## 10. Testing

- **Vitest, two projects** (`vite.config.ts`): `*.spec.ts` in Node, `*.svelte.spec.ts` in headless
  Chromium (browser mode, 1280×800 by default; phone-layout specs set the viewport). Component specs
  load no Tailwind, so they assert roles, text and behaviour, not layout.
- **Protocols are tested in eqcaps** (handler fixtures, conformance vectors). The app tests what it
  adds: connect flows against the real bridge with mocked choosers and a fake plugin
  (`connect.spec.ts`), the native transport against a fake plugin, the demo device end to end through
  `openDevice` (`demo.spec.ts`), the push plan, sync status,
  the preset file and APO formats, graph gestures, the editor's domains and the stores.
- **On hardware**, by hand: the open checks are listed in
  [docs/rebuild-plan.md](docs/rebuild-plan.md#open). `npm run android:hid-spike` runs a raw pull through
  the plugin on a debug build.
- Before a commit: `npm run check`, `npm run lint`, `npm test`.

---

## 11. Roadmap

Open items: [docs/rebuild-plan.md](docs/rebuild-plan.md#open). In short:

- **Phase 5:** Serial and Bluetooth in the browser (postponed).
- **Phase 6:** the full Android plugin: serial, BLE and SPP postponed; launch-on-attach (a
  `device_filter.xml` from eqcaps vendor ids) not now.
- **Network devices** (decision 6): modernGraphTool's `device-peq/network.ts` is the starting point.

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Android HID claim** may fail on some device families or OEM builds. | Passed on a Samsung phone with a walkplay dongle (Phase 0). A family that fails stays web-only. Feature reports are still unexercised on Android. |
| 2 | **WebView feel:** graph drags must hold 60 fps on mid-range phones. | One SVG, edits once per animation frame; check on real phones, not desktop emulation. |
| 3 | **Draft data:** most eqcaps profiles are seeded drafts with limits taken from devicePEQ's code. | The status badge shows it; wrong limits are reported upstream from the device panel's link. |
| 4 | **Copy drift** from modernGraphTool's `device-peq/` and atoms. | Header comments name the source path and commit, so the copies can be diffed upstream. |
| 5 | **Breaking eqcaps releases** (0.x). | Caret ranges; read the eqcaps changelog and DECISIONS before bumping. |
| 6 | **Web SPP** (Bluetooth serial through Web Serial) is flaky and names no device. | The user picks the device for a Bluetooth port; native SPP (Phase 6) is the reliable path. |
| 7 | **Preset vs. device memory:** app presets and the device's preset slots are different things. | The UI keeps them apart (Presets tab vs. Device EQ); watch for confusion in testing. |
