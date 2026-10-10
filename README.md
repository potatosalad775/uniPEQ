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
> Chrome / Edge and in the Android app. Serial and Bluetooth devices are not wired up yet. Design
> and open items: [ARCHITECTURE.md](ARCHITECTURE.md).

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

Requirements: Node.js 20.19 or newer.

```sh
npm install
npm run dev          # http://localhost:5173
```

Open it in Chrome or Edge, plug in a supported device and press **Connect USB device**, or try the
demo device without one.

For the Android app, plug in a phone with USB debugging (or start an emulator) and run
`npm run android`: it builds, installs and starts the debug app. Plug the audio device into the
phone (a USB-C dongle, or through an OTG adapter) and connect; Android asks for permission the
first time.

Tests, the Android toolchain, CI and releases: [CONTRIBUTING.md](CONTRIBUTING.md).

## How it fits together

```
src/
├── routes/                 # one route per tab: EQ, Presets, Settings
└── lib/
    ├── components/         # atoms (Button, Switch, …), layout shell, device panel
    ├── device-peq/         # connect flows, push plan, sync status, demo device
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
- Everything else: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

uniPEQ is free software under the [GNU General Public License v3.0 or later](LICENSE). The app lists
the licenses of the software it ships under Settings → Open-source licenses. eqcaps, which carries
the device data and protocols, is MIT (code) and CC0 (data).
