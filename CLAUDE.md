# uniPEQ — agent notes

Parametric-EQ control app for USB/BT audio devices: SvelteKit + Svelte 5 + Tailwind 4 + bits-ui
in Capacitor 8, on the eqcaps packages (device data, protocols, browser transports).
[ARCHITECTURE.md](ARCHITECTURE.md) describes the app as it is. **Plan, decisions and checklist:
[docs/rebuild-plan.md](docs/rebuild-plan.md)** (Phases 0–4.6 and the Phase 7 cutover done;
Phases 5 and 6 postponed); what to copy from `../modernGraphTool`:
[docs/reuse-from-modernGraphTool.md](docs/reuse-from-modernGraphTool.md). Work happens on `main`.

## Commands

- `npm run dev` — vite dev server (http://localhost:5173)
- `npm test` — vitest once: `*.spec.ts` in node, `*.svelte.spec.ts` in Chromium browser mode
  (`npm run test:unit` to watch)
- `npm run check` — Paraglide compile + `svelte-kit sync` + `svelte-check`
- `npm run lint` — Prettier check + ESLint; `npm run format` fixes formatting
- `npm run build` — static SPA into `dist/` (Capacitor's `webDir`), release. `-- --mode debug` keeps
  the dev-only UI (demo device, DEV/DEBUG badge): `isDebugBuild` in `src/lib/platform/build.ts`
- `npm run data:snapshot` — refresh the embedded eqcaps bundle (before a release, not per build)
- Android: `npm run android [-- --serial <id> --skip-web --no-launch]` builds, installs and starts
  the debug app on the one connected adb device (`scripts/android-install.mjs`). By hand:
  `npm run android:sync:debug` (debug-mode build + `cap sync android`; plain `android:sync` is the
  release web build), then `android/gradlew assembleDebug`
  (`gradlew.bat` on Windows). The Gradle daemon JDK is pinned to Azul Zulu 21 by
  `android/gradle/gradle-daemon-jvm.properties` (+ foojay resolver in `settings.gradle`), so
  `JAVA_HOME` doesn't matter: Gradle uses an installed Zulu 21 or downloads one to `~/.gradle/jdks`.
  Capacitor 8 needs 21; Gradle 8.14 can't run on 25. The vendor pin keeps Gradle from reusing
  daemons that VS Code's Java extension starts on its bundled Temurin JRE, which has no `jlink`
  (AGP fails with "jlink executable … does not exist"). Keep the vendor anything but Adoptium;
  foojay has no JetBrains 21. Regenerate with
  `./gradlew updateDaemonJvm --jvm-version=21 --jvm-vendor=azul`. The SDK comes from `ANDROID_HOME` or
  `android/local.properties` (gitignored, `sdk.dir`).
- Cutting a release: `npm run release -- patch|minor|major|X.Y.Z [--prerelease]`
  (`scripts/release.mjs`): checks a clean, up-to-date main, runs check + test, then `npm version`,
  pushes the commit and tag and publishes the GitHub release with `gh`; the workflow below builds
  everything from there.
- Release builds: `npm run android:release [-- --apk --skip-web]` (`scripts/android-release.mjs`): release
  web build + `cap sync` + signed `bundleRelease` (`.aab` for Play). Signing from
  `android/key.properties` (gitignored; template `android/key.properties.example`, keystore
  `keystore.jks` in the repo root, also gitignored). `.github/workflows/release.yml` runs on a
  published GitHub release (tag `vX.Y.Z` must match package.json): it deploys the web build to
  GitHub Pages (`BASE_PATH=/uniPEQ` → `paths.base`; skipped for pre-releases) and uploads the
  `.aab` to a Play track (`PLAY_SERVICE_ACCOUNT_JSON`; `PLAY_TRACK` variable, default internal),
  signed from `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD` secrets; a manual run keeps it as a workflow artifact. It also attaches the
  sideload APK (`npm run android:release -- --sideload`: `VITE_DISTRIBUTION=github` web build,
  Gradle `-Psideload`: app id `kr.potatosalad775.unipeq.sideload`, signed with the `sideload.*`
  entries of `key.properties` / `SIDELOAD_*` secrets; its own id and key, since upload-key APKs
  under the Play id trip Play Protect). Only that build checks GitHub `releases/latest` for updates
  (`platform/release-updates.ts`); Play updates its installs, the web build has its service worker
  (`src/service-worker.ts`, `platform/pwa.ts`). `ci.yml` runs check, lint, test, build and a debug
  APK on pushes to main and PRs.
- Version: `package.json` only (`npm version patch|minor|major`). `android/app/build.gradle` reads it:
  versionName verbatim, versionCode `MAJOR*10000 + MINOR*100 + PATCH`; Settings shows it via
  `__APP_VERSION__`. `native/device-io`'s own version is internal and never changes.
- `npm run icons` renders `resources/icon.svg` into `static/favicon.png`, `static/apple-touch-icon.png`
  and `resources/play-store-icon.png` (512 px, Play listing). Launcher mipmaps are separate.
- `npm run android:hid-spike -- --bands 8` — Phase 0 USB HID spike on the running debug app
  (adb + DevTools protocol → `window.uniPeqHidSpike`, which runs the eqcaps handler's pull; only
  in a debug-mode web build)

## Conventions (src/)

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
  the control trailing, `SelectMenu` for one-of-N, `Menu` for overflow actions, `Sheet` for
  panels, supporting text not popovers. The EQ tab's device status is the sync bar (`device-peq/sync-status.ts`), its one
  status line.
- Devices: protocols, limits and device data are eqcaps' job (`../eqcaps`); a protocol bug or a
  missing device is fixed there. `src/lib/device-peq/` follows modernGraphTool's
  `device-peq/AGENTS.md` invariants (fit before every write, never retarget, one status line;
  decision 25 replaced "connect never edits": connecting reads the device unless the list has
  unwritten changes, and the list is read-only while disconnected, `eqConstraintStore.editable`). `connect.ts`, the bridge, the client and the snapshot stay behind
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
- Dev-only UI (the demo device, the DEV/DEBUG badge, the HID spike hook) checks `isDebugBuild`
  from `$lib/platform/build` (Vite mode ≠ production), so a release build drops it.

## Gotchas

- TS strictness: a `Uint8Array` where the DOM wants `BufferSource` / `BodyInit` fails
  (`ArrayBufferLike` vs `ArrayBuffer`); `.slice()` at the DOM boundary.
- The DeviceIo plugin (`native/device-io`, a `file:` dependency) stays protocol-free: device bytes
  belong in eqcaps handlers. Its TS typings live in `src/lib/transports/native/device-io.ts`; keep
  them in step with `DeviceIoPlugin.kt`.
- `src/lib/data/eqcaps-bundle.json` is downloaded verbatim (`npm run data:snapshot`); don't edit or
  format it.
