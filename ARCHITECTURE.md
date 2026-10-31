# uniPEQ — Architecture

> Parametric-EQ control app for USB and Bluetooth audio devices with a hardware EQ.
> Targets: **desktop web (Chrome/Edge)** and **Android (Capacitor)** from one codebase.
> Stack: **SvelteKit 2 (static SPA) + Svelte 5 + Tailwind 4 + bits-ui inside Capacitor 8**, on the
> [eqcaps](https://github.com/potatosalad775/eqcaps) packages, which own the device database, the
> protocols and the browser transports. The rebuild's history (the Ionic Vue prototype, its
> phases and numbered decisions) is in git: `docs/rebuild-plan.md` at `7d2216a`.

---

## 1. Goals and non-goals

**Goals**
- Read and write the PEQ of the devices eqcaps knows, in a desktop browser and in the Android app.
  One TypeScript engine on both; only the transports differ.
- The device's limits drive the editor: band count, ranges, steps, filter types, presets. Every
  write is fitted to them, and anything that had to change is shown before it is written.
- Local presets: save, load, import, export (JSON, EqualizerAPO / AutoEq text), with a fit badge
  against the connected device.
- Three tabs: **EQ** (device + editor), **Presets**, **Settings**. Auto-write after an idle delay;
  undo/redo.

**Non-goals**
- A device database or protocol code of our own: a missing device or a protocol bug is fixed in
  eqcaps.
- Network devices (WiiM, Luxsin) and non-EQ extras, for now. modernGraphTool's
  `device-peq/network.ts` drives them behind the same `PeqDevice` shape, so bringing them back is a
  copy.
- Cloud sync, accounts, iOS (its WebView has no USB or Bluetooth APIs), measurement overlays
  (modernGraphTool's job).

---

## 2. Platforms

| API | Desktop Chrome/Edge | Android Chrome | Android WebView (Capacitor) |
|---|---|---|---|
| WebHID | ✅ | ❌ | ❌ |
| Web Serial | ✅ | ❌ | ❌ |
| WebUSB | ✅ | ✅ (HID class blocked) | ❌ |
| Web Bluetooth (BLE) | ✅ | ✅ | ❌ |
| Classic BT SPP | flaky (via Web Serial) | ❌ | ❌ |

- **Web:** the bridge's browser transports (`@potatosalad775/eqcaps-device-bridge/browser`). Only
  WebHID is wired up.
- **Android:** every byte goes through the app's own protocol-free Kotlin plugin (`native/device-io`,
  §9). Only USB HID is wired up. Android Chrome can't reach HID at all, which is why Android is an
  app (Capacitor: one TS engine on both platforms; Flutter or native Kotlin would mean porting the
  bridge).

---

## 3. Layers

```
┌──────────────────────────────────────────────────────────────────┐
│ UI: src/routes (one route per tab) + src/lib/components          │
│   atoms · layout · eq · device · presets · settings              │
├──────────────────────────────────────────────────────────────────┤
│ State: src/lib/stores (rune classes in .svelte.ts)               │
│ Actions: src/lib/services                                        │
│   device-peq-service (connect, read, write, auto-write) ·        │
│   eqcaps-client · preset-storage · undo-redo-stack · logger      │
├──────────────────────────────────────────────────────────────────┤
│ App logic, framework-free                                        │
│   src/lib/device-peq: connect flows, push plan, sync status,     │
│     preset fit, errors, demo device                              │
│   src/lib/eq: filter model, biquad response, fit helpers,        │
│     preamp, graph scales, preset files, APO text                 │
├──────────────────────────────────────────────────────────────────┤
│ eqcaps (npm)                                                     │
│   core: profiles, resolveSlot, fit / complete / validate         │
│   client: index + profiles from the CDN, matchDevice, cache      │
│   device-bridge: protocol handlers, openDevice, transports       │
├──────────────────────────────────────────────────────────────────┤
│ Transports (bytes only)                                          │
│   Web: bridge/browser (WebHID)                                   │
│   Android: src/lib/transports/native → DeviceIo plugin (Kotlin)  │
│   Demo: DemoHidTransport (simulated fiio-usb-hid)                │
└──────────────────────────────────────────────────────────────────┘
```

Rules:
- **Protocols and device data are eqcaps'.** The app never encodes a byte; the Kotlin plugin moves
  bytes and knows no vendor.
- **Boot bundle:** only `eqcaps-core` may be in it. `device-peq/connect.ts`, the bridge, the client
  and the embedded snapshot are reached through dynamic `import()`.
- **Capacitor stays in `src/lib/platform/` and `src/lib/transports/native/`.** Every platform export
  is a no-op on the web, so callers don't branch.
- **eqcaps comes from npm.** To try unreleased eqcaps changes, install the tarballs from
  `npm run release -- <version> --pack` in eqcaps, never a `file:` link. Pin caret ranges and read
  eqcaps' changelog and DECISIONS before a bump (0.x breaks).
- **Reuse from modernGraphTool is copy-and-adapt.** Copied files (atoms, `device-peq/`) name their
  source path and commit in a header comment so they can be diffed against upstream; there is no
  shared package. Copied code is adapted to this app's model (eqcaps type codes, no channel), not
  the other way round.

### Source layout

```
src/
├── routes/                 # +page.svelte (EQ), presets/, settings/; ssr = false
├── service-worker/         # web build's offline cache (registered by platform/pwa)
└── lib/
    ├── components/
    │   ├── atoms/          # Button, Switch, ListRow, Sheet, Menu, Slider, … (from modernGraphTool)
    │   ├── layout/         # AppShell (tab bar ↔ side rail), PageHeader, Toast, BuildBadge
    │   ├── eq/             # EqAppBar, EqGraph, BandList / BandEditor / BandSheet, Preamp*
    │   ├── device/         # DeviceChip, DevicePanel, DeviceSheet, SyncBar, Review / Push dialogs
    │   ├── link/           # LinkSheet (code), LinkApprovalDialog, LinkBatteryDialog
    │   ├── presets/        # PresetsPanel, picker / save / edit dialogs
    │   └── settings/       # LogDialog, licenses
    ├── device-peq/         # connect, push-plan, sync-status, panel-status, preset-fit, errors, demo
    ├── link/               # the modernGraphTool link: store, service, bar status, self-check
    ├── eq/                 # model, biquad, eq-constraint, eq-preamp, preset-file, eq-apo, graph-scale, nudge
    ├── services/           # device-peq-service, eqcaps-client, preset-storage, undo-redo-stack, logger
    ├── stores/             # rune-class stores (§8.4)
    ├── platform/           # back button, system bars, app state, link, pwa, haptics, save-file, build, release updates
    ├── transports/native/  # DeviceIo typings, native HidTransport, HID report descriptor parser
    ├── styles/theme.css    # semantic colour tokens
    └── data/               # eqcaps-bundle.json (offline snapshot)
messages/                   # Paraglide strings: en.json, ko.json
native/device-io/           # Capacitor plugin `uni-peq-device-io` (Kotlin, Android only)
android/                    # Capacitor Android project
scripts/                    # android install / release / HID spike, release, data snapshot, icons, licenses
```

---

## 4. Devices and transports

### 4.1 Transport interfaces

Handlers see only the bridge's two interfaces (`eqcaps-device-bridge/src/transport.ts`):

- **`HidTransport`**: `vendorId`, `productId`, `productName`, `collections` (from the report
  descriptor), `sendReport`, `sendFeatureReport`, `receiveFeatureReport`, `onInputReport`, `close`.
- **`StreamTransport`** (`kind: 'serial' | 'ble'`): `write`, `read(timeoutMs)`, `close`. Framing is
  the handler's job. Not used by the app yet.

| Where | HID |
|---|---|
| Browser | bridge `requestHidDevice` / `grantedHidDevice` (WebHID) |
| Android | `transports/native/native-hid-transport.ts` over DeviceIo |
| Demo | `DemoHidTransport` in `device-peq/demo.ts` |

### 4.2 Connecting (`device-peq/connect.ts`)

An identity (USB ids and product string) goes through the eqcaps client's `matchDevice` to
profiles; the profile's `protocol` picks the handler; the bridge's `openDevice` opens it. When a
matched profile has a firmware range and the top matches share a handler that reads the firmware
(USB HID only, already open), the firmware is read and the device matched again with it, so
profiles that only the firmware tells apart (the Fosi DS3's 8- and 32-band firmware) don't ask.
Only then: a device that doesn't answer costs the handler's timeout. Results:

- `connected`, with a `DeviceConnection` whose `profileSource` is `device` (its own profile),
  `group` (a family profile its identity can't narrow), `guess` (no profile: `guessProtocol` by
  vendor id and a profile built from the handler's codec, `analyzeCodec`, flagged experimental) or
  `demo`;
- `choose`: several profiles fit, or (Android) several devices are attached; the user picks;
- `cancelled`, `unsupported` (nothing to drive it), `no-device` (Android: nothing drivable attached).

**Web:** the browser's chooser, filtered to the database's devices plus the vendors the bridge can
guess. **Android:** no chooser; `connectNativeHid` lists attached USB HID devices, keeps the
drivable ones, opens a single one after the system permission prompt (a refusal reads as a
cancelled chooser) and asks when there are several. The service follows the plugin's USB events
(`watchUsb`): plugging in a drivable device while nothing is connected and the app is in view
connects it; unplugging the connected one (`DeviceConnection.usbDeviceName`) disconnects it at
once, keeping the known device so a replug reconnects. No launch-on-attach.

The connect flow lives in `device-peq-service.svelte.ts`, not in a screen, so a connection outlives
tab switches. Before a connection, the device chip (and Connect in the empty state and sync bar)
connects straight away; the device sheet opens only when the attempt needs a pick or has something
to say.

### 4.3 Device data (`services/eqcaps-client.ts`)

- `index.json` and profiles come from the eqcaps CDN, cached in localStorage and revalidated on
  every launch (`ttl: 0`), so a fixed or added profile reaches users without an app update. GitHub
  Pages doesn't expose `ETag` to cross-origin reads and refuses preflights, so the client stores no
  ETag; the WebView's HTTP cache revalidates instead, at near-zero cost.
- The embedded snapshot (`src/lib/data/eqcaps-bundle.json`, refreshed by `npm run data:snapshot`
  before a release, never during a build, so builds stay offline and reproducible) is used only
  when neither network nor cache answers. It is imported `?raw` inside the client's dynamic chunk;
  the root layout starts `loadIndex()` after mount without awaiting it.
- **Writable presets:** eqcaps marks user memories `writable` where a list mixes them with built-in
  curves; `devicePeqStore.writableSlots` takes the marked ones, or every preset but the bypass one
  when none is marked.
- **Demo device** (`device-peq/demo.ts`): an app-local profile (`unipeq-demo-dac`, 10 bands) and a
  simulated `fiio-usb-hid` device that runs the real bridge code; its memories live for the page.
  It ships in every build, release included, because Play's reviewers and most people trying the
  app have no PEQ device, and the EQ tab has nothing to edit without one. The device panel shows a
  "Simulated device" badge instead of an eqcaps status or links.

---

## 5. Reading and writing

`src/lib/device-peq/` follows modernGraphTool's `device-peq/AGENTS.md` invariants, the third one
changed:

1. **Fit before every write.** The bridge never clamps or pads. `push-plan.ts` runs eqcaps `fit`
   and `complete` and reports what changed; a write whose values had to change waits for review.
2. **Never retarget.** Read and write only a reachable preset: on a built-in preset Write is off,
   never redirected to another slot. Picking a writable preset is the user's call.
3. **The device's EQ is what the list edits.** The app is a companion to one device, so:
   - Connecting, and picking another preset in Device EQ, reads it into the list as a fresh start
     (`eqStore.open`: no undo back past it, which would hand the device another device's or
     preset's bands). The Read button's read stays an undo step.
   - **Except over unwritten changes.** `devicePeqStore.hasUnwritten` compares the list with the
     last read or write; a disconnect or preset change records `unwritten`. Reconnecting the same
     device (name and profile) with unwritten changes doesn't read: the sync bar offers Read and
     Write. Connecting never writes. Another device is read regardless.
   - Nothing refits the list on its own: a list that doesn't fit is flagged, and **Fit**
     (`fitFilters`) is the user's action.
4. **One status line**: the EQ tab's sync bar (`device-peq/sync-status.ts`, ranked over
   `panel-status.ts`), also the live region screen readers hear. The device chip's dot repeats it.
   The modernGraphTool link shares the bar rather than adding a row (§10).
   Every device operation (`DeviceOperation`: read, write, switch, control) shows busy there while
   it runs, and its result after, even one that leaves the EQ alone ("Set Mic gain to 12 dB"); the
   result stands for "in sync" until the list changes. `syncStatus` keys its busy text by the
   operation, so a new one doesn't type-check until the bar can say it.
   No toast per write; a failure gets a toast and an error haptic.

Writing:
- **Auto-write** (`device-peq-service.svelte.ts`): after `autoPushDelayMs` idle (default 1.5 s),
  only the latest state, edits during a write coalesced into the next one; pauses for review when a
  write would change values. A failed write stops auto-write on that connection.
- **Volume warning** (`VolumeWarningDialog`, in the shell): a write can pop or jump in level
  mid-playback, so the first write on each connection waits for the user to pause or lower the
  volume. With auto-write on it comes on connecting (or switching it on); otherwise at the first
  Write or preset switch, which runs once they go on. A linked modernGraphTool shows it too
  (`status.consent`) and either side answers. Not now writes nothing and stops auto-write on that
  connection. Not for the demo device; a setting silences it.
- **Manual-save mode:** a device with `disconnectOnSave` gets no auto-write, only Write. It
  restarts to save, so the write closes it and waits up to 5 s for it to come back (on the web the
  bridge's `waitForGrantedHidDevice`, skipping the old handle unless it is still there after 1.5 s,
  as the FOLA's is on macOS; on Android the next attach, while
  its detach is ignored), then reopens it with the volume warning still answered. Not back in time,
  or no longer granted to the site, the sync bar offers Reconnect, which may need the chooser. The
  log records when the device went and came back.
- **Review** is `devicePeqService.review`, shown by `ReviewDialog`; the sync bar's Write and the
  device panel share it.
- **No editing while disconnected:** `devicePeqStore.canEdit` (connected, not waiting to
  reconnect), surfaced as `eqConstraintStore.editable`, gates the graph, band and preamp rows and
  editors, Add, Fit, undo/redo and Load preset. A disconnect keeps `devicePeqStore.knownDevice`, so
  the list stays on screen read-only (it can still be saved as a preset) and the sync bar offers
  Connect. Editing against an absent device would build changes it never confirmed.

Device controls (eqcaps `protocol.controls`: volume, gain, DAC filter, USB mode, …):
- **Read on connecting and reopening,** with the firmware, only for a device that has controls;
  a failed read leaves them unshown and the EQ works without them. Reading and writing the EQ never
  touches them.
- **Written only when the user changes one** (`devicePeqService.setControl`; a slider when let
  go), said in the sync bar as the value read back, then all are read again: one control can decide which others exist (the DS3's USB mode
  hides its DAC filter and shows its game mode). `DeviceControls` in the device panel shows only
  the ones the device has now, named by `role` (`device-peq/controls.ts`).
- **A control that restarts the device** (`reconnect`) asks first, then is followed as a save
  that restarts: the device is closed, waited for and reopened, or the sync bar offers Reconnect.
  Some come back under other USB ids (the DS3's USB mode), so reopening looks for every exact
  identity the profile lists (`device-peq/usb-identities.ts`). In the browser a device without a
  USB serial number loses its grant when it re-enumerates (the DS3 on every USB mode switch), and
  only the chooser finds it again. So there the wait is 1.5 s (a device that keeps its HID handle,
  as in the DS3's game mode, is back by then), then the chooser opens on the click that confirmed
  the change, which still allows it; past that, Reconnect (a click) opens it. Android asks for USB
  permission on the attach and keeps the full wait.
- **A value that stops the EQ applying** (`disablesEq`, the DS3's upsampling) is said under the
  control and in the sync bar, above everything but a failure. The app doesn't change it back on
  its own: controls are written only on the user's change.

---

## 6. EQ model and constraints

- **Filters** (`eq/model.ts`) use eqcaps type codes (`PK LSC HSC LPQ HPQ BP NO AP`) and units (Hz,
  dB, RBJ Q). **No per-band on/off:** no eqcaps protocol has one (`setEnabled` is the whole EQ), and
  faking it as 0 dB still took a slot and turned gainless bands into peaks. A/B listening uses the
  device's EQ on/off.
- **Preamp:** derived from the filters while Auto (`eq/eq-preamp.ts`: every type counts, never
  positive, rounded up to 0.1 dB), else the value read or set. How it is shown follows the
  profile's `preamp.mode` (`eq/preamp-control.ts`).
- **Auto is the default,** so no edit makes the EQ louder than the source. Written and shown as
  `eqConstraintStore.preampValue`: Auto's value moved *down* onto the device's grid
  (`headroomPreamp`; nearest would hand back headroom, and its change would pause auto-write). A
  read keeps Auto where the device holds that value, else takes the device's preamp as fixed.
- **Constraints** (`stores/eq-constraint-store.svelte.ts`): the connected (or last known) profile,
  resolved per band with `resolveSlot`: ranges, steps, value lists, locked fields, allowed types.
  `UNCONSTRAINED` is only the placeholder before any device and the specs' profile. No constraint
  picker: the device is the constraint.
- **Fixed band counts:** with a profile `bandCount` the list is that many rows. A band is **reset**
  to flat (`flatBand`), not removed; only rows past the count can be removed; shorter presets are
  padded. Add and remove stay for a profile with no band count.
- **Edits** go through `eqStore` (`update`, `add`, `remove`, `setPreamp`, `setAutoPreamp`,
  `replace`, `open`, `undo`, `redo`). An edit first projects only the fields it changes onto the
  band's slot (`editFilter`). Slider drags and held keys coalesce into one undo step by a key; a
  gesture calls `record()` at its start.
- **Graph** (`components/eq/EqGraph.svelte`, `eq/graph-scale.ts`): one SVG on pointer events, not
  d3, so touch and mouse share a path and specs drive it with synthetic events. Drag for frequency
  and gain, pinch or wheel for Q, a drag is one undo step, edits run once per animation frame, the
  dB range holds during a gesture. Nodes are focusable buttons with musical keyboard steps
  (`eq/nudge.ts`), shared with the editor.
- **Frequencies in full** (`1234 Hz`, never `1.2k`, no thousands separator) to match the number box;
  graph ticks keep `1k`.

---

## 7. Presets

- **Format** (`eq/preset-file.ts`): `PeqPreset` schemaVersion 2 with eqcaps type codes. v1 files
  (the prototype's) are migrated whenever read and stored as v2 on the next save; v1's switched-off
  bands, `BSF` and `CQ` are dropped with a warning.
- **Storage** (`services/preset-storage.ts`): an index plus one entry per preset in Web Storage.
  Presets are stored unconstrained; constraints apply only when loaded onto a device.
- **Import:** JSON (always a fresh id) and EqualizerAPO / AutoEq text (`eq/eq-apo.ts`: every eqcaps
  type plus APO shorthands, Q from `BW Oct`, `Preamp:` summed; one-ear `Channel:` sections and
  slope variants skipped and counted). **Export:** JSON or APO text, downloaded on the web; on
  Android written to the cache and handed to the share sheet (`platform/save-file.ts`).
- **Fit badge** per preset while connected (`device-peq/preset-fit.ts`): the same `planPush` a
  write runs.

---

## 8. UI

The EQ graph is the main element; desktop and phone each get an intentional layout. One layout
breakpoint, `wide:` (900 px): side rail and two columns above, bottom tab bar below. Touch sizing
follows the **pointer, not the width** (`touch:` = `pointer: coarse`, 48 px targets), so a mouse
keeps compact sizes at any width. On phones, Android patterns: switches trailing their label, whole
rows tappable, `SelectMenu` anchored to its row for one-of-N, `Menu` for overflow, `Sheet` for
panels, supporting text instead of `?` popovers. Colours only from the semantic tokens in
`src/lib/styles/theme.css` (light + dark).

### 8.1 EQ tab
- **Phone:** app bar (device chip, undo/redo, overflow with Load preset, Save preset, Fit), the
  graph pinned edge to edge, the preamp row and band rows as the only scrolling part, the sync bar
  above the tab bar. Device panel, band editor and preamp editor are sheets.
- **Wide:** graph on the left (a card); device panel and band card on the right, the selected row
  opening its editor in place.
- **Disconnected:** graph and rows stay, dimmed and read-only.
- **No device:** a prompt to connect, and the demo device.

### 8.2 Presets tab
Search over names and tags, save, rename, duplicate, edit tags, import, export, delete, and the fit
badge against the connected device.

### 8.3 Settings tab
Theme, language (en / ko), auto-write switch, volume warning and delay (0.5–5 s), verbose logging with a log viewer
(clear, export), eqcaps data version and profile count, app version, and Open-source licenses: the
GPL text, then `virtual:third-party-licenses` (`scripts/third-party-licenses.ts`: npm packages from
the client bundle's module graph, Android libraries listed by hand and shown only in the app).

### 8.4 Stores
- `device-peq-store`: connection, profile, presets (slots), read / write targets, sync flags,
  `knownDevice`, `unwritten`, status.
- `eq-store`: filters, preamp, Auto preamp, selected band, undo/redo history.
- `eq-constraint-store`: per-band domains, the fitted list, `editable`; derived.
- `preset-store`: index and bodies over `preset-storage`.
- `settings-store`: theme, auto-write, logging; localStorage key `unipeq.settings`.
- `notice-store`: the shell's toast.
- `update-store`: a newer version (waiting service worker, or a GitHub release for the sideload
  APK) for the shell's `UpdatePrompt`.

### 8.5 Platform shell
- Tabs are routes (`/`, `/presets`, `/settings`) switched with `goto(…, { replace: true })`: no tab history.
- Android back is a handler stack (`platform/back-button.ts`): overlays register with `onBack()`;
  the shell sends other tabs home; on home the app goes to the background (`minimizeApp`, not
  `exitApp`), so a connection survives.
- System bars through Capacitor core `SystemBars`; content pads with `--inset-*` from `layout.css`.
  The WebView draws under the bars only on WebView ≥ 140.
- Haptics on native only: a tick per write, an error buzz on failure.
- Debug builds (Vite mode ≠ production, `isDebugBuild`) show a DEV / DEBUG badge and the HID spike
  hook. The APK's build type doesn't decide it: debug and release APKs package the same `dist/`.
- **PWA (web build):** `src/service-worker/`, registered by `platform/pwa.ts` on the web only,
  precaches the shell, chunks and `static/` per build and serves the cached shell for every
  navigation, so the app runs offline. A newer deploy's worker waits; `UpdatePrompt` offers
  Reload, never automatic, because a reload drops the connection and unwritten edits.
- **Android updates:** Play updates its installs. The sideload APK (`distribution` = `github` in
  `platform/build.ts`) asks GitHub's `releases/latest` at launch and on resume, at most every 6 h
  (`platform/release-updates.ts`, `services/release-check.ts`), and offers the release page.
- **Unsupported environments:** `platform/environment.ts` decides by capability (the app, or
  `'hid' in navigator`, which `canConnectUsb` reads) and uses the user agent only to pick the
  advice: an Android browser is sent to the app, iOS is told it can't work, other desktop browsers
  are sent to Chrome or Edge. The EQ tab's empty state and the device panel say it on every
  visit; the demo device stays available.
- **Intro:** `IntroDialog` (in the shell) opens once per install (`stores/intro-store.svelte.ts`,
  a versioned seen flag) and from Settings. An unsupported environment gets its advice as the
  first page, and an Android browser only that page. A launch from a modernGraphTool link skips
  it, and a link that starts while it's open puts it off to the next launch, so it never covers
  the approval.

---

## 9. Android native layer (`native/device-io`)

One local Capacitor plugin, **`DeviceIo`** (package `uni-peq-device-io`, a `file:` dependency so
`cap sync` registers it). Kotlin only; its typings and the `HidTransport` wrapper are in
`src/lib/transports/native/`. It moves bytes and knows no protocol.

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
`npm run android:hid-spike` runs a raw handler pull through the plugin on a debug build.

---

## 10. The modernGraphTool link

modernGraphTool (mGT) and uniPEQ share one band list over a WebRTC DataChannel; a Cloudflare Worker
at `link.unipeq.com` only introduces them. The protocol and its rules are
[uniPEQ_link](https://github.com/potatosalad775/uniPEQ_link) (`docs/design.md`), installed as
`peq-link` (a git dependency on a tag, TypeScript source). A protocol change lands there first and
gets a tag; then both apps bump.

- **uniPEQ joins, asks, then owns the list.** mGT hosts the room. uniPEQ joins from the intent link
  (`unipeq://link?server=…&room=…`), the QR code's App Link (`https://link.unipeq.com/l/<CODE>`,
  `autoVerify`) or a typed code (EQ menu → Link with modernGraphTool, `LinkSheet`), and opens the
  channel before asking, because phone Chrome loses its network 5 s after it's left. Nothing mGT
  sends touches the device before "Link with `<host>`?" is answered; the host is mGT's attested
  origin, never its own claim. A cold start reads the room from `App.getLaunchUrl()`. On the web,
  mGT's "Open uniPEQ" opens this app with the room in `?link=` (`webLink`); `+layout.svelte`
  joins it through `openAddress` and drops the parameter, so a reload doesn't join again.
- **Edits** apply through `eqStore`: a band op projected onto its slot as a local edit is, one undo
  step per mGT burst (coalesce key `link:<burst>`), nothing while the list can't be edited.
  uniPEQ's own edits go back as one burst per undo step; an `eqStore.open` goes back `fresh`.
- **Device work runs in the handler of the message that asked for it** (`settle` writes through
  `devicePeqService.writeNow`, commands through `devicePeqService`), never behind a timer: in Doze
  a message wakes the CPU and a timer doesn't. Each command holds a partial wake lock.
- **While linked (Android)** the app module's `Link` plugin runs `LinkService` (foreground,
  `connectedDevice`, notification with Unlink) and keep-visible: `MainActivity` keeps telling the
  WebView its window is visible after `onStop`, since Chromium freezes a hidden page after 60 s.
  So `document.visibilityState` stays `visible` in the background, and "is the app in front" is
  `platform/app-state` (Capacitor's `appStateChange`): USB auto-connect, the release check, the
  link's grace clock, and animations, which pause in the background.
- **Self-check** (`link/self-check.ts`, Android): a freeze, a lost keep-visible or a stopped process
  is reported to mGT (`notice`) and shown once as a battery-settings tip, as is a crash marker in
  `localStorage` from a session that never ended, or the Restricted battery setting at approval.
- **On screen**: the link speaks on the sync bar only while it waits on something (joining, asking,
  mGT quiet, go back to the browser), after a device that needs the user and
  before the device's routine news (`link/link-status.ts`). Linked and steady, a dot on the EQ
  menu's ⋮ says so, and Unlink in it carries the state: the bands keep the height. The battery
  tip is a dialog (`LinkBatteryDialog`), held while the approval is open.
- Code: `link/link-store.svelte.ts` (what screens read; no link client), `link-service.svelte.ts`
  (the client's handlers and events, behind `import()`), `platform/link.ts` (the plugin, no-ops on
  the web). On the web a link works the same, without the service.

---

## 11. Testing

- **Vitest, two projects** (`vite.config.ts`): `*.spec.ts` in Node, `*.svelte.spec.ts` in headless
  Chromium (1280×800 by default; phone-layout specs set the viewport). Component specs load no
  Tailwind, so they assert roles, text and behaviour, not layout.
- **Protocols are tested in eqcaps.** The app tests what it adds: connect flows against the real
  bridge with mocked choosers and a fake plugin, the native transport, the demo device end to end
  through `openDevice`, the push plan, sync status, preset and APO formats, graph gestures, editor
  domains and the stores.

---

## 12. Not yet

- **Serial and Bluetooth.** Whether the app takes them on is undecided. Web: Serial
  (`requestSerialPort`) and Bluetooth (`requestBleDevice`) in the connect menu; a Bluetooth serial
  port several devices share asks which device it is. Android: `StreamTransport` modules in the
  plugin for USB serial, BLE GATT and Classic SPP (`BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT`,
  `neverForLocation`), no protocol code.
- **Launch-on-attach** (a manifest `device_filter.xml` from eqcaps vendor ids).
- **Network devices** (§1).
- **Checks on a real phone with hardware** (done in emulation only): sheets, menus and select menus
  closing on Android back; haptics on write; the sync bar's countdown ring; the preamp sheet; a
  real cable pull; `USB_DEVICE_ATTACHED` reaching the plugin's runtime receiver (only `DETACHED`
  seen so far), plug and unplug with the app open, a plug-in with the app in the background (should
  do nothing); system bar icon style on WebView ≥ 140; graph drags at 60 fps on a mid-range phone.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| **Android HID claim** may fail on some device families or OEM builds. | Passed on a Samsung phone. A family that fails stays web-only. |
| **WebView feel:** graph drags must hold 60 fps on mid-range phones. | One SVG, edits once per animation frame; measure on real phones, not desktop emulation. |
| **Draft data:** most eqcaps profiles are seeded drafts. | The status badge shows it; wrong limits are reported upstream from the device panel's link. |
| **Copy drift** from modernGraphTool. | Header comments name the source path and commit. |
| **Breaking eqcaps releases** (0.x). | Caret ranges; read eqcaps' changelog and DECISIONS before bumping. |
| **Preset vs. device memory** confusion. | The UI keeps them apart (Presets tab vs. Device EQ). |
