# Device controls, the active preset, and button sizes

Started 2026-10-29. A working note: what is done, what is next. Once it has landed, what the app is
goes into ARCHITECTURE.md and AGENTS.md, and this file goes.

The bridge side is also tracked in eqcaps' `docs/plans/fosi-audio.md`.

## Goal

1. **Active preset.** The DS3 connects with Device EQ showing "Unknown": the app should show the
   preset the device plays, and whether its EQ is on.
2. **Device controls.** eqcaps 0.2.5 drives the controls a profile lists (format 1.2): volume,
   gain, DAC filter, upsampling, USB mode, game mode, LED on the DS3. Offer them in the app.
3. **Button sizes.** Buttons differ in size across the app for the same role. Fix them and write
   the rule down, before the controls add more UI.

## 1. Active preset

**Cause.** The Fosi handler has no `currentSlot()` (`readsCurrentSlot: false`), so the app gets
null, and the store shows null as "Unknown" on a device with an EQ switch
(`device-peq-store.svelte.ts`, `setConnected`).

**Found on the device** (2026-10-29, DS3 firmware 1.6.10, UAC 2.0, through Fosi's own app at
cc.fosiaudio.com): `0x8B 0xFF` answers the *active* preset, in the same layout as `0x8B <id>`
(byte 2 the index, then pre-gain and name). It followed every `0x8A` select (8, 3, 7, 9, 0), also
with the EQ off. The EQ switch (`0x9D` / read `0x9E`) is separate state: selecting a preset doesn't
turn it on, and turning it off leaves the preset as it was. Fosi's app sends `0x8B 0xFF` when it
connects; the earlier recordings have it in UAC 1.0 on 1.4.6 (answered 7) and 1.6.10 (answered 0).

**Plan.**

- [x] eqcaps bridge: Fosi `currentSlot()` sends `0x8B 0xFF` and returns byte 2,
      `readsCurrentSlot: true`. It reports the preset whether the EQ is on or off.
- [x] eqcaps bridge: `eqEnabled(): Promise<boolean | null>` on the device and an optional handler
      method, with a `readsEnabled` capability (as `readsFirmware`); Fosi answers it with `0x9E`.
      `currentSlot` can't carry this: "on preset 7 with the EQ off" is one state on the DS3. FiiO
      serial has a separate EQ switch too, and could follow.
- [x] eqcaps: the fake DS3 tracks the active preset and the EQ switch; handler tests for both
      reads; the README's capability list. Packed as 0.2.5-dev.4 (uncommitted on
      `feat/device-controls`), installed here.
- [x] uniPEQ: `PeqCapabilities` gains `readsEnabled`, `PeqDevice` gains `eqEnabled()`.
      `#finishConnect` / `#finishReopen` read both and call `setConnected(conn, slot, enabled)`;
      `eqEnabled` is the read value when there is one, else today's bypass-preset rule.
- [x] uniPEQ: specs for the store (a preset with the EQ off shows Off, and Read still reaches
      that preset) and the service (the switch is read only where the protocol reads one).
- [ ] Try it on the DS3: connect with the EQ on and off, on a built-in and a user preset.
- [ ] Later: the modernGraphTool link (`link-service.svelte.ts`) mirrors the capabilities without
      `readsEnabled`; it doesn't need it while the link side never reads the switch itself.

## 2. Device controls

**Bridge API** (eqcaps-device-bridge 0.2.5): `capabilities.controls` (the profile's `Control`s
this bridge drives), `readControls()` (null for a control absent now: firmware range or `when`),
`writeControl(id, value)` (`{ reconnect }`; reads back unless the control is `reconnect`),
`firmware()`; `controlPresent`, `controlTakes` and `eqDisabledBy` in eqcaps-core.

**DS3 data.** uacMode (choice, reconnects), filterMode (choice, UAC 2.0 only), upsample (toggle,
UAC 2.0, firmware ≥ 1.4.9, `disablesEq: [1]`), gameMode (choice, UAC 1.0 only, reconnects),
gainMode (choice L/H), volume (range 0–60), led (toggle).

**Plumbing.**

- [ ] `types.ts`: `PeqCapabilities` gains `controls` and `readsFirmware`; `PeqDevice` gains
      `readControls`, `writeControl`, `firmware`.
- [ ] `connect.ts`: `readFirmware()` already reads the firmware to tell profiles apart; keep it on
      the `DeviceConnection`, so it isn't read twice, and show it in the device facts.
- [ ] Store: `controlValues: Record<string, number | null>`, `firmware`.
- [ ] Service: read the controls on connect and reopen (only when there are any); `setControl(id,
      value)` under the same busy flag as reads and writes; read all controls again after each
      write, since `when` changes which exist (UAC swaps Filter and Upsample for GAME).

**UI** (in `DevicePanel`: the side rail when wide, the device sheet on a phone). A "Device
settings" section after the EQ rows, in the data's order, Android patterns only:

| Kind | Shown as | DS3 |
| --- | --- | --- |
| toggle | `ListRow` + trailing `Switch` | Upsample, LED |
| choice | `ListRow` as a `SelectMenu` trigger (as Device EQ) | UAC, Filter, GAME, Gain |
| range | `ListRow` with a `Slider` | Volume |

- [ ] A control that reads null isn't shown.
- [ ] Row labels by `role` through Paraglide (`device_control_volume`, …, en and ko), falling back
      to `control.name`; value names as the data gives them ("Fast Linear").
- [ ] Volume writes once on release, never per drag step (write only on a user change). Fosi's
      app warns above 50; that isn't in the data. Decide: add it to eqcaps, or leave it out.
- [ ] `disablesEq` (Upsample on): supporting text on the row, and a sync-bar status line (the one
      status line). Fosi's app turns upsampling off when the EQ goes on, and the reverse: offer
      the same.
- [ ] `reconnect` controls (UAC, GAME): confirm first (the device restarts, audio drops).
- [ ] UAC changes the USB identity: UAC 2.0 is `152a:889b`, UAC 1.0 is `20b1:80d5`. `reopenHid`
      and `reopenNative` look for the same vid/pid/name, so they won't find it; on the web the new
      identity isn't granted either. After the write: `needsReconnect`, try `reopen` against each
      of the profile's `match.usb` entries, else the chooser (Connect gives the user activation).
- [ ] The demo device (FiiO protocol) has no controls, so the feature can't be tried without
      hardware. Decide: give the demo profile a few, or not.
- [ ] Specs: the panel shows only present controls; a write re-reads; a reconnect control asks
      first.

## 3. Button sizes

**Found** (60 `Button`s, plus raw `<button>`s):

- Dialog footers: `PushDialog` and `EditPresetDialog` use `sm`; Save preset, Link approval, Link
  battery, Volume warning, Log and Preset picker use `md`.
- `EqAppBar` overrides its `icon-sm` buttons with `p-2` (an `icon` on desktop); Sheet, BandSheet
  and PresetsPanel use `icon-sm` as is.
- `DevicePanel`: Disconnect is a solid `md` destructive beside the device name; Reconnect in the
  same panel is `sm` outline.
- `Toast` and `UpdatePrompt` dismiss ✕: raw `<button>` with `p-0.5`, about 20 px, no `touch:` size.

**Rule** (goes into AGENTS.md Conventions):

- Size by role, not by screen: dialog footer and panel actions `md`; actions inline in a row, bar
  or list (sync bar, Reconnect, band and preset row actions) `sm`; app-bar and sheet-header icons
  `icon-sm`; a dismiss ✕ in a toast or banner `icon-xs`.
- `class` on `Button` is for layout only (`flex-1`, `shrink-0`, `gap-*`, margins), never padding,
  height or text size; a new size goes into `Button.svelte`.
- `Button` for anything that looks like a button; a raw `<button>` only for row-shaped hit areas
  (`ListRow`, `BandList` rows, picker items, `DeviceChip`).
- Settings are `ListRow`s with a trailing control, not buttons.

**Plan.**

- [x] Apply it: the two dialog footers (`md`), `EqAppBar`'s overrides (now `icon-sm`: 32 px on
      desktop rather than 36, 40 px on touch as before), Disconnect (`sm`), the two ✕s (`icon-xs`:
      32 px on touch, was about 20).
- [x] `atoms/button-sizes.spec.ts` flags a `Button` whose literal `class` sets padding, height or
      text size.
- [x] Add the rule to AGENTS.md.
- [ ] Look at it on a phone and on desktop: the app bar, a toast, the push and edit-preset
      dialogs.

## Order

1. Active preset in eqcaps, dev tarball. Done.
2. Active preset in uniPEQ. Done; to try on the DS3.
3. Button rule and fixes. Done; to look at on a device.
4. Controls plumbing and UI. ← next
5. The UAC reconnect path.

Before a commit, `package.json` goes from the `file:` tarballs back to an npm version (eqcaps
released), as AGENTS.md says.
