# Migration to eqcaps

> **Superseded (2026-10-06) by [rebuild-plan.md](rebuild-plan.md).** The app is rebuilt on
> SvelteKit + Capacitor instead of migrating the Ionic Vue prototype in place. Decisions 1–7 below
> carry over verbatim; the phases do not. Kept for history only — safe to delete.

Replace uniPEQ's own device database, protocol handlers, web transports and adaptation engine with
the eqcaps packages. eqcaps (`../eqcaps`, GitHub `potatosalad775/eqcaps`) is a vendor-neutral EQ
constraint database plus a device bridge; its PLAN §2 already lists this app as a consumer.

Packages (npm, `^0.2.3`):

- `@potatosalad775/eqcaps-core`: profile types, `resolveSlot`, `validateList`, `fit`, `complete`,
  `describe`, `isGraphic`, `validateProfile`.
- `@potatosalad775/eqcaps-client`: fetch, cache and `matchDevice`. Never throws.
- `@potatosalad775/eqcaps-device-bridge`: `openDevice(transport, protocol)` → `BridgeDevice`
  (`pull` / `push` / `currentSlot` / `setEnabled`), 16 protocols; `/browser` has WebHID, Web Serial
  and Web Bluetooth transports.

Status: **planned, not started.** Tick tasks as they land; record deviations in the Decisions
section.

## What goes, what stays

| uniPEQ today | After |
| --- | --- |
| `devices/**` (15 JSON), `src/core/registry/`, `validate.ts` | eqcaps data via the client; one app-local demo profile |
| `PeqConstraints`, `DeviceFile`, `ModelConfig`, `ResolvedDeviceProfile` | eqcaps `Profile` + bridge `DeviceCapabilities` |
| `src/core/handlers/`, `src/core/codec/`, `src/core/transport/` | bridge `openDevice` / `BridgeDevice` |
| `src/transports/web/` (+ `webhid.d.ts`), `src/transports/http/` | bridge `/browser`; HTTP dropped |
| `src/core/adaptation/adaptPreset.ts` | core `fit` → `complete` |
| `src/core/math/biquad.ts` | **kept** (graph) |
| `DeviceExtras` | dropped |

All six hardware devices in `devices/` (FiiO BTR13, KA17, QX13, JadeAudio JA11 and Jiezi, Snowsky
Melody) already have eqcaps profiles, so no data moves upstream.

## Decisions

1. **Writable presets.** eqcaps presets have no "user can write here" flag, and our
   `firstWritableEQSlot` / `maxWritableEQSlots` data is wrong anyway (KA17: `first=7, max=3`
   selects 7 "Hip-hop", 8, 9 and skips USER1 = 4). → Add an optional `writable: true` per preset to
   eqcaps as an additive v1 minor (task E1). Until it ships, uniPEQ keeps a small temporary table of
   writable preset ids per eqcaps profile id, removed once the flag is released.
2. **Demo device.** It stays app-local: a demo eqcaps `Profile` in `src/demo/` (checked by
   `validateProfile` in a test) and a simulated `HidTransport` that speaks `fiio-usb-hid`, so the
   zero-hardware path runs real bridge code.
3. **Data delivery.** No npm data package. The client is created with
   `store: webStorageStore(localStorage)`, `ttl: 0` (revalidate `index.json` with its ETag on every
   launch; a 304 costs nothing) and `snapshot` = an embedded `bundle.json`. The snapshot is only
   the fallback for an offline or CDN-down first launch (eqcaps invariant 8). It is committed at
   `src/data/eqcaps-bundle.json` and refreshed by `npm run data:snapshot` before each release,
   not fetched during the build (keeps builds offline and reproducible).
4. **Devices without a profile.** `guessProtocol(vendorId)` connects them as experimental,
   **read-only**: no profile means nothing to `fit` against.
5. **Preset format.** Adopt eqcaps filter type codes (`PK LSC HSC LPQ HPQ BP NO AP`) in the app
   model; `PeqPreset.schemaVersion` 2, with v1 presets migrated on load (`LSQ→LSC`, `HSQ→HSC`,
   `LPF→LPQ`, `HPF→HPQ`, `BPF→BP`, `NOTCH→NO`, `APF→AP`; `BSF` and `CQ` have no v1 equivalent and
   become disabled bands with a warning). `enabled` stays app-only; disabled bands are left out of
   `fit`'s input.
6. **Network devices and extras.** Dropped for now. Network devices return later as a bridge
   contribution (a new transport kind needs an eqcaps DECISIONS entry).
7. **Dependency mode.** npm versions. To try unreleased eqcaps changes, install the tarballs from
   `npm run release -- <version> --pack` in eqcaps, never a `file:` link.

## Phases

### Phase 0: Trial run · ½ day

- [ ] Install the three packages; `npm run build` (vue-tsc 5.9 + vite 5) and `npx vitest run`
      stay green with a file importing each entry point. If not, upgrade vite/vitest first.
- [ ] Throwaway page: WebHID chooser → `matchDevice` → `loadProfile` → `openDevice` → `pull` →
      `fit` + `complete` → `push`, on a real FiiO device.
- **Exit:** the chain works on hardware with our toolchain.

### Phase 1: Data and connection · 1–2 days

- [ ] `scripts/data-snapshot.ts` + `npm run data:snapshot`: downloads
      `https://potatosalad775.github.io/eqcaps/v1/bundle.json` into `src/data/eqcaps-bundle.json`.
- [ ] `src/services/eqcaps.ts`: the one client instance (decision 3), `onError` → logger. Call
      `loadIndex()` at startup without awaiting it in the UI path.
- [ ] Rewrite `DeviceManager`: candidates from the demo device plus `grantedHidDevice`; the
      chooser via `requestHidDevice({ entries: index.profiles })`; `matchDevice(identityOf(t))`,
      then `protocolForMatches(matches)` or `guessProtocol` (read-only, decision 4) →
      `openDevice(t, protocol, { profile, log })`. Ambiguous matches go to the existing
      disambiguation sheet.
- [ ] `deviceStore` holds `profile: Profile | null`, `capabilities`, `experimental`, the preset
      list (`capabilities.slots`), writable presets (decision 1) and the bypass preset.
- **Exit:** connect, read, and the current slot work for a real FiiO device and the demo.

### Phase 2: Push path and presets · 1 day

- [ ] `eqStore.pushToDevice`: enabled filters → `fit(profile, filters, pregain)` →
      `complete(profile, slots, { hints: lastPull.filters })` → `device.push({ filters, preamp?,
      slot? })`, with `preamp` only when `profile.preamp.mode === 'manual'` and
      `capabilities.writesPreamp`.
- [ ] `BridgeError` codes → user-facing messages; `PushResult.reconnect` → reconnect flow.
- [ ] `toggleEq` → `setEnabled`; EQ-off state from the bypass preset.
- [ ] `PresetDiffModal` renders `fit`'s `changes`, `unassigned` and `complete`'s `warnings`.
      Drop `lossScore` unless the UI really needs a single number.
- [ ] Preset schemaVersion 2 + migration (decision 5); the AutoEq importer emits the new codes.
- **Exit:** applying a preset to a device shows an accurate diff and writes what `fit` produced.

### Phase 3: Demo device · ½–1 day

- [ ] Demo profile + simulated `fiio-usb-hid` HID transport (decision 2); replaces
      `DemoTransport` and the demo handler.
- **Exit:** the demo pipeline test runs through `openDevice`.

### Phase 4: Removal, tests, docs · 1 day

- [ ] Delete `devices/`, `src/core/{registry,handlers,codec,transport,adaptation}/`,
      `src/transports/{web,http}/`, the `fiioUsbHid`, `bytes`, `registry` and `adaptPreset` specs,
      and `mockHidTransport.ts`.
- [ ] Tests: the snapshot parses and the demo profile validates; push path with a fake
      `BridgeDevice` (fit/complete/preamp/slot choice); preset v1 → v2 migration; demo pipeline.
- [ ] ARCHITECTURE.md: rewrite §4–§7, §9 (native plugin = byte pipe implementing the bridge's
      transport interfaces), §10, §11; drop risk #7. CLAUDE.md: drop "Porting from devicePEQ" and
      "Device DB conventions", add the eqcaps conventions (filter codes, profile ids, snapshot
      refresh).
- **Exit:** build, lint and tests green; no reference to the removed modules.

### Phase 5: Per-band UI · 2–3 days

- [ ] `EqBandControl` gets its field domains from `resolveSlot(profile, i, filter)`: min/max/step,
      fixed value lists (e.g. Edifier frequencies), locked fields shown read-only, the types the
      slot allows. Band count from `profile.bandCount`.
- [ ] Graphic-EQ profiles (`isGraphic`) get a fixed-frequency layout.
- [ ] Live `validateList` flags while editing (flag, don't rewrite).
- [ ] Preamp by `preamp.mode`: `manual` slider, `auto` hidden, `none` warns on boost, `unknown`
      slider with a note.
- [ ] Profile status badge (`draft` / `community-verified` / `maintainer-verified`) and an
      experimental-protocol badge; a link to the profile in the eqcaps inspector and its
      "wrong constraint" issue form.

### Phase 6: Serial and Bluetooth in the browser · 1 day

- [ ] Connect menu adds Serial (`requestSerialPort`) and Bluetooth (`requestBleDevice`); both
      return an identity first and `open(protocol)` once matched. A Bluetooth serial port that
      several devices share asks the user which device it is.

### Phase 7: Android native plugin · separate milestone

- [ ] Capacitor plugin implementing the bridge's `HidTransport` over Android USB host
      (`sendReport`, `sendFeatureReport`, `receiveFeatureReport`, `onInputReport`, `collections`
      from the descriptor), then `StreamTransport` for USB serial and BLE. No protocol code in the
      plugin.

## eqcaps-side tasks

- [ ] **E1** (decision 1): optional `writable` on `protocol.presets[]`. SPEC §9 + schema +
      codegen + DECISIONS entry; the bridge's `Slot` type; data for the FiiO profiles, confirmed
      on hardware where possible. Release, then delete uniPEQ's temporary writable table.

## Risks

- **Draft data.** Most eqcaps profiles are seeded `draft`s whose ranges come from devicePEQ's
  handler code. The status badge (Phase 5) makes this visible; wrong limits get reported upstream.
- **Toolchain.** eqcaps builds with TS 6 and targets ES2022; Phase 0 confirms our TS 5.9 / vite 5
  consumes it.
- **Breaking eqcaps releases** (0.x). Pin a caret range and read the eqcaps changelog / DECISIONS
  before bumping.
