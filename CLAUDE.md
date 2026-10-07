# uniPEQ — agent notes

Parametric-EQ control app for USB/BT/network audio devices. Capacitor app being rebuilt from
Ionic Vue 3 to SvelteKit + Svelte 5 + Tailwind 4 + bits-ui, on the eqcaps packages (which replace
`devices/`, the registry, handlers, web transports and the adaptation engine).
**Plan, decisions and checklist: [docs/rebuild-plan.md](docs/rebuild-plan.md)** (Phases 0–4
done, Phase 4.5 mobile UX pass in progress, Phase 5 next); what to copy from
`../modernGraphTool`:
[docs/reuse-from-modernGraphTool.md](docs/reuse-from-modernGraphTool.md).
[ARCHITECTURE.md](ARCHITECTURE.md) still describes the prototype; it is rewritten at cutover.

**Branches.** `main` holds the runnable Ionic Vue prototype (fixes only, don't extend its UI).
`rebuild` holds the new app in `src/`; the prototype sits unbuilt in `legacy/` there as a porting
reference (rebuild decision 15). The prototype sections further down describe `legacy/`.

## Commands (rebuild branch)

- `npm run dev` — vite dev server (http://localhost:5173)
- `npm test` — vitest once: `*.spec.ts` in node, `*.svelte.spec.ts` in Chromium browser mode
  (`npm run test:unit` to watch)
- `npm run check` — Paraglide compile + `svelte-kit sync` + `svelte-check`
- `npm run lint` — Prettier check + ESLint; `npm run format` fixes formatting
- `npm run build` — static SPA into `dist/` (Capacitor's `webDir`)
- `npm run data:snapshot` — refresh the embedded eqcaps bundle (before a release, not per build)
- Android: `npm run android [-- --serial <id> --skip-web --no-launch]` builds, installs and starts
  the debug app on the one connected adb device (`scripts/android-install.mjs`). By hand:
  `npm run android:sync` (build + `cap sync android`), then `android/gradlew assembleDebug`
  (`gradlew.bat` on Windows). The Gradle daemon JDK is pinned to Azul Zulu 21 by
  `android/gradle/gradle-daemon-jvm.properties` (+ foojay resolver in `settings.gradle`), so
  `JAVA_HOME` doesn't matter: Gradle uses an installed Zulu 21 or downloads one to `~/.gradle/jdks`.
  Capacitor 8 needs 21; Gradle 8.14 can't run on 25. The vendor pin keeps Gradle from reusing
  daemons that VS Code's Java extension starts on its bundled Temurin JRE, which has no `jlink`
  (AGP fails with "jlink executable … does not exist"). Keep the vendor anything but Adoptium;
  foojay has no JetBrains 21. Regenerate with
  `./gradlew updateDaemonJvm --jvm-version=21 --jvm-vendor=azul`. The SDK comes from `ANDROID_HOME` or
  `android/local.properties` (gitignored, `sdk.dir`).
- `npm run android:hid-spike -- --bands 8` — Phase 0 USB HID spike on the running debug app
  (adb + DevTools protocol → `window.uniPeqHidSpike`, which runs the eqcaps handler's pull)

## Rebuild conventions (src/)

- Style, runes, tokens and atoms follow modernGraphTool (its root and `src/lib/components`
  `AGENTS.md`): tabs, single quotes, no trailing commas, 100 columns; Svelte 5 runes only, module
  state in `.svelte.ts` classes; colours only through the semantic tokens in
  `src/lib/styles/theme.css` (`bg-base-100`, `text-base-content/60`, …); reach for
  `src/lib/components/atoms/` before raw elements. Files are kebab-case.
- Files copied from modernGraphTool start with a comment naming the source path and commit.
- Layout: `src/routes/` (one route per tab, `ssr = false`), `src/lib/components/{atoms,layout,eq,device,presets,settings}`,
  `src/lib/eq/` (app filter model with eqcaps type codes, `biquad.ts`), `src/lib/services/`
  (framework-free), `src/lib/stores/`, `src/lib/platform/` (Capacitor glue: back button, system
  bars), `src/lib/transports/native/` (USB HID plugin wrapper → eqcaps `HidTransport`).
- UI strings: Paraglide, `messages/{en,ko}.json`, `import * as m from '$lib/paraglide/messages'`.
  `src/lib/paraglide/` is generated and gitignored.
- One layout breakpoint, `wide:` (900 px): side rail above, bottom tab bar below. Pad for system
  bars with `pt-(--inset-top)` etc. (from `layout.css`), never raw `env()`.
- Touch sizing is the `touch:` variant (`pointer: coarse`), not a width: atoms grow to 48 px
  targets under it. On phones follow Android patterns (decision 22): `ListRow`/`ListSection` with
  the control trailing, `RadioDialog` for one-of-N, `Sheet` for panels, supporting text not
  popovers. The EQ tab's device status is the sync bar (`device-peq/sync-status.ts`), its one
  status line.
- Devices: protocols, limits and device data are eqcaps' job (`../eqcaps`); a protocol bug or a
  missing device is fixed there. `src/lib/device-peq/` follows modernGraphTool's
  `device-peq/AGENTS.md` invariants (fit before every write, never retarget, connect never edits
  the filters, one status line). `connect.ts`, the bridge, the client and the snapshot stay behind
  dynamic `import()`; only `eqcaps-core` may be in the boot bundle. State in
  `stores/device-peq-store.svelte.ts`, actions in `services/device-peq-service.svelte.ts`.
- EQ edits go through `eqStore` methods, never by assigning `filters`: each is an undo step, or
  joins one through a coalesce key (slider drags, held keys) or `record()` at a gesture's start.
  Project an edit onto the band's slot with `editFilter` first; only Fit (`fitFilters`) folds the
  whole list onto the device. Limits for the UI come from `stores/eq-constraint-store.svelte.ts`.
- Overlays that should close on Android back register with `onBack()` from
  `$lib/platform/back-button` and remove the handler when they close.
- Component specs load no Tailwind: don't assert layout or computed utility styles there.
- `$app/paths` `resolve()` needs an empty params arg (`resolve('/presets', {})`) while no route
  has params — a SvelteKit typing quirk (see `components/layout/tabs.ts`).

## Prototype status (`legacy/` on the rebuild branch; what exists vs ARCHITECTURE.md)

Implemented: core types/math/codec, registry + merge/resolution, adaptation engine,
`fiioUsbHid` handler (ported byte-exact), demo handler + virtual DemoTransport,
WebHID transport + web discovery, HTTP transport (no network handlers yet),
DeviceManager / AutoPushScheduler / UndoRedoStack / LocalPresetStorage services,
4 Pinia stores, 3-tab UI (Main/Presets/Settings), preset import (JSON + AutoEq txt) / export.

Not yet: all other handlers (walkplay/ktmicro/moondrop/serial/BLE/SPP/network), WebSerial/WebBLE
transports, the full Android plugin (`native/device-io` is the Phase 0 USB HID spike only,
wrapped by `src/transports/native/` as an eqcaps `HidTransport`), i18n (`vue-i18n` not installed;
strings hardcoded en), JSON Schema files in `devices/_schema/`, zod (validation is hand-rolled in
`src/core/registry/validate.ts`), migration script (`scripts/migrate-device-db.ts`).

## Porting from devicePEQ

- Source repo is a sibling checkout: `C:\Users\jwlee\project\devicePEQ` (handlers in `devicePEQ/`,
  byte captures in `tests/captures/`). One-time port, no ongoing sync (ARCHITECTURE.md risk #7).
- **Port byte logic verbatim.** Beware: devicePEQ helper variable names are swapped vs reality —
  `fiioGainBytesFromValue` returns `[high, low]` but callers destructure it as `[gainLow, gainHigh]`;
  `combineBytes(lowByte, highByte)` actually computes `(arg0 << 8) | arg1`. uniPEQ's
  `src/core/codec/bytes.ts` uses corrected names; wire byte order is unchanged and locked in by
  `tests/unit/fiioUsbHid.spec.ts` (exact-byte assertions).
- Handler port recipe: convert to `ProtocolHandler` interface (`src/core/transport/index.ts`),
  replace `device.oninputreport` with `transport.onData()` (always unsubscribe in `finally`),
  `deviceDetails.modelConfig` → `ctx.profile.modelConfig`, constraints (`maxGain`/`maxFilters`)
  come from `ctx.profile.constraints` NOT modelConfig, `console.log` → `ctx.log`.
  Register in `src/core/handlers/index.ts`, add fixture test with `tests/unit/mockHidTransport.ts`
  (responder keyed by command byte `data[4]`, mirroring devicePEQ "sequence mode" captures).

## Device DB conventions

- `devices/<brand>/<model>.json`, merge order: `_profiles/<constraintsRef>.json` →
  `<brand>/_brand.json` defaults → device file → device `constraintsOverride`.
- `availableSlots` may contain `"$setName"` string refs into the brand's `sharedSlotSets`.
- Registry is compiled via `import.meta.glob('/devices/**/*.json', { eager: true })` — adding a
  JSON file is enough, no imports. `tests/unit/registry.spec.ts` validates every file in CI
  (cross-refs, duplicate productName matches, handlerId existence).
- The demo device (`devices/demo/demo-dac.json`, `match: { demo: true }`) must stay: it's the
  zero-hardware path used by the UI candidate list and the pipeline test.

## Gotchas

- TS 5.9 strictness: passing `Uint8Array` where DOM wants `BufferSource`/`BodyInit` fails
  (`ArrayBufferLike` vs `ArrayBuffer`); use `.slice()` at the DOM boundary (see webHidTransport).
- WebHID typings are hand-declared in `src/transports/web/webhid.d.ts` (no @types package installed).
- Dark mode is class-based (`ion-palette-dark` on `<html>`, set by `settingsStore.applyTheme`);
  main.ts imports `dark.class.css`, not `dark.system.css`.
- Undo/redo: snapshot BEFORE mutation. Sliders emit `gesture-start` (→ `eq.recordHistory()`) then
  patch with `record=false` on release so drags coalesce to one history entry.
- `eqStore.pushToDevice` silently retargets to the first writable slot when the current slot isn't
  writable (writable set derived from `firstWritableEQSlot`/`maxWritableEQSlots`).
- Handlers must never import from `src/transports/`, stores, or use `navigator.*` — core stays
  platform-agnostic (dependency rule in ARCHITECTURE.md §3).
