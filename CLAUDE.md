# uniPEQ — agent notes

Parametric-EQ control app for USB/BT/network audio devices. Ionic Vue 3 + Capacitor.
**Read [ARCHITECTURE.md](ARCHITECTURE.md) first** — it is the authoritative design doc; this file only records
what the prototype actually implements and the decisions/deviations not obvious from the code.

**Planned rebuild (decided 2026-10-06, not started):** SvelteKit + Svelte 5 + Tailwind 4 + bits-ui
in Capacitor (Ionic and Vue are dropped), on the eqcaps packages, which replace `devices/`, the
registry, handlers, web transports and the adaptation engine. Phase 0 (Android on real hardware)
comes first. Plan, decisions and checklist: [docs/rebuild-plan.md](docs/rebuild-plan.md); what to
copy from `../modernGraphTool`: [docs/reuse-from-modernGraphTool.md](docs/reuse-from-modernGraphTool.md).
Sections below describe the current Ionic Vue prototype — don't extend its UI; fixes only.

## Commands

- `npm run dev` — vite dev server (http://localhost:5173)
- `npm run test:unit` / `npx vitest run` — unit tests (37+, all must pass)
- `npm run build` — `vue-tsc` typecheck + vite build (both must be green)
- `npm run lint` — eslint (underscore-prefixed unused args are allowed)
- Cypress is configured but its binary is NOT installed (`npx cypress install` first if needed)

## Prototype status (what exists vs ARCHITECTURE.md)

Implemented: core types/math/codec, registry + merge/resolution, adaptation engine,
`fiioUsbHid` handler (ported byte-exact), demo handler + virtual DemoTransport,
WebHID transport + web discovery, HTTP transport (no network handlers yet),
DeviceManager / AutoPushScheduler / UndoRedoStack / LocalPresetStorage services,
4 Pinia stores, 3-tab UI (Main/Presets/Settings), preset import (JSON + AutoEq txt) / export.

Not yet: all other handlers (walkplay/ktmicro/moondrop/serial/BLE/SPP/network), WebSerial/WebBLE
transports, Android native plugin (`native/` dir doesn't exist yet), i18n (`vue-i18n` not installed;
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
