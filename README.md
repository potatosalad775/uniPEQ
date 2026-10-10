# uniPEQ

Parametric EQ control for USB and Bluetooth audio devices: DACs, dongles, headphones and IEMs with
a built-in hardware EQ. Read the EQ a device holds, edit it, and write it back — from a desktop
browser or an Android phone.

**Web app:** <https://potatosalad775.github.io/uniPEQ/> (Chrome or Edge on a computer; see
[Platforms](#platforms)).

uniPEQ doesn't carry its own device list or protocol code. It runs on
[eqcaps](https://github.com/potatosalad775/eqcaps), a database of what each device's EQ accepts
(bands, ranges, filter types, presets) plus the protocols that drive them. A device eqcaps knows
works here; a missing one is added there.

> **Status:** USB HID devices work end to end (connect, read, edit on the graph, write, presets) in
> Chrome / Edge and in the Android app. Serial and Bluetooth devices are not wired up yet. Design:
> [ARCHITECTURE.md](ARCHITECTURE.md); plan and progress: [docs/rebuild-plan.md](docs/rebuild-plan.md).

## Platforms

| Platform                        | How it reaches the device                        |
| ------------------------------- | ------------------------------------------------ |
| Chrome / Edge on a computer     | WebHID (Web Serial and Web Bluetooth are planned) |
| Android app                     | A Capacitor plugin that claims the USB HID interface directly |
| Firefox, Safari (any platform)  | None: no WebHID. The app opens, but can't connect to a device |

WebHID exists only in Chromium-based browsers on desktop, so Firefox and Safari can't reach USB
devices; the device panel says so in place of the Connect button. Android Chrome has no WebHID
either, which is why Android gets a native app rather than a web page.

## Getting started

Requirements: Node.js 20.19 or newer. For Android, also the Android SDK (Android Studio installs
it) and a phone with USB debugging, or an emulator.

```sh
npm install
npm run dev          # http://localhost:5173
```

Open it in Chrome or Edge, plug in a supported device and press **Connect USB device**.

### Android

Connect a phone with USB debugging on (or pair one over Wi-Fi with `adb pair` / `adb connect`), or
start an emulator, then:

```sh
npm run android
```

This builds the web app, syncs it into the Android project, builds the debug APK, installs it and
starts it. Options:

```sh
npm run android -- --serial <id>   # pick a device when several are connected (see `adb devices`)
npm run android -- --skip-web      # reuse the last web build (only native code changed)
npm run android -- --no-launch     # install without starting
```

The SDK is found through `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `android/local.properties` or the
default install location. Gradle downloads its own JDK (Azul Zulu 21) if it isn't installed, so
`JAVA_HOME` doesn't matter.

Plug the audio device into the phone (a USB-C dongle, or through an OTG adapter), open the app and
press **Connect USB device**; Android asks for permission the first time.

## Scripts

| Command                     | What it does                                                    |
| --------------------------- | --------------------------------------------------------------- |
| `npm run dev`               | Dev server                                                      |
| `npm run build`             | Static build into `dist/`                                       |
| `npm test`                  | Unit tests (Node) and component tests (headless Chromium)       |
| `npm run check`             | Type check                                                      |
| `npm run lint`              | Prettier and ESLint (`npm run format` fixes formatting)         |
| `npm run android`           | Build, install and start the Android debug app                  |
| `npm run android:sync`      | Web build + `cap sync android` only, for working in Android Studio |
| `npm run android:sync:debug` | The same with the debug-only UI (demo device, DEBUG badge)     |
| `npm run data:snapshot`     | Refresh the eqcaps data bundled for offline first launches      |
| `npm run android:hid-spike` | Low-level USB HID check on a running debug app                  |
| `npm run release -- patch`  | Bump, tag and publish a GitHub release; CI builds web, Play and APK |

Component tests run in Playwright's Chromium; run `npx playwright install chromium` once if it
isn't installed.

## How it fits together

```
src/
├── routes/                 # one route per tab: EQ, Presets, Settings
└── lib/
    ├── components/         # atoms (Button, Switch, …), layout shell, device panel
    ├── device-peq/         # connect flows, preset reachability, writable presets, errors
    ├── eq/                 # filter model (eqcaps type codes) and biquad response math
    ├── services/           # eqcaps client, device service, presets, logger, undo/redo
    ├── stores/             # app state as Svelte 5 rune classes
    ├── platform/           # Capacitor glue: back button, system bars, haptics, file export
    ├── transports/native/  # TypeScript side of the Android USB plugin
    └── data/               # bundled eqcaps snapshot
native/device-io/           # the Android plugin (Kotlin): USB permission, HID claim, reports
android/                    # Capacitor's Android project
```

- **Device data** comes from the eqcaps CDN, cached on the device and refreshed on each launch; a
  bundled snapshot covers an offline first launch.
- **Protocols** are `@potatosalad775/eqcaps-device-bridge`. The Android plugin only moves bytes;
  it knows nothing about any vendor.
- **Every write is fitted** to the device's limits first, and anything that had to change is shown
  before it's written. Nothing is clamped silently.

Stack: SvelteKit 2 (static SPA), Svelte 5, Tailwind CSS 4, bits-ui, Paraglide (English, Korean),
Capacitor 8, Vitest.

## Contributing

- A device that doesn't connect, or limits that look wrong: report it to
  [eqcaps](https://github.com/potatosalad775/eqcaps/issues) — the device panel links there.
- Code conventions and project notes: [CLAUDE.md](CLAUDE.md). Shared UI and device code comes
  from [modernGraphTool](https://github.com/potatosalad775/modernGraphTool); see
  [docs/reuse-from-modernGraphTool.md](docs/reuse-from-modernGraphTool.md).
- Before a pull request: `npm run check`, `npm run lint` and `npm test`.
