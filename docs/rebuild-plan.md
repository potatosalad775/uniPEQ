# Rebuild: SvelteKit + Capacitor + eqcaps

Rebuild the app on **SvelteKit (Svelte 5) + Tailwind 4 + bits-ui** inside **Capacitor**, with
the eqcaps packages replacing uniPEQ's own device database, protocol handlers, web transports and
adaptation engine. This supersedes the earlier "migrate the Ionic Vue prototype to eqcaps" plan.
Its decisions 1–7 carry over unchanged.

Status: **decided 2026-10-06; Phases 0–4.6 done 2026-10-06 → 10-08, the Phase 7 cutover
2026-10-09.** Phases 5 and 6 (serial and Bluetooth) are postponed (decision 24). What's left is
under [Open](#open). Record new decisions in the Decisions section; code cites them as
"decision N".

Related: [ARCHITECTURE.md](../ARCHITECTURE.md) (the app as it is).

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
   **read-only**: no profile means nothing to `fit` against. *(Replaced by modernGraphTool's
   approach: `guessedProfile` in `device-peq/connect.ts` builds a profile from `analyzeCodec`, so a
   guessed device can be written within what its wire carries.)*
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
10. **Push semantics follow modernGraphTool's `device-peq` invariants** (its
    `src/lib/device-peq/AGENTS.md`). Notably, read and write only a reachable preset: the current
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
    - Writable presets (decision 1) lived in `src/lib/device-peq/writable.ts` until eqcaps E1:
      the user memories of the 30 profiles that mix them with built-ins; every other profile is
      unrestricted. `writeTarget` is null on a built-in preset, never retargeted (decision 10).
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

The done phases' checklists and exit notes are in git history (this file at `284dadd`); what
they decided is above.

| Phase | Done | Outcome |
|---|---|---|
| 0: Android on real hardware | 2026-10-06 | `native/device-io` force-claims a USB HID interface; a walkplay dongle answered a `walkplay-hid` pull on a Samsung SM-S936N (decision 12). `npm run android:hid-spike -- --bands 8` reruns it on a debug build. |
| 1: Scaffold | 2026-10-06 | SvelteKit shell, tokens and atoms from modernGraphTool, framework-free services ported (decisions 8, 15, 17, 18). |
| 2: eqcaps data and connection | 2026-10-06 | Snapshot, client, connect flows, device store; checked on a FiiO device in Chrome and the Android app (decisions 3, 19). |
| 3: Push path, presets, demo | 2026-10-07 | Auto-write, review dialog, preset file v2, APO text, demo device (decisions 2, 5, 20). |
| 4: Screens | 2026-10-07 | Graph, band editor, preamp, presets and settings; every feature worked on a Samsung phone with hardware (decision 21). |
| 4.5: Mobile UX pass | 2026-10-07 | Touch sizing, list rows, sheets, sync bar, no per-band on/off (decision 22). |
| 4.6: Hardware-first refinements | 2026-10-08 | Fixed band counts, menus, preamp row, no editing before a device (decision 23). |
| 7: Cutover | 2026-10-09 | `legacy/` deleted, ARCHITECTURE.md and CLAUDE.md rewritten, eqcaps D27 updated (decision 24). |

### Phase 5: Serial and Bluetooth in the browser · 1 day · postponed (decision 24)

- [ ] Connect menu adds Serial (`requestSerialPort`) and Bluetooth (`requestBleDevice`). Both
      return an identity first and `open(protocol)` once matched. A Bluetooth serial port that
      several devices share asks the user which device it is.

### Phase 6: Android native plugin, full · separate milestone · serial and Bluetooth postponed (decision 24)

- [ ] Grow the Phase 0 spike into the plugin: `StreamTransport` for USB serial and BLE, then
      Classic SPP. No protocol code in the plugin. *USB HID (attach/detach broadcasts, the
      permission flow) is done.*
- [x] Android discovery UX, HID (2026-10-09, decision 24): no list to pick from; the app follows
      the plugin's USB events. Plugging in a drivable device while nothing is connected and the app
      is in view connects it (the chip's path: permission prompt, a pick if several); anything else
      attached is ignored. Unplugging the connected device disconnects it at once
      (`usbDeviceName` on native connections), keeping the known device, so a replug reconnects.
      Launch-on-attach (manifest `device_filter.xml`): not now.

## Open

### Checks on a real phone, for the user

Code for these is done and checked in emulation; each needs a run on a phone with hardware.

- [ ] Phase 4.5: sheets and the overflow menu closing on Android back, haptics on write, the
      sync bar's countdown ring.
- [ ] Phase 4.6: the select menus with Android back, the preamp sheet, a real cable pull.
- [ ] Phase 6 discovery: `USB_DEVICE_ATTACHED` reaching the plugin's runtime receiver (Android also
      sends it to activities; only `DETACHED` has been seen so far), plug and unplug with the app
      open, and a plug-in with the app in the background (should do nothing).
- [ ] Decision 17: the edge-to-edge path on WebView ≥ 140 (system bar icon style).
- [ ] Risks: graph drags at 60 fps on a mid-range phone.

### eqcaps-side tasks

- [x] **E1** (decision 1): optional `writable` on `protocol.presets[]`. *Done 2026-10-10: eqcaps
      format 1.1 (D48, eqcaps 0.3.0) marks the user memories of the 30 profiles that mix them with
      built-ins (none confirmed on hardware yet); `devicePeqStore.writableSlots` reads the marks,
      and `device-peq/writable.ts` is gone.*

### Other

- [x] Splash screen (2026-10-10): the mark from `resources/icon.svg` as a vector on the app's
      base-100, light or dark with the system, the Android 12 way on every API level (androidx
      core-splashscreen); the old prototype's white PNGs are gone.

## Risks

- **Android HID claim.** Passed on one Samsung phone (Phase 0, Phase 2). A device family that
  fails stays web-only.
- **WebView feel.** Graph drags must hold 60 fps on mid-range Android. Measure on a real phone,
  not in desktop emulation.
- **Draft data.** Most eqcaps profiles are seeded `draft`s whose ranges come from devicePEQ's
  handler code. The status badge makes this visible; wrong limits get reported upstream.
- **Copy drift.** Fixes in modernGraphTool's `device-peq/` won't reach us automatically. The
  header comments make it possible to diff against upstream; a shared package can wait until both
  copies settle (decision 9).
- **Breaking eqcaps releases** (0.x). Pin a caret range and read the eqcaps changelog / DECISIONS
  before bumping.
