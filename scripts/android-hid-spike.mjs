#!/usr/bin/env node
// Phase 0 USB HID spike driver (docs/rebuild-plan.md). Runs `window.uniPeqHidSpike()` inside the
// debug app's WebView on the connected phone or emulator, over adb + the Chrome DevTools
// protocol, and prints the WebView's console output and the result.
//
//   node scripts/android-hid-spike.mjs [--bands 8] [--serial emulator-5554]
//
// The app must be a debug build and running. Accept the USB permission prompt on the device
// when it appears; the script waits for it.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const APP_ID = 'kr.potatosalad775.unipeq';
const PORT = 9333;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const bands = Number(flag('bands', '8'));
const serial = flag('serial');

const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
const sdkAdb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const adbPath = existsSync(sdkAdb) ? sdkAdb : 'adb';
const adb = (...a) => execFileSync(adbPath, [...(serial ? ['-s', serial] : []), ...a], { encoding: 'utf8' }).trim();

const pid = adb('shell', 'pidof', APP_ID);
if (!pid) throw new Error(`${APP_ID} is not running: start the app first`);
adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid.split(/\s+/)[0]}`);

const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = pages.find((p) => p.type === 'page');
if (!page) throw new Error('No debuggable WebView page (is this a debug build?)');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let nextId = 1;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    // Skips Capacitor's per-call console groups; keeps the spike's own log lines.
    if (!['log', 'info', 'warn', 'error'].includes(msg.params.type)) return;
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (!text.startsWith('%c') && text !== 'Object') console.log(`[webview ${msg.params.type}] ${text}`);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Runtime.enable');
console.log(`Running uniPeqHidSpike({ bands: ${bands} }) in ${page.url} — accept the USB prompt on the device if asked`);
const { result } = await send('Runtime.evaluate', {
  expression: `window.uniPeqHidSpike({ bands: ${bands} })`,
  awaitPromise: true,
  returnByValue: true,
});
ws.close();
adb('forward', '--remove', `tcp:${PORT}`);

if (result.exceptionDetails) {
  console.error('Spike failed:', result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  process.exit(1);
}
console.log(JSON.stringify(result.result.value, null, 2));
