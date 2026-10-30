# uniPEQ — agent notes

Parametric-EQ control app for USB/BT audio devices: SvelteKit + Svelte 5 + Tailwind 4 + bits-ui
in Capacitor 8, on the eqcaps packages (device data, protocols, browser transports).
[ARCHITECTURE.md](ARCHITECTURE.md) describes the app and the rules behind it; read the relevant
section before changing behaviour. Builds, Android toolchain, CI and releases:
[CONTRIBUTING.md](CONTRIBUTING.md). Work happens on `main`.

## Commands

- `npm run dev` (`dev:eqcaps`: on device data built from `../eqcaps` or `EQCAPS_DIR`) · `npm test` (`*.spec.ts` in node, `*.svelte.spec.ts` in Chromium) ·
  `npm run check` · `npm run lint` (`npm run format` fixes). Run check, lint and test before a commit.
- `npm run build` is a release build; `-- --mode debug` keeps the debug-only UI.
- `npm run android [-- --release|--sideload --serial <id> --skip-web --no-launch]` builds, installs
  and starts the app (debug by default) on the connected adb device; `android:release` only builds
  the signed `.aab`/APKs. `JAVA_HOME` doesn't matter (Gradle pins Azul Zulu 21; see
  CONTRIBUTING).
- `npm run release -- patch|minor|major` cuts a release; CI builds everything from the tag.
  Version lives in `package.json` only.

## Conventions (src/)

- Style, runes, tokens and atoms follow modernGraphTool (its root and `src/lib/components`
  `AGENTS.md`): tabs, single quotes, no trailing commas, 100 columns; Svelte 5 runes only, module
  state in `.svelte.ts` classes; colours only through the semantic tokens in
  `src/lib/styles/theme.css` (`bg-base-100`, `text-base-content/60`, …); reach for
  `src/lib/components/atoms/` before raw elements. Files are kebab-case.
- Files copied from modernGraphTool start with a comment naming the source path and commit.
- Comments state the rule and its reason in place; don't cite docs sections or numbered decisions.
- UI strings: Paraglide, `messages/{en,ko}.json`, `import * as m from '#lib/paraglide/messages.js'`.
  `src/lib/paraglide/` is generated and gitignored.
- One layout breakpoint, `wide:` (900 px): side rail above, bottom tab bar below. Pad for system
  bars with `pt-(--inset-top)` etc. (from `layout.css`), never raw `env()`.
- Touch sizing is the `touch:` variant (`pointer: coarse`), not a width. On phones follow Android
  patterns: `ListRow`/`ListSection` with the control trailing, `SelectMenu` for one-of-N, `Menu`
  for overflow, `Sheet` for panels, supporting text not popovers.
- Button sizes go by role, so the same role matches everywhere: `md` for dialog footer and panel
  actions, `sm` for actions inline in a row, bar or list (sync bar, Reconnect, row actions),
  `icon-sm` for app-bar and sheet-header icons, `icon-xs` for a dismiss ✕ in a toast. A `Button`'s
  `class` is layout and colour only, never padding, height or text size (`button-sizes.spec.ts`
  checks); a new size goes into `Button.svelte`. A raw `<button>` is only for a row-shaped hit
  area (`ListRow`, band rows, picker items, `DeviceChip`). Settings are `ListRow`s with a trailing
  control, not buttons.
- Devices: protocols, limits and device data are eqcaps' job (`../eqcaps`); a protocol bug or a
  missing device is fixed there. `src/lib/device-peq/` keeps the read/write invariants in
  ARCHITECTURE §5 (fit before every write, never retarget, the device's EQ is the document, one
  status line: the sync bar). `connect.ts`, the bridge, the client and the snapshot stay behind
  dynamic `import()`; only `eqcaps-core` may be in the boot bundle. State in
  `stores/device-peq-store.svelte.ts`, actions in `services/device-peq-service.svelte.ts`.
- EQ edits go through `eqStore` methods, never by assigning `filters`: each is an undo step, or
  joins one through a coalesce key (slider drags, held keys) or `record()` at a gesture's start.
  Project an edit onto the band's slot with `editFilter` first; only Fit (`fitFilters`) folds the
  whole list onto the device. Limits and `editable` come from `stores/eq-constraint-store.svelte.ts`.
- Overlays that should close on Android back register with `onBack()` from
  `#lib/platform/back-button.js` and remove the handler when they close.
- Dev-only UI (DEV/DEBUG badge, HID spike hook) checks `isDebugBuild` from `#lib/platform/build.js`.
  The demo device is not dev-only: it ships so the app can be tried (and Play-reviewed) without
  hardware.

## Gotchas

- Android WebView only stretches an inner scroller at its edge if `html` is not
  `overscroll-behavior: none` (it stays `contain`) and the scroller has `overscroll-{y,x}-contain`
  on the axis it scrolls; with `auto`, a pull that starts at the edge passes to the root, which
  can't move. Give every new scroller one (only its own axis, so a chip row doesn't swallow
  vertical swipes).
- Component specs load no Tailwind: don't assert layout or computed utility styles there.
- A spec that hides WebHID must delete `hid` from `Navigator.prototype`: feature detection is
  `'hid' in navigator` (`canConnectUsb`).
- TS strictness: a `Uint8Array` where the DOM wants `BufferSource` / `BodyInit` fails
  (`ArrayBufferLike` vs `ArrayBuffer`); `.slice()` at the DOM boundary.
- `native/device-io` (a `file:` dependency) stays protocol-free. Its TS typings live in
  `src/lib/transports/native/device-io.ts`; keep them in step with `DeviceIoPlugin.kt`.
- eqcaps comes from npm; never a `file:` link (tarballs from eqcaps' `--pack` for unreleased work).
- `src/lib/data/eqcaps-bundle.json` is downloaded verbatim (`npm run data:snapshot`); don't edit or
  format it.
- A native dependency change means rechecking the hand-written Android list in
  `scripts/third-party-licenses.ts` (command in CONTRIBUTING). The app is GPL-3.0-or-later.
