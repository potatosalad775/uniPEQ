# uniPEQ

A companion app for the parametric EQ built into many USB audio devices: DACs, dongles, headphones and IEMs. 

uniPEQ reads the EQ a device holds, lets you edit it on a graph, and writes it back, from a desktop browser or an Android phone.

## Features

- **Graph editor** for the device's EQ: drag, pinch, scroll to shape the frequency response, or set 
  the frequency, gain, Q and filter type exactly with Undo / redo.
- **Auto-write** after a short idle delay (adjustable, or off), with a status bar that says what's
  written and what isn't.
- **Local presets:** save, search, tag, and import / export, with a badge showing how well each fits
  the connected device.
- **Live link with [modernGraphTool](https://github.com/potatosalad775/modernGraphTool):** pair by
  QR code, link or code, and the EQ you build against a measurement there plays on your device as
  you edit. See [docs](https://potatosalad775.github.io/modernGraphTool/docs/features/unipeq-link/) for details.
- **Tune with measurements, entirely on Android:** open
  [modernGraphTool database](https://github.com/potatosalad775/modernGraphTool/discussions/86) in 
  your phone's browser, pair it with uniPEQ app, and every change you make against a measurement 
  plays on your device. Until now this needed a desktop browser with WebHID.

## Get it

| Where                 | How                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Web app**           | <https://unipeq.com> <br><sub>Chromium-based browser (Chrome, Edge…) required. Installable as a PWA.</sub>                   |
| **Android app**       | APK from [GitHub Releases](https://github.com/potatosalad775/uniPEQ/releases/latest).                                        |
| **Google Play**       | Coming soon.                                                                                                                 |

No hardware at hand? Pick the **demo device** on the EQ tab to try everything without one.

### Supported browsers and platforms

uniPEQ (web app) talks to devices over **WebHID**, which only Chromium-based browsers on a desktop computer have.

| Platform                                   | Works?                                                        |
| ------------------------------------------ | ------------------------------------------------------------- |
| Chrome, Edge or another Chromium browser on Windows, macOS, Linux, ChromeOS | ✅ Web app                   |
| Android                                    | ✅ Android app (Chrome on Android has no WebHID)              |
| Firefox, Safari (any platform)             | ❌ No WebHID: the app opens, but can't connect to a device    |
| iPhone, iPad                               | ❌ No USB access for any browser or app                       |

On Android, plug the audio device into the phone (directly over USB-C, or through an OTG adapter);
Android asks for permission the first time.

## Devices

uniPEQ has no device list or protocol code of its own. It runs on
[eqcaps](https://github.com/potatosalad775/eqcaps), a database of what each device's EQ accepts
plus the protocols that drive it: a device eqcaps knows works here.

USB HID devices are supported. Serial and Bluetooth devices aren't yet.

> **Device missing, not connecting, or showing wrong limits?** Please report it to
> [eqcaps](https://github.com/potatosalad775/eqcaps/issues), not here. The device panel links there
> too. Issues with the app itself belong in [uniPEQ's issues](https://github.com/potatosalad775/uniPEQ/issues).

## Development

SvelteKit 2 (static SPA) + Svelte 5 + Tailwind CSS 4 in Capacitor 8. Node.js 20.19 or newer.

```sh
npm install
npm run dev        # http://localhost:5173
npm run android    # build, install and start the debug app on a connected phone
```

Setup, tests, the Android toolchain, CI and releases: [CONTRIBUTING.md](CONTRIBUTING.md). How the
app is built: [ARCHITECTURE.md](ARCHITECTURE.md).

## License

uniPEQ is free software under the [GNU General Public License v3.0 or later](LICENSE). The app lists
the licenses of the software it ships under Settings → Open-source licenses. eqcaps, which carries
the device data and protocols, is MIT (code) and CC0 (data).
