# Rebuild: SvelteKit + Capacitor + eqcaps

Rebuild the app on **SvelteKit (Svelte 5) + Tailwind 4 + bits-ui** inside **Capacitor**, with
the eqcaps packages replacing uniPEQ's own device database, protocol handlers, web transports and
adaptation engine. This supersedes the earlier "migrate the Ionic Vue prototype to eqcaps" plan.
Its decisions 1–7 carry over unchanged.

Status: **decided 2026-10-06. Phase 0 passed 2026-10-06** (real phone + walkplay dongle, see
Phase 0). **Phase 1 done 2026-10-06** on the `rebuild` branch. **Phase 2 passed 2026-10-06** (web and
Android on real hardware). **Phase 3 code done 2026-10-07** (demo and mocked devices; the hardware
check is open, see Phase 3). **Phase 4 code done 2026-10-07** (demo device, web at desktop and phone
widths; the user found every feature working on a real Samsung phone, see Phase 4). **Phase 4.5
(mobile UX pass) started 2026-10-07**, decision 22; **Phase 4.6 (hardware-first refinements) code
done 2026-10-08**, decision 23. **Phase 7 (cutover) done 2026-10-09**, ahead of Phases 5 and 6, which
are postponed (decision 24). Tick tasks as they land; record deviations in the Decisions section.

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
   become disabled bands with a warning). `enabled` stays app-only. *(Superseded by decision 22:
   no `enabled` at all; `BSF` / `CQ` bands are dropped with the warning.)* Code copied from
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
      undo snapshot doesn't keep `autoPreamp` yet), and the band editor. *All three landed in
      Phase 4 (decision 21).*

21. **Phase 4 notes.**
    - **The graph** (`components/eq/EqGraph.svelte`, scales in `eq/graph-scale.ts`) is one SVG on
      pointer events, not d3: touch and mouse share one path, and synthetic events drive it in
      specs. Drag moves frequency and gain (only the fields the slot doesn't lock; a gainless type
      sits on 0 dB and moves sideways only), Q comes from a two-finger pinch anywhere or the wheel,
      a double-click on the background adds a band, a tap deselects. A drag is one undo step; moves
      under 3 px are taps; edits run once per animation frame; the dB range is held during a
      gesture so the plot doesn't rescale under the finger. Nodes are focusable buttons: arrows,
      Page Up/Down and Delete edit them. Keyboard steps are musical (`eq/nudge.ts`: 1/24 octave
      for frequency, 1/12 octave for Q, 0.1 dB or the grid for gain), shared with the editor.
    - **Editing** goes through `eqStore` methods (`update`, `add`, `remove`, `setPreamp`,
      `setAutoPreamp`, `undo`, `redo`). `update` takes a coalesce key, so a slider drag or a held
      arrow key is one undo step (`COALESCE_MS`). Snapshots keep `autoPreamp` (`UndoRedoStack` is
      generic now). An edit projects only the fields it changes onto the band's slot
      (`editFilter`); everything else stays as it is, flagged, until the user presses **Fit**
      (`fitFilters` = `conformFilters` + `padToBandCount`, modernGraphTool's "Fit to device").
      Connecting still never edits (invariant 3); the band list says how many bands don't fit.
    - **Constraints** are derived in `stores/eq-constraint-store.svelte.ts`: the connected profile,
      or `UNCONSTRAINED` (every type, ranges wide enough for any preset file) with none. Still no
      constraint picker.
    - **Layout.** Wide: the toolbar, graph and preamp sit sticky on the left; the device panel and
      the band list on the right, the selected row opening the editor in place. Phone: device,
      graph, preamp and bands stacked; the selected band's editor is a non-modal bottom sheet
      (`BandSheet`, Android back closes it), and opening it scrolls the graph to the top so the
      band stays in sight and draggable above the sheet.
    - **Preamp** (`eq/preamp-control.ts`): `manual` and `unknown` get a slider (`unknown` over a
      guessed −20…0 dB, with a note) and an Auto switch; `auto` shows nothing; `none`, or a
      protocol that can't write a preamp, shows a warning while the EQ boosts. The slider warns
      when it leaves less headroom than the bands boost.
    - **Device row**: a status badge from `meta.status` (or "Guessed protocol"), an experimental
      badge, and in its popover links to the profile in the inspector (`/eqcaps/p/<id>`) and to
      the wrong-constraint form.
    - **Presets screen**: search over names and tags, tags, rename, duplicate, JSON / APO export,
      delete behind a confirming press, and a fit badge per preset while connected
      (`device-peq/preset-fit.ts`, the same `planPush` a write runs; it replaces the prototype's
      loss score). The EQ screen loads and saves presets through dialogs; outcomes there go to a
      shell-level toast (`notice-store`), as the dialog has closed by then.
    - **Android export** closes decision 20's gap: `@capacitor/filesystem` writes the file to the
      cache and `@capacitor/share` opens the share sheet (the app's FileProvider already exposes
      the cache). Diagnostics log export uses the same path.
    - **Settings**: auto-write switch and delay (0.5–5 s), verbose logging, a log viewer with
      clear and export, and the eqcaps data version and profile count under About.
    - New atom `ModalDialog` (bits-ui Dialog + Android back); `PushDialog` uses it. `Input` now
      types the input attributes it already spread. `BandTable` is gone.

22. **Mobile UX pass (Phase 4.5, 2026-10-07).** After a first run on a real phone (Samsung), the
    UI worked but felt like a desktop page: the atoms are modernGraphTool's mouse-sized ones
    (`sm` buttons ≈ 28 px, `icon-xs` ≈ 20 px), switches sit left of their labels, help hides in
    `?` popovers, and the EQ tab is one long stack whose write status sits at the top while edits
    happen at the bottom.
    - **Touch sizing by pointer, not width.** A `touch:` variant (`@media (pointer: coarse)`) makes
      the atoms touch-sized (48 px targets); a mouse keeps the compact sizes at any width. `wide:`
      stays the only layout breakpoint. Material conventions on phones: switches trailing their
      label, whole rows tappable, settings as list rows, choices in radio dialogs, help as
      supporting text rather than popovers.
    - **EQ tab on a phone: fixed top and bottom, only the bands scroll.** An app bar (device chip,
      undo/redo, an overflow menu with Load preset / Save preset / Fit), the graph pinned under it
      (~30 dvh), then the preamp row and the band rows in the one scrolling area, and a sync bar
      above the tab bar. The device card becomes a device sheet opened from the chip. The toolbar
      and the "scroll the graph to the top" effect go. Load and Save stay reachable from the EQ
      tab, in the overflow menu.
    - **Sync bar** (replaces the device panel's status line, keeps `panelStatus`'s ranking). Manual
      mode: what isn't on the device and a Write button. Auto-write: waiting (counts the delay
      down), writing, written (then "synced"), paused with Review. The chip's dot repeats the state.
      No toast per write; a failure gets a toast and an error haptic, a write a light haptic tick
      (`@capacitor/haptics`, native only).
    - **No per-band on/off.** No eqcaps protocol has a per-band enable (`setEnabled` is the whole
      EQ); the app faked it by writing 0 dB, so an "off" band still took a device slot and a
      gainless one turned into a 0 dB peak. Hardware EQ apps don't offer it; EqualizerAPO-style
      software EQs do because their engine can skip a band. `enabled` leaves the model: APO
      `OFF` lines and v1 `BSF` / `CQ` bands are dropped on import (with the existing warning for the
      latter), stored presets drop their disabled bands on load, APO export writes every band `ON`.
      A/B listening uses the device's EQ on/off. Supersedes the `enabled` parts of decisions 5
      and 20.
    - **Frequencies in full.** Band values show every digit (`1234 Hz`, `20000 Hz`, `84.5 Hz`),
      never rounded to kHz, with no thousands separator so they match the number box. Graph axis
      ticks keep `1k` / `10k`.

23. **Hardware-first refinements (Phase 4.6, 2026-10-08).** More feedback from the phone: the app
    is a companion to one device at a time, so it should take that device's shape.
    - **A device's bands are a set number.** With a profile `bandCount`, the list is that many rows:
      no Add band (row or graph double-click), and a band is **reset** to flat (0 dB PK, Q 1, on its
      frequency) rather than removed, by the editor's Reset or the graph's Delete key. Only a row
      past the count can still be removed. Loading a shorter preset pads it with flat bands; Fit
      pads a short list and the band list's banner offers it. Add and remove stay for a profile with
      no band count.
    - **No editing before a device.** The only software profile the app ever used was its own
      `UNCONSTRAINED` fallback (`connect.ts` matches hardware profiles only). Before the first
      connection the EQ tab is a prompt to connect (and the demo device), Load preset is off, and
      `UNCONSTRAINED` stays only as the store's placeholder and the specs' profile.
    - **A disconnect keeps the device.** `devicePeqStore.knownDevice` (name and profile) is set on
      connect and kept on disconnect, so the list stays editable against the last profile; the sync
      bar says the device is disconnected and offers Connect (the device sheet), the chip's dot is
      amber. `forget()` goes back to before any device (specs). *Editable no longer: read-only
      while disconnected since decision 25.*
    - **Preamp as one row.** The preamp is a row shaped like a band row (level in the gain column,
      Auto in the Q column, the clip flag); it opens `PreampEditor` in a sheet on a phone and under
      the row on `wide:`.
    - **One menu.** `Menu` / `MenuItem` / `MenuSeparator` on bits-ui DropdownMenu, for the EQ
      overflow and a preset's ⋮ (which had drifted apart), and `SelectMenu` (radio items, a check
      on the current one) for Theme, Language and Device EQ. A menu anchored to its row replaces
      the radio dialog (which stacked a dialog on the device sheet); `RadioDialog` is gone.
      Supersedes "choices in radio dialogs" in decision 22.
    - **The graph is chrome on a phone:** edge to edge under the app bar with a hairline under it,
      not a card. `wide:` keeps the card.

24. **Cutover first; serial and Bluetooth wait (2026-10-09).**
    - The rebuild landed on `main` (Phases 4.5–4.6 were committed there), so decision 11's branch
      split is over: `main` is the app, the `rebuild` branch is stale.
    - Phase 7 ran before Phases 5 and 6. Whether the app takes on USB serial and Bluetooth devices
      at all is undecided, so Phase 5 and the serial / BLE / SPP half of Phase 6 are postponed;
      the HID half of Phase 6 (attach/detach-driven discovery, the permission flow) can go ahead.
    - **Dev-only UI.** The demo device, a DEV / DEBUG badge in each header and the HID spike hook
      show only when the Vite mode isn't `production` (`isDebugBuild`, `src/lib/platform/build.ts`).
      `npm run android` and `android:sync:debug` build with `--mode debug`; `npm run build` and
      `android:sync` are release builds. The APK's own build type doesn't decide it: debug and
      release APKs package the same `dist/`. Supersedes decision 20's "on every platform" for the demo.
    - **USB plug and unplug** (Phase 6, HID): a drivable device plugged in while idle connects;
      the connected one unplugged disconnects. No launch-on-attach for now.
    - **The device chip connects.** Before a connection, the chip (and Connect in the empty state
      and the sync bar) starts a USB connect directly instead of opening the device sheet, which
      would hold only that button. The sheet opens when the attempt needs a pick, finds nothing to
      drive, or fails before the sync bar exists; once connected the chip opens it as before.

25. **The device's EQ is the document (2026-10-09).** The app is a companion to one device
    (decision 23), so what the list edits is what the device holds.
    - **Read on connect, and on a preset switch.** Connecting reads the target preset into the list;
      so does picking another preset in Device EQ. The read is a fresh start (`eqStore.open`: no
      undo back past it, which would hand the device another device's or preset's bands); the Read
      button's read stays an undo step. Replaces device-peq invariant 3 ("connecting never edits
      the filters") as far as reading goes; nothing still refits the list on its own.
    - **Except over unwritten changes.** `devicePeqStore.hasUnwritten` compares the list with the
      last read or write (or, before either, with the list when the device's content stopped being
      known); a disconnect or a preset change records it as `unwritten`. Reconnecting the same
      device (same name and profile) with unwritten changes doesn't read: the sync bar says
      "Earlier changes aren't on the device yet" and offers Read and Write, in manual and
      auto-write mode alike (connecting never writes). Another device is read regardless.
    - **No editing while disconnected.** `devicePeqStore.canEdit` (connected, not waiting to
      reconnect) → `eqConstraintStore.editable` gates the graph (no gestures or keys, dimmed nodes),
      band and preamp rows (disabled) and editors (a disabled `fieldset`), Add, Fit, undo/redo and
      Load preset (EQ tab and Presets tab). The list stays visible and can be saved as a preset; a
      disconnect drops the band selection. Supersedes decision 23's "the list stays editable
      against the last profile". Changes left unwritten at a disconnect are now only those made
      while connected: a pending or failed auto-write, or manual mode before Write.

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

- [x] **Main.** A large interactive `EqGraph` is the main element: response from `biquad.ts`,
      draggable band nodes, tap-to-select with a touch path for Q. Band list/editor from
      `EqFilterCard`. Device row + Device EQ + single status line from `DevicePeq`. Undo/redo,
      load/save preset. Desktop puts the graph and editor side by side; phone stacks them, with the
      band editor in a bottom sheet. *Decision 21; plus Fit, Ctrl+Z / Ctrl+Y.*
- [x] Per-band domains from `resolveSlot` / `slotOf`: min/max/step, fixed value lists, locked
      fields read-only, allowed types. `isGraphic` profiles get a fixed-frequency layout. Live
      `validateList` flags while editing. *`BandEditor` / `BandField`; graphic bands drag only in
      gain and have no add or remove.*
- [x] Preamp by `preamp.mode`: `manual` slider, `auto` hidden, `none` warns on boost, `unknown`
      slider with a note.
- [x] Profile status badge, experimental badge, links to the eqcaps inspector and its
      "wrong constraint" form.
- [x] **Presets** and **Settings** (theme, language, auto-push delay, diagnostics log viewer/export).
      *Plus real file export on Android (share sheet).*
- **Exit:** feature parity with the Vue prototype, on desktop and phone widths.
  *Code verified 2026-10-07: 242 tests (graph gestures and keys, the editor's domains, the preamp
  modes, presets search / rename / duplicate / fit, the log viewer). Checked by hand in Chromium
  with the demo device at 1280 and 390 px, light and dark, en and ko; the debug APK builds with the
  two new plugins. Open, for the user: on a real phone, graph drags at 60 fps (Risks), pinch for
  Q, the bottom sheet, Android back closing it and the dialogs, export through the share sheet,
  and importing a file; on hardware, Fit then Write on a real device (web and Android).*
  *2026-10-07: the user ran it on a Samsung phone with hardware; every feature worked. The
  feedback became Phase 4.5.*

### Phase 4.5: Mobile UX pass · 2–3 days

Decision 22. Order: atoms first, then the screens that use them.

- [x] **Model:** drop per-band `enabled` (model, store, push, preamp, graph, preset file, APO
      import/export, the row and editor switches). *`toWrittenFilter` is gone (`planPush` sends
      `toCapsFilter`); `ParsedPreset.disabled` became `dropped`.*
- [x] **Frequencies in full** in the band rows, the editor and the graph's node labels.
- [x] **Atoms:** `touch:` variant; a size scale that is touch-sized under it (Button, Switch,
      SegmentedControl, icon buttons); `ListRow` (label, supporting text, trailing control, whole
      row tappable); a generic `Sheet` (from `BandSheet`); `Slider` (bits-ui, large thumb and touch
      area) for the native ranges; `RadioDialog` for one-of-N settings. *`Slider` is a restyled
      native range (`.range` in layout.css), not bits-ui: it keeps the slider role, keyboard steps
      and the specs that drive it. Also `ListSection`, `ChipGroup`, and `Input` at 48 px on touch.*
- [x] **Settings** as list rows: Theme and Language as rows that open a radio dialog, switches
      trailing, the auto-write delay as a slider row, help as supporting text.
- [x] **EQ tab:** app bar with the device chip, undo/redo and an overflow menu (Load, Save, Fit);
      device sheet holding the device panel; graph pinned; preamp as one row; band rows; sync bar.
      Wide keeps its two columns, with the sync bar at the bottom of the content. *`EqToolbar` is
      gone (`EqAppBar`). The device panel's Device EQ is a row and a radio dialog, its facts are
      inline text, and its status line is the sync bar. The review dialog is
      `devicePeqService.review` (`requestWrite` / `confirmReview`), shown by `ReviewDialog`, so the
      sync bar's Write and the panel's share it. The preamp slider hides under Auto.*
- [x] **Sync bar states** for manual and auto-write, the chip's dot, haptics on native.
      *`device-peq/sync-status.ts` ranks them over `panelStatus`; `devicePeqStore.autoDueAt`
      drives the countdown ring. Before the first read or write the bar offers Read (and Write in
      manual mode). An edit that leaves the list as the device has it (a read, an undo) schedules
      nothing. A failed auto-write also shows a toast, which sits above the sync bar.*
- [x] **Band editor:** type as chips, each value a stepper (− value +) over a slider, the
      allowed-range hint only when it's violated, sized to its content. *The hint also shows while
      the number is being typed. The sheet's title names the band and its type.*
- [x] **Presets tab:** the same row and touch treatment. *Save is one line (name + Save); tags
      are set in Edit or in the EQ tab's save dialog.*
- **Exit:** on a real phone, no control under 48 px, editing a band never needs a scroll to see
  whether the device has it, and the build, check, lint and tests are green.
  *Code done 2026-10-07: 248 tests, build green. Checked in Chromium with Playwright's Pixel 7
  emulation (coarse pointer) and at 1280 px with a mouse, demo device. Open, for the user: the
  whole pass on a real phone (sheets, Android back on the sheets and the menu, haptics, the
  countdown ring), and with hardware.*

### Phase 4.6: Hardware-first refinements · 1 day

Decision 23.

- [x] **Graph** edge to edge on a phone.
- [x] **Menus:** `Menu`, `MenuItem`, `MenuSeparator`, `SelectMenu`; the EQ overflow and the preset
      ⋮ on them; Theme, Language and Device EQ as select menus; `RadioDialog` removed.
- [x] **Preamp** as one band-style row, `PreampEditor` in a sheet (phone) or inline (wide).
- [x] **Fixed bands:** no Add with a band count, Reset instead of Remove (Remove only past the
      count), Delete on a graph node resets, presets padded on load, Fit offered for a short list.
- [x] **No device:** the EQ tab's connect prompt, Load preset off; **disconnect** keeps
      `knownDevice`, the sync bar's Disconnected + Connect.
- **Exit:** build, check, lint and tests green (258). *Code done 2026-10-08, checked with
  Playwright's Pixel 7 emulation and at 1280 px, demo device. Open, for the user: a real phone
  (menus with Android back, the preamp sheet) and a real cable pull.*

### Phase 5: Serial and Bluetooth in the browser · 1 day · postponed (decision 24)

- [ ] Connect menu adds Serial (`requestSerialPort`) and Bluetooth (`requestBleDevice`). Both
      return an identity first and `open(protocol)` once matched. A Bluetooth serial port that
      several devices share asks the user which device it is.

### Phase 6: Android native plugin, full · separate milestone · serial and Bluetooth postponed (decision 24)

- [ ] Grow the Phase 0 spike into the plugin: USB HID (attach/detach broadcasts, permission flow),
      then `StreamTransport` for USB serial and BLE, then Classic SPP. No protocol code in the plugin.
- [x] Android discovery UX: live candidate list without a picker. *HID, 2026-10-09
      (decision 24): no list to pick from; the app follows the plugin's USB events instead.
      Plugging in a drivable device while nothing is connected and the app is in view connects it
      (the chip's path: permission prompt, a pick if several); anything else attached is ignored.
      Unplugging the connected device disconnects it at once (`usbDeviceName` on native
      connections), keeping the known device, so a replug reconnects. Open, for the user: on a
      real phone, that `USB_DEVICE_ATTACHED` reaches the plugin's runtime receiver (Android also
      sends it to activities; only `DETACHED` has been seen so far), plug and unplug with the app
      open, and a plug-in while the app is in the background (should do nothing).
      Launch-on-attach (manifest `device_filter.xml`): not now.*

### Phase 7: Cutover · ½ day

- [x] Delete the Vue/Ionic tree: `rm -r legacy` (decision 15; its dependencies already left in
      Phase 1), then drop the `legacy` ignore entries and the unused `@capacitor/status-bar`.
      *Also deleted `docs/eqcaps-migration.md` (superseded; decisions 1–7 live here).*
- [x] ARCHITECTURE.md: rewrite §3–§7, §9–§11 for the new tree; drop risk #7. CLAUDE.md: replace
      the Ionic/Vue sections with the new conventions. *ARCHITECTURE.md rewritten whole: it now
      describes the app as built (eqcaps, the push invariants, the EQ model, the plugin as it is);
      the old milestones became a short roadmap pointing here.*
- [x] eqcaps DECISIONS D27: "Ionic + Capacitor prototype" → "SvelteKit + Capacitor".
- **Exit:** build, lint and tests green; no reference to removed modules. *Passed 2026-10-09.*

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
