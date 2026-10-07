# Rebuild: SvelteKit + Capacitor + eqcaps

Rebuild the app on **SvelteKit (Svelte 5) + Tailwind 4 + bits-ui** inside **Capacitor**, with
the eqcaps packages replacing uniPEQ's own device database, protocol handlers, web transports and
adaptation engine. This supersedes the earlier "migrate the Ionic Vue prototype to eqcaps" plan.
Its decisions 1–7 carry over unchanged.

Status: **decided 2026-10-06. Phase 0 passed 2026-10-06** (real phone + walkplay dongle, see
Phase 0). **Phase 1 done 2026-10-06** on the `rebuild` branch. **Phase 2 passed 2026-10-06** (web and
Android on real hardware). **Phase 3 code done 2026-10-07** (demo and mocked devices; the hardware
check is open, see Phase 3). Tick tasks as they land; record deviations in the Decisions section.

Related: [reuse-from-modernGraphTool.md](reuse-from-modernGraphTool.md) (what we copy and what we
rewrite), [ARCHITECTURE.md](../ARCHITECTURE.md).

## Why this stack

- **Capacitor stays.** The device logic is TypeScript (eqcaps core + device-bridge, 16
  protocols), and desktop Chrome/Edge is a target. A WebView shell plus a protocol-free Kotlin
  transport plugin is the minimum that runs one engine on both. This is eqcaps D27.
  - Flutter or native Kotlin would mean porting the bridge (eqcaps D15: not scheduled).
  - React Native has no real web target and gains nothing for USB.
  - A PWA alone can't reach HID on Android: there's no WebHID in Android Chrome, and WebUSB blocks
    the HID class.
  - Tauri 2 adds Rust and a younger mobile story; it's only worth it for a native desktop app.
- **Ionic goes.** Its value is mobile navigation stacks, page transitions and platform-adaptive
  widgets. This app has 3 screens, no deep navigation, and treats desktop as first-class. Ionic's
  `ion-page` / `ion-content` model fights a desktop layout, and the default `md` / `ios` modes look
  dated without heavy theming. Status bar, keyboard, haptics and the Android back button are plain
  Capacitor plugins.
- **Vue → Svelte 5, for alignment, not framework merit.** modernGraphTool and the eqcaps inspector
  are SvelteKit + Svelte 5 + Tailwind 4 + bits-ui. modernGraphTool already has the eqcaps
  connection and push path, a per-band editor, the push-confirm dialog, the atoms and a token
  theme. Staying on Vue would mean building and maintaining that UI twice. The toolchain also
  converges: vite 8, vitest 5, eslint 10, TS 6. uniPEQ is on vite 5, vitest 0.34, eslint 8.
- **Now is cheap.** The Vue UI is about 950 lines plus 4 Pinia stores. Most of `src/core/` is being
  replaced by eqcaps anyway. The framework-free services (`undoRedoStack`, `autoPushScheduler`,
  `presetStorage`, `logger`) and `core/math/biquad.ts` port unchanged.

## Decisions

1–7: unchanged from the eqcaps migration plan, listed here for one home:

1. **Writable presets.** eqcaps presets have no "user can write here" flag, and our
   `firstWritableEQSlot` / `maxWritableEQSlots` data is wrong anyway (KA17: `first=7, max=3`
   selects 7 "Hip-hop", 8, 9 and skips USER1 = 4). → Add an optional `writable: true` per preset to
   eqcaps as an additive v1 minor (task E1). Until it ships, uniPEQ keeps a small temporary table of
   writable preset ids per eqcaps profile id, removed once the flag is released.
2. **Demo device.** It stays app-local: a demo eqcaps `Profile` (checked by `validateProfile` in a
   test) and a simulated `HidTransport` that speaks `fiio-usb-hid`, so the zero-hardware path runs
   real bridge code.
3. **Data delivery.** No npm data package. The client is created with
   `store: webStorageStore(localStorage)`, `ttl: 0` (revalidate `index.json` with its ETag on every
   launch; a 304 costs nothing) and `snapshot` = an embedded `bundle.json`. The snapshot is only
   the fallback for an offline or CDN-down first launch (eqcaps invariant 8). It is committed at
   `src/lib/data/eqcaps-bundle.json` and refreshed by `npm run data:snapshot` before each release,
   not fetched during the build (keeps builds offline and reproducible).
4. **Devices without a profile.** `guessProtocol(vendorId)` connects them as experimental,
   **read-only**: no profile means nothing to `fit` against. *(Check against modernGraphTool,
   which builds a profile from `analyzeCodec` so a guessed device can still be written. Adopt that
   if it holds up.)*
5. **Preset format.** Adopt eqcaps filter type codes (`PK LSC HSC LPQ HPQ BP NO AP`) in the app
   model; `PeqPreset.schemaVersion` 2, with v1 presets migrated on load (`LSQ→LSC`, `HSQ→HSC`,
   `LPF→LPQ`, `HPF→HPQ`, `BPF→BP`, `NOTCH→NO`, `APF→AP`; `BSF` and `CQ` have no v1 equivalent and
   become disabled bands with a warning). `enabled` stays app-only. Code copied from
   modernGraphTool (whose model is `PK LSQ HSQ` + `channel`) is adapted to this model, not the other
   way round.
6. **Network devices and extras.** Dropped for now. *(modernGraphTool's `device-peq/network.ts`
   already drives WiiM and Luxsin X9 behind the same `PeqDevice` shape, so bringing network devices
   back is a copy, not a bridge contribution. Revisit after Phase 4.)*
7. **Dependency mode.** npm versions. To try unreleased eqcaps changes, install the tarballs from
   `npm run release -- <version> --pack` in eqcaps, never a `file:` link.

New:

8. **Stack.**
   - SvelteKit 2 with `adapter-static`, an SPA fallback (`index.html`) and `ssr = false`. Capacitor
     `webDir` points at the build output.
   - Svelte 5 runes only; module-level state in `.svelte.ts` classes (modernGraphTool's store
     pattern), no Pinia.
   - Tailwind 4 with `@theme` tokens, bits-ui for headless primitives, `@lucide/svelte` icons.
   - Paraglide for i18n (en, ko), as modernGraphTool does, instead of vue-i18n.
   - Vitest with browser mode for component specs.
   - Code style matches modernGraphTool: tabs, single quotes, no trailing commas, Prettier + ESLint.
9. **Reuse is copy-and-adapt.** Files taken from modernGraphTool carry a header comment with the
   source path and commit. There is no shared package until both copies settle.
10. **Push semantics follow modernGraphTool's `device-peq` invariants.** These are listed in the
    reuse doc. Notably, read and write only a reachable preset: the current
    `eqStore.pushToDevice` silent retarget to the first writable slot is **not** carried over.
11. **Rebuild in place, on a branch.** The Vue/Ionic tree stays runnable on `main` until the
    cutover (Phase 7). The rebuild doesn't keep both UIs alive at once.
12. **Phase 0 hardware (2026-10-06).** No Android phone and no FiiO device are on hand.
    - Phase 0 runs on the Android emulator, with the host device passed through
      (`emulator -avd Medium_Phone -usb-passthrough vendorid=0x3302,productid=0xc20f`). On
      Windows this needs the emulator's `UsbAssist` kernel driver
      (`<sdk>/emulator/drivers/UsbAssist_Install.bat`, admin).
    - Exit device: a walkplay dongle (CrinEar Protocol Micro, `walkplay-hid`) instead of FiiO.
      Same risk, a force-claimed HID interface on a USB audio device. Walkplay uses only
      output and input reports, so feature reports stay unexercised until a FiiO or other
      feature-report device is tried.
    - The emulator's kernel is not a phone vendor's kernel. A pass is a go for the rebuild; it
      still needs one real phone before Phase 6. *Done: the exit ran on a real phone (Samsung
      SM-S936N), not the emulator.*
13. **eqcaps installed in Phase 0.** `@potatosalad775/eqcaps-device-bridge` + `-core` are npm
    dependencies now (Phase 2 planned that), so the spike runs the real handler, not
    hand-written bytes. `tsconfig.json` moved to `moduleResolution: "Bundler"`: the packages
    expose only `exports`.
14. **The plugin is a local package**, `native/device-io` (`uni-peq-device-io`, a `file:`
    dependency so `cap sync` registers it). Android code only; its TS typings and wrapper are in
    the app. Decision 7's no-`file:` rule is about eqcaps, not this.

15. **The prototype moves to `legacy/` on the branch.** `src/`, `devices/` and `tests/` of the
    Vue/Ionic tree sit under `legacy/` as a porting reference: nothing builds, lints, checks or
    tests it (one ignore entry each in `tsconfig.json`, `eslint.config.js`, `.prettierignore`).
    Its toolchain and dependencies (vite 5, plugin-vue, vue-tsc, vitest 0.34, eslint 8, Cypress,
    Ionic, Vue, Pinia) left in Phase 1, since vite 8 / vitest 5 / eslint 10 can't install beside
    them, and its tool configs were deleted. Phase 7 is then `rm -r legacy`. Files carried over
    (`biquad.ts`, the four services, the Phase 0 native transport and their specs) were `git mv`'d
    into `src/lib/` with kebab-case names, so `git log --follow` keeps their history.
16. **Capacitor 8.4.1 → 8.5.2** (core, android, cli) for GHSA-rvm3-566m-v7fv (critical: remote
    content at the app origin). `overrides` pin `uuid` and `cookie` as modernGraphTool does;
    `npm audit` is clean.
17. **Shell behaviour.**
    - Tabs are routes (`/`, `/presets`, `/settings`) and switch with `replaceState`, so there is
      no tab history.
    - Android back is a handler stack (`$lib/platform/back-button.ts`): overlays register on top;
      the shell's handler sends other tabs home. On home, the app goes to the background
      (`App.minimizeApp`), not `exitApp`, so an open device connection survives.
    - System bars use core `SystemBars`, not `@capacitor/status-bar` (still installed, unused;
      drop it in Phase 7). Capacitor draws the WebView under the bars only on WebView ≥ 140;
      below that the bars show the system-themed window background, so the icon style follows
      the system there. Verified on an API 35 emulator with WebView 124; the ≥ 140 edge-to-edge
      path still needs a look on a real phone.
    - One breakpoint, `wide:` = 900 px (`--breakpoint-wide` in `layout.css`): side rail at and
      above it, bottom tab bar below.
    - Settings keep the prototype's `unipeq.settings` key and fields; language is Paraglide's own
      `PARAGLIDE_LOCALE`.
18. **Preset validation waits for Phase 3.** The ported `preset-storage.ts` stores and lists only;
    `validatePreset` and `parseAutoEqText` were left behind in `legacy/` because Phase 3 replaces
    them (schemaVersion 2 + v1 migration, `eq-apo.ts`). `load()` returns `unknown` until then.
    `PeqPreset` is already the v2 type (`src/lib/eq/model.ts`).

19. **Phase 2 notes.**
    - The eqcaps snapshot is imported `?raw` and parsed on first use, inside the dynamically
      imported client chunk: neither it nor the bridge is in the boot bundle. The root layout
      starts `loadIndex()` after mount without awaiting it.
    - GitHub Pages doesn't expose `ETag` to cross-origin reads and answers a preflight with 405,
      so the client never stores an ETag and `ttl: 0` refetches `index.json` on each launch. The
      WebView's own HTTP cache (`max-age=600` + ETag) revalidates it, so the cost is still near
      zero. An eqcaps follow-up: if a mirror ever exposes `ETag`, the client's `If-None-Match`
      would trigger a preflight GitHub Pages refuses.
    - Writable presets (decision 1) live in `src/lib/device-peq/writable.ts`: the user memories of
      the 30 profiles that mix them with built-ins; every other profile is unrestricted.
      `writable.spec.ts` checks the table against the snapshot. `writeTarget` is null on a
      built-in preset, never retargeted (decision 10).
    - Android connects without a chooser: `connectNativeHid` lists attached HID devices, keeps
      those the database matches or the bridge can guess, opens a single one after the system's
      USB permission prompt (a refusal reads as a cancelled chooser) and asks when there are
      several (`kind: 'choose'` with devices as candidates). Nothing drivable is `kind: 'no-device'`.
    - The connect flow moved from modernGraphTool's panel into `device-peq-service.svelte.ts`,
      so it outlives the screens. Device EQ switching (`switchTo` → `setEnabled`) came along with
      it, ahead of Phase 3.
    - A minimal `eq-store` (filters, preamp, undo on replace) receives reads; `EqState` uses
      `preamp`, as eqcaps does (a preset file keeps `pregain`).
    - UI is a stand-in: `DevicePanel` (connect, device row, Device EQ, Read, status line) and a
      read-only `BandTable` on the EQ tab, until Phase 4.

20. **Phase 3 notes.**
    - **Auto-write is modernGraphTool's**, in `device-peq-service.svelte.ts`. The prototype's
      `AutoPushScheduler` is deleted: the service already debounces, coalesces edits made during a
      write, and pauses for review. It keeps the prototype's settings (`autoPushEnabled`, default
      on; `autoPushDelayMs`, default 1500 ms; modernGraphTool waits 700 ms). Manual-save mode is
      `disconnectOnSave`: such a device gets no auto-write switch, only Write, then Reconnect.
    - **Preamp.** `eqStore.preamp` is derived: `derivePreamp(filters)` while `autoPreamp` (a
      preset's `pregain: 'auto'`), else the value read or set. `eq-preamp.ts` departs from
      modernGraphTool: every eqcaps type counts (a resonant high-pass boosts), the result is never
      positive, and it rounds up to 0.1 dB rather than to the nearest.
    - **A disabled gainless band** (LPQ, HPQ, BP, NO, AP) can't be written "flat", so it goes as a
      0 dB peak at its Fc and Q (`toWrittenFilter`). modernGraphTool has no gainless types.
    - **Built-in presets.** With decision 1's table, `writeTarget` is also null on a built-in
      preset, which modernGraphTool's status would call unreachable. `panelStatus` takes a
      `builtIn` input that says so instead, ranked just above unreachable.
    - **APO text** (`eq-apo.ts`) parses every eqcaps type and APO's shorthands (`LS`, `HP`, …), Q
      from `BW Oct`, and no-Q passes and shelves as Q 0.707. It keeps `Preamp:` (summed, as APO
      does), and skips and counts one-ear `Channel:` sections and slope variants (`LS 6dB`). Export
      writes `OFF` for a disabled band and no `Gain` for gainless types.
    - **Presets** (`eq/preset-file.ts`): v1 is migrated whenever a preset is read, and stored as v2
      only when it is next saved. Imports always get a fresh id. The Presets tab is a plain list
      (save, load, import, JSON/APO export, delete on a second press) until Phase 4. **Gap:** the
      Android WebView drops downloads, so export copies the text to the clipboard there; real
      export needs a file/share plugin (Phase 4).
    - **Demo device** (`device-peq/demo.ts`): profile `unipeq-demo-dac` (10 bands, PK/LSC/HSC,
      preamp −12…0 dB, USER1–3 plus Bypass, all writable) and `DemoDac`, a simulated
      `fiio-usb-hid` device seeded through the bridge's own encoder. Its memories live for the page,
      so a write survives a reconnect. `validateProfile` wants evidence for a verified status, so
      the profile is `community-verified` with `demo.ts` itself as its `vendor-docs` source. The
      Connect area offers it on every platform, including browsers without WebHID.
    - **Left for Phase 4:** the explicit **Fit** action (invariant 3), undo/redo controls (the
      undo snapshot doesn't keep `autoPreamp` yet), and the band editor.

## Phases

### Phase 0: Android on real hardware (go/no-go) · 1–2 days

The current prototype has **no native plugin** (`native/` doesn't exist), so on Android today
only the demo device and the WebView UI can be checked. Real hardware needs the USB HID spike.
That spike doesn't depend on the UI, so everything it produces carries over to the rebuild.

- [x] `npx cap sync android`, run on a phone: demo device works and the UI is usable in the
      WebView. This is a smoke test only; the UI is being replaced. *(2026-10-06, on the
      Medium_Phone emulator, API 37: demo connects, reads 10 bands, UI usable. Decision 12.)*
- [x] Kotlin spike: enumerate (VID, PID, product string), request USB permission, claim the FiiO
      HID interface (`force = true`), and exchange one report on a real device. This is eqcaps D27's
      "Watch" item and ARCHITECTURE risk #1.
      *Code done:* `native/device-io` (`DeviceIoPlugin.kt`, `UsbHidConnection.kt`): list, permission,
      `describe` (force-claims each HID interface and reads its report descriptor), `open`,
      interrupt IN loop, output via interrupt OUT or SET_REPORT, feature reports, detach events.
      Builds and answers `list()` from the WebView. *Ran on hardware 2026-10-06 (see Exit).*
- [x] Shape the plugin's TS wrapper after the bridge's `HidTransport` interface (`sendReport`,
      `sendFeatureReport`, `receiveFeatureReport`, `onInputReport`, `collections`), not after
      uniPEQ's `src/core/transport`, which eqcaps replaces. *`src/transports/native/`:
      `nativeHidTransport.ts` implements the bridge's `HidTransport` directly, `collections`
      come from `hidReportDescriptor.ts`. `tests/unit/nativeHidTransport.spec.ts` runs the real
      `walkplay-hid` pull through it against a fake plugin.*
- **Exit:** a FiiO device answers a pull over the native transport. If the HID claim fails, stop
  and rethink the Android story before any rebuild. *(Decision 12: a walkplay device counts.)*
  Run: plug the device in, start the debug app, `npm run android:hid-spike -- --bands 8`.
  *Passed 2026-10-06:* Samsung SM-S936N over wireless adb, CrinEar Protocol Micro
  (`0x3302:0xc20f`). Permission granted, HID interface 3 force-claimed, descriptor parsed
  (usage page 0x0C, input/output reports 0x4B and 0x54), `walkplay-hid` pull returned 8 PK bands,
  preamp −1 dB, slot 1. Feature reports are still unexercised (this device has none).

### Phase 1: Scaffold · 1 day

- [x] SvelteKit + Svelte 5 + Tailwind 4 + bits-ui + Paraglide, configured as in decision 8.
      Capacitor 8 pointing at the static build. Android build runs the empty shell.
      *adapter-static writes `dist/` (Capacitor's existing `webDir`), SPA fallback, `ssr = false`.
      Paraglide en + ko, `localStorage` → `preferredLanguage` → `baseLocale`.*
- [x] Tokens and atoms from modernGraphTool (`theme.css` / `layout.css` structure, `atoms/`).
      Light/dark via `.dark` on `<html>`. *Tokens in `src/lib/styles/theme.css` (primary is blue);
      all nine atoms copied @ `23ddc4dd` with header comments. A pre-paint script in `app.html`
      applies the saved theme, so a dark launch doesn't flash.*
- [x] App shell: bottom tab bar under ~900 px, side rail above it. Safe-area insets. Android back
      button via `@capacitor/app`. *Decision 17.*
- [x] Port framework-free code into `src/lib/`: `biquad.ts`, `undoRedoStack`, `autoPushScheduler`,
      `presetStorage`, `logger`, plus their specs. *`biquad.ts` speaks the eqcaps type codes
      (`src/lib/eq/model.ts`, decision 5); the services got specs (they had none). Preset
      validation moved to Phase 3 (decision 18).*
- **Exit:** `build`, `check`, `lint` and `test` green; the shell runs on web and Android.
  *Passed 2026-10-06:* 48 tests (node + Chromium browser mode). Web checked at desktop and phone
  widths, light/dark, en/ko. Android: debug APK on the Pixel_9_Pro_Fold emulator (API 35): tabs,
  back button, theme persistence, bar icon contrast. `window.uniPeqHidSpike` is still installed
  on native builds, so `npm run android:hid-spike` keeps working.

### Phase 2: eqcaps data and connection · 1 day

- [x] Install the three eqcaps packages. `scripts/data-snapshot.ts` + `npm run data:snapshot`
      downloads `https://potatosalad775.github.io/eqcaps/v1/bundle.json` into
      `src/lib/data/eqcaps-bundle.json`. *Validates every profile with `validateProfile` before
      writing; 102 profiles, data `2026.10.05-e1b07cf`.*
- [x] `eqcaps-client.ts` (decision 3); `loadIndex()` at startup, not awaited in the UI path.
      *Decision 19 on ETags.*
- [x] Copy `device-peq/{connect,types,preset,errors,panel-status}.ts` and adapt them. Add the
      native-transport path from Phase 0 next to the browser chooser. *Plus their specs;
      `connectNativeHid` (decision 19).*
- [x] Device store (from `device-peq-store`): `profile`, `capabilities`, `experimental`, the preset
      list, writable presets (decision 1), the bypass preset.
- **Exit:** connect, read and current slot work for a real FiiO device (web and Android) and for
  the demo. *Code verified 2026-10-06 without hardware: 89 tests (connect flows against the real
  bridge with mocked choosers and plugin; the panel against a fake device), web boot caches the
  index, and on the emulator Connect runs the plugin's `list()` and reports no device.
  Passed 2026-10-06 on real hardware, in Chrome and in the Android app (checked by the user).
  The demo half moves to Phase 3 with the demo device itself.*

### Phase 3: Push path, presets, demo · 1–2 days

- [x] Copy `push-plan.ts`, `eq-constraint.ts`, `eq-preamp.ts` and adapt them to the filter model
      (decision 5). Decide between our `AutoPushScheduler` and their `device-peq-service`
      auto-write, keeping manual-save mode for `disconnectOnSave`. *Theirs (decision 20).
      `eq-constraint.ts` and `eq-preamp.ts` live in `src/lib/eq/`.*
- [x] Push-confirm dialog from `DevicePeqPushDialog`, which renders `fit` changes,
      `unassigned` and `complete` warnings. *`components/device/PushDialog.svelte`; Android back
      closes it.*
- [x] `BridgeError` → messages; `PushResult.reconnect` → reconnect flow; `setEnabled` for EQ
      on/off and the Device EQ dropdown. *Messages and `setEnabled` came in Phase 2; Write, the
      auto-write switch and the restart-to-save flow are in `DevicePanel`.*
- [x] Presets: schemaVersion 2 + v1 migration (decision 5); import/export JSON; APO / AutoEq
      text via `eq-apo.ts`. *`eq/preset-file.ts`, `stores/preset-store.svelte.ts`, a plain
      Presets tab (decision 20).*
- [x] Demo device (decision 2): demo profile + simulated `fiio-usb-hid` transport.
- **Exit:** applying a preset to a device shows an accurate diff and writes what `fit` produced.
  The demo pipeline test runs through `openDevice`.
  *Code verified 2026-10-07: 176 tests. `demo.spec.ts` connects the demo through `openDevice`,
  reads, plans, writes and reads back. `DevicePanel` specs check the review dialog's diff and
  that a confirmed write sends `fit`'s values. Open: load a preset and write it to a real device
  (web and Android), and the demo on Android.*

### Phase 4: Screens · 3–4 days

- [ ] **Main.** A large interactive `EqGraph` is the main element: response from `biquad.ts`,
      draggable band nodes, tap-to-select with a touch path for Q. Band list/editor from
      `EqFilterCard`. Device row + Device EQ + single status line from `DevicePeq`. Undo/redo,
      load/save preset. Desktop puts the graph and editor side by side; phone stacks them, with the
      band editor in a bottom sheet.
- [ ] Per-band domains from `resolveSlot` / `slotOf`: min/max/step, fixed value lists, locked
      fields read-only, allowed types. `isGraphic` profiles get a fixed-frequency layout. Live
      `validateList` flags while editing.
- [ ] Preamp by `preamp.mode`: `manual` slider, `auto` hidden, `none` warns on boost, `unknown`
      slider with a note.
- [ ] Profile status badge, experimental badge, links to the eqcaps inspector and its
      "wrong constraint" form.
- [ ] **Presets** and **Settings** (theme, language, auto-push delay, diagnostics log viewer/export).
- **Exit:** feature parity with the Vue prototype, on desktop and phone widths.

### Phase 5: Serial and Bluetooth in the browser · 1 day

- [ ] Connect menu adds Serial (`requestSerialPort`) and Bluetooth (`requestBleDevice`). Both
      return an identity first and `open(protocol)` once matched. A Bluetooth serial port that
      several devices share asks the user which device it is.

### Phase 6: Android native plugin, full · separate milestone

- [ ] Grow the Phase 0 spike into the plugin: USB HID (attach/detach broadcasts, permission flow),
      then `StreamTransport` for USB serial and BLE, then Classic SPP. No protocol code in the plugin.
- [ ] Android discovery UX: live candidate list without a picker.

### Phase 7: Cutover · ½ day

- [ ] Delete the Vue/Ionic tree: `rm -r legacy` (decision 15; its dependencies already left in
      Phase 1), then drop the `legacy` ignore entries and the unused `@capacitor/status-bar`.
- [ ] ARCHITECTURE.md: rewrite §3–§7, §9–§11 for the new tree; drop risk #7. CLAUDE.md: replace
      the Ionic/Vue sections with the new conventions.
- [ ] eqcaps DECISIONS D27: "Ionic + Capacitor prototype" → "SvelteKit + Capacitor".
- **Exit:** build, lint and tests green; no reference to removed modules.

## eqcaps-side tasks

- [ ] **E1** (decision 1): optional `writable` on `protocol.presets[]`. SPEC §9 + schema +
      codegen + DECISIONS entry; the bridge's `Slot` type; data for the FiiO profiles, confirmed
      on hardware where possible. Release, then delete uniPEQ's temporary writable table.

## Risks

- **Android HID claim** (Phase 0). If it fails for a device family, that family is web-only. If
  it fails broadly, the Android app is in question whatever the UI stack.
- **WebView feel.** Graph drags must hold 60 fps on mid-range Android. Measure in Phase 4 on a real
  phone, not in desktop emulation.
- **Draft data.** Most eqcaps profiles are seeded `draft`s whose ranges come from devicePEQ's
  handler code. The status badge makes this visible; wrong limits get reported upstream.
- **Copy drift.** Fixes in modernGraphTool's `device-peq/` won't reach us automatically. The
  header comments make it possible to diff against upstream; revisit a shared package after
  Phase 4.
- **Breaking eqcaps releases** (0.x). Pin a caret range and read the eqcaps changelog / DECISIONS
  before bumping.
