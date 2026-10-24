# Contributing to uniPEQ

A device that doesn't connect, or limits that look wrong, belongs in
[eqcaps](https://github.com/potatosalad775/eqcaps/issues): it holds the device data and the
protocols (the device panel links there). This file is about the app itself.

- How the app is built: [ARCHITECTURE.md](ARCHITECTURE.md).
- Code conventions: [CLAUDE.md](CLAUDE.md) (written for coding agents, but it is the style guide).
- Shared UI and device code comes from [modernGraphTool](https://github.com/potatosalad775/modernGraphTool);
  copied files name their source path and commit in a header comment.

## How it fits together

- **Device data** comes from the eqcaps CDN, cached on the device and refreshed on each launch; a
  bundled snapshot covers an offline first launch.
- **Protocols** are `@potatosalad775/eqcaps-device-bridge`. The Android plugin
  (`native/device-io`) only moves bytes; it knows nothing about any vendor.
- **Every write is fitted** to the device's limits first, and anything that had to change is shown
  before it's written. Nothing is clamped silently.

The source layout and the rules behind each part are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Setup

Node.js 20.19 or newer.

```sh
npm install
npx playwright install chromium   # once: component specs run in headless Chromium
npm run dev                        # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Unit specs (Node) and component specs (`*.svelte.spec.ts`, Chromium); `npm run test:unit` watches |
| `npm run check` | Paraglide compile, `svelte-kit sync`, `svelte-check` |
| `npm run lint` | Prettier check and ESLint; `npm run format` fixes formatting |
| `npm run build` | Release web build into `dist/`; `-- --mode debug` keeps the debug-only UI |

Before a pull request: `npm run check`, `npm run lint` and `npm test`. CI runs the same.

To try unreleased eqcaps changes, install the tarballs from `npm run release -- <version> --pack`
in eqcaps. Never a `file:` link.

## Translating

Every string the app shows, the Android notification included, is in `messages/<locale>.json`,
keyed the same as `messages/en.json` (the source). A key a language doesn't have yet shows in
English, so a partial translation is fine to send.

**In the browser, with no code (recommended).**
[Open uniPEQ in Fink](https://fink.inlang.com/?repo=potatosalad775/uniPEQ&project=project.inlang),
a free translation editor that turns your edits into a pull request. You need a GitHub account and
the [Inlang GitHub App](https://github.com/apps/inlang/installations/new) installed on your own
account, so Fink can push to your fork.

1. Under **Translate into**, pick your language, then filter **To do** to see what it's missing.
2. When you're done, choose **Fork**, then **Review** and **Push**, then **Open pull request**,
   and submit it on GitHub.

To add a language that isn't listed, choose **Fork** first, then add its code (`de`, `pt-BR`, …) in
Fink's **Settings** tab: settings edits don't carry over into a fork. Its file is created when you
push its first translations, and the language menu in Settings picks it up under its own name.
Fink's own guides cover [forks and pull requests](https://fink.inlang.com/docs/branches-forks-and-pull-requests)
and [plurals](https://fink.inlang.com/docs/plurals-and-selects).

Fink may label the `android_*` keys **Not used in code**, because the native Android app reads them
instead of the web code. They are used: translate them, and never delete them.

**In a text editor (offline).** If `messages/_missing_translations_<locale>.json` exists, it lists
what that language still lacks, pre-filled with the English text. Replace the values you can,
delete the ones you can't, and open a pull request with the file. You can also edit
`messages/<locale>.json` directly instead. To add a language this way:

1. Add its code to `locales` in `project.inlang/settings.json`.
2. Create `messages/<locale>.json` with just
   `{ "$schema": "https://inlang.com/schema/inlang-message-format" }`.
3. Run `npm run i18n:missing`, which writes the stub file above with every key, and translate
   it.

**What to keep as is.**

- Placeholders in braces, like `{host}` or `{count}`: move them where your grammar needs them,
  but don't translate or rename them.
- Product names: uniPEQ, modernGraphTool, eqcaps.
- Messages themselves: don't add, delete or rename them (in Fink or by hand). That comes with a
  code change.
- Counts: in Fink, choose **Split by {count}** when your language needs more forms than English.
  In a stub file, write a plural as an object of your language's forms (the stub's `@@info`
  lists them), for example `{ "one": "{count} band", "few": "{count} bands", "other": "{count} bands" }`, or
  inline as `{count, plural, one {# band} other {# bands}}`.
- `android_*` keys feed the native Android app, which can't use plurals; keep them plain text.

**For maintainers.**

| Command | What it does |
|---|---|
| `npm run i18n:check` | Lists the keys each locale is missing or has stale against `en.json`; fails if `messages/` and `settings.json` list different locales |
| `npm run i18n:missing` | Same, and writes the `_missing_translations_<locale>.json` stubs |
| `npm run i18n:apply` | Merges edited stubs into `messages/<locale>.json`, deletes them and writes fresh stubs for what's still missing. Values left identical to `en` are skipped; `i18n:apply_force` imports them too (for names that stay in English) |

Run `npm run i18n:missing` after adding keys to `en.json`, so translators see them, and after
merging a Fink pull request, so the stubs stop listing what it translated. A Fink PR touches only
the edited messages in `messages/<locale>.json` (plus `project.inlang/settings.json` for a new
language) and needs no `i18n:apply`.

The `android_*` keys are written into the gitignored
`android/app/src/main/res/values*/generated_strings.xml` by `scripts/android-strings.js`, on
`i18n:compile` and every Vite build. A new one also needs an entry in `ANDROID_STRINGS` there,
listing its placeholders in the order Java passes them.

## Android

Needs the Android SDK (Android Studio installs it) and a phone with USB debugging (or paired over
Wi-Fi with `adb pair` / `adb connect`), or an emulator.

```sh
npm run android                    # debug web build, cap sync, assembleDebug, install, launch
npm run android -- --serial <id>   # pick a device when several are connected (`adb devices`)
npm run android -- --skip-web      # reuse the last web build (only native code changed)
npm run android -- --no-launch     # install without starting
npm run android -- --release       # the signed release APK instead (needs android/key.properties)
npm run android -- --sideload      # the GitHub sideload APK (own app id, installs beside the others)
```

Debug and release builds share the app id but not the signing key, so Android won't update one
with the other: `adb uninstall kr.potatosalad775.unipeq` (wipes its data) before switching. The
script stops with that hint rather than uninstalling for you. `android:release` below only builds;
`android --release` builds and installs.

By hand: `npm run android:sync:debug` (debug-mode web build + `cap sync android`; plain
`android:sync` is the release web build), then `android/gradlew assembleDebug` (`gradlew.bat` on
Windows), or open `android/` in Android Studio.

- **SDK:** from `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `android/local.properties` (`sdk.dir`,
  gitignored) or the default install location.
- **JDK:** `JAVA_HOME` doesn't matter. `android/gradle/gradle-daemon-jvm.properties` (with the
  foojay resolver in `settings.gradle`) pins the Gradle daemon to Azul Zulu 21, installed or
  downloaded to `~/.gradle/jdks`. Capacitor 8 needs 21, and Gradle 8.14 can't run on 25. The vendor
  pin also keeps Gradle off daemons that VS Code's Java extension starts on its bundled Temurin JRE,
  which has no `jlink` (AGP: "jlink executable … does not exist"). Keep the vendor anything but
  Adoptium; foojay has no JetBrains 21. Regenerate with
  `./gradlew updateDaemonJvm --jvm-version=21 --jvm-vendor=azul`.
- **`native/device-io`** is the app's own Capacitor plugin (Kotlin). It stays protocol-free: device
  bytes belong in eqcaps handlers. Its TS typings live in `src/lib/transports/native/device-io.ts`;
  keep them in step with `DeviceIoPlugin.kt`.
- **HID spike:** `npm run android:hid-spike -- --bands 8` runs a raw eqcaps handler pull through the
  plugin on the running debug app (adb + DevTools protocol → `window.uniPeqHidSpike`).
- When a native dependency changes, recheck the hand-written Android list in
  `scripts/third-party-licenses.ts` against
  `android/gradlew -p android :app:dependencies --configuration releaseRuntimeClasspath`.

## Assets and data

- `npm run data:snapshot` refreshes `src/lib/data/eqcaps-bundle.json`, the eqcaps data used only on
  an offline first launch. Run it before a release, not per build; don't edit or format the file.
- `npm run icons` renders `resources/icon.svg` into `static/favicon.png`,
  `static/apple-touch-icon.png` and `resources/play-store-icon.png` (512 px, Play listing).
  Launcher mipmaps are separate. The Android splash is `res/drawable/splash_icon.xml` (the mark as
  a vector, drawn by hand from `icon.svg`) on `splash_background` (`values` / `values-night`, the
  app's base-100), via core-splashscreen's `AppTheme.NoActionBarLaunch` on every API level.

## CI

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests: check, lint, test, a
release web build, and a debug APK (so a Kotlin break shows before a release does).

## Releasing

The version lives in `package.json` only. `android/app/build.gradle` reads it: versionName
verbatim, versionCode `MAJOR*10000 + MINOR*100 + PATCH`. Settings shows it (`__APP_VERSION__`).
`native/device-io`'s own version is internal and never changes.

```sh
npm run release -- patch|minor|major|X.Y.Z [--prerelease] [--yes]
```

`scripts/release.mjs` needs a clean `main` up to date with origin and a signed-in `gh`. It runs
check and test, `npm version` (commit + tag `vX.Y.Z`), pushes both and publishes the GitHub release.
Nothing is built locally. The published release starts `.github/workflows/release.yml`:

- **Web:** deployed to GitHub Pages (`BASE_PATH=/uniPEQ` → `paths.base`). Skipped for
  pre-releases.
- **Play:** the signed `.aab` is uploaded to a Play track (`PLAY_TRACK` variable, default
  `internal`). A manual run, or a release without `PLAY_SERVICE_ACCOUNT_JSON`, keeps the bundle as
  a workflow artifact instead (Play refuses a versionCode twice).
- **Sideload APK:** attached to the release. Built with `VITE_DISTRIBUTION=github` and Gradle
  `-Psideload`: app id `kr.potatosalad775.unipeq.sideload`, signed with its own key, so it installs
  beside the Play app and Play Protect doesn't flag it as a re-signed copy. Only this build checks
  GitHub `releases/latest` for updates, which skips pre-releases.

The workflow's header comment lists the one-time Pages and Play setup and every secret and variable.
The tag must match `package.json`.

### Local release builds

```sh
npm run android:release                  # signed .aab for Play (builds only; install: npm run android -- --release)
npm run android:release -- --apk         # also a signed APK (upload key, local testing only)
npm run android:release -- --sideload    # the GitHub sideload APK
npm run android:release -- --skip-web    # reuse dist/ (must be a release build of the same kind)
```

Signing comes from `android/key.properties` (gitignored; copy `android/key.properties.example`).
The upload keystore `keystore.jks` and the sideload one `sideload.jks` sit in the repo root, also
gitignored. Keep the sideload key forever: a new key can't update existing installs.
