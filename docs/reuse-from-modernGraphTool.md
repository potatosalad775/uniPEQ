# Reuse from modernGraphTool

Survey of what the rebuild ([rebuild-plan.md](rebuild-plan.md)) can take from modernGraphTool
(`../modernGraphTool`, SvelteKit 2 + Svelte 5 + Tailwind 4 + bits-ui, eqcaps `^0.2.3`).
Surveyed at commit `20acc565` (2026-10-06). Paths below are relative to its `src/lib/`.

modernGraphTool's **Hardware EQ** feature already runs on the eqcaps bridge. Its `device-peq/`
module covers most of what the rebuild plan's data, connection and push-path phases describe.

## Strategy

- **Copy and adapt. Don't share a package yet.** Each copied file starts with a comment giving the
  source path and commit. Both copies are still changing. Once they settle, decide whether to
  extract a shared package or move `device-peq/` into eqcaps.
- **Keep their invariants.** The `device-peq/AGENTS.md` invariants (listed below) came out of bugs
  they actually hit. Port the rules along with the code.
- **Read their AGENTS.md before copying.** That means `src/lib/{components,graph,device-peq}/AGENTS.md`
  and the root `AGENTS.md`. They record test traps that apply to us too.

## Filter model mismatch (decide before copying)

| | modernGraphTool `EQFilter` (`utils/equalizer.ts`) | uniPEQ (rebuild decision 5) |
|---|---|---|
| Types | `PK` `LSQ` `HSQ` only, mapped to eqcaps codes by `toCapsType` / `fromCapsType` | all eqcaps codes `PK LSC HSC LPQ HPQ BP NO AP` |
| Fields | `freq` / `q` / `gain` nullable (an empty input box) | plain numbers |
| Channels | optional `channel: 'L' \| 'R'` | none; the bridge doesn't send per-channel bands |
| Response math | `Equalizer` class: peaking and shelves only | `src/lib/eq/biquad.ts` (ported from the prototype) already covers LP/HP/BP/notch/AP |

**Recommendation:** keep decision 5 (eqcaps codes in the app model), drop `channel`, and keep our
`biquad.ts` for the response curve. Every copied file that touches `EQFilter` then needs a
mechanical edit: `toCapsType` and `fromCapsType` become identities, and type pickers list all codes
the slot allows. The nullable fields are a UI decision. Take them only if we copy `EqFilterCard`'s
"empty while typing" behavior.

## A. Logic: take nearly as-is

| File | Lines | What it gives us | Adaptation |
|---|---:|---|---|
| `device-peq/connect.ts` | 306 | chooser → `matchDevice` → protocol + profile → `openDevice`; `guessProtocol` with a codec-derived profile; `kind: 'choose'` for ties; `warmUp()` | Swap the eqcaps-client import for ours. Add a native-transport branch for Android. Replaces the planned `DeviceManager` rewrite. |
| `device-peq/push-plan.ts` | 150 | `fit` + `complete` before every write; `needsConfirmation`; empty slots filled from the target preset's own bands (`readLayout` hints) | Filter model edit. Replaces our `eqStore.pushToDevice` logic. |
| `device-peq/preset.ts` | 41 | which preset a read/write can reach, or none | none |
| `device-peq/types.ts` | 86 | `PeqDevice` (a `BridgeDevice` satisfies it), `DeviceConnection` | none |
| `device-peq/errors.ts` | 46 | `BridgeError.code` → user-facing sentence | Paraglide `m.*` → our i18n |
| `device-peq/panel-status.ts` | 50 | the single status line, picked by priority | Paraglide → our i18n |
| `device-peq/network.ts` + `network-types.ts` | 272 | WiiM and Luxsin X9 over HTTP behind the same `PeqDevice` shape | Optional. Makes decision 6 (network dropped) cheap to reverse. Android still needs the cleartext network-security config. |
| `services/eqcaps-client.ts` | 51 | the one client instance | Replace its config reads with decision 3's settings. |
| `utils/eq-constraint.ts` | 452 | profile helpers: `slotOf`, `filterViolations`, `conformFilters`, `padToBandCount`, `graphicBandsOf`, `assignSlots` | Filter model edit. |
| `utils/eq-preamp.ts` | 29 | preamp = −(largest boost), read on a 1/48-octave grid **plus** each band's centre | Swap `Equalizer` for our `biquad.ts`. Replaces our pregain calc. |
| `utils/eq-apo.ts` | 159 | EqualizerAPO text parse/format (the same format as AutoEq `ParametricEQ.txt`) | Filter model edit. Replaces our AutoEq importer and adds export. |
| `utils/log-scale.ts` | 54 | log slider mapping; freq/gain/Q formatters | none |

## B. UI: adapt

| File | Lines | What it gives us | Adaptation |
|---|---:|---|---|
| `components/atoms/*` | ~460 | `Button` (variants, `tailwind-merge`), `Switch`, `Input`, `SegmentedControl`, `PopoverPanel`, `InfoPopover`, `Accordion`, `ScrollArea`, `Skeleton` on bits-ui | As-is. This is the base of our component set. Read `components/AGENTS.md` for the `Button` API (`title` → `aria-label`). |
| `../../defaults/theme.css` + `../routes/layout.css` | 75 + 271 | OKLCH semantic tokens (DaisyUI naming: `base-100..300`, `primary`, `accent`, …), light + dark, Tailwind 4 `@theme`, Pretendard | Take the token structure. Drop the operator-config and graph-only parts. Ship tokens in `src/` (we have no operator theming). Pick our own accent. |
| `components/equalizer/EqFilterCard.svelte` | 544 | per-band editor: eqcaps domain hints, locked fields, Escape reverts | Drop channel scope. Widen the type list. It reads the `eqStore` / `eqConstraintsStore` singletons; keep the same store names or pass props. |
| `components/equalizer/EqFilterList.svelte` | 428 | list, add/remove, preamp toast, import/export | Coupled to `frStore`, `eq-commands` and channel select. Rewrite lighter, reuse the layout. |
| `components/features/DevicePeq.svelte` | 671 | connect buttons, device row with fact popover, "Device EQ" dropdown (memories + Off), status line, auto-write | Closest match to our Main-tab connection area. It's a side-panel section, so split it across our screen layout. |
| `components/features/DevicePeqPushDialog.svelte` | 117 | confirm dialog listing what `fit` changed | Replaces `PresetDiffModal`. |
| `stores/device-peq-store.svelte.ts` | 199 | connection state; profile becomes the active constraint on connect | Replaces `deviceStore`. |
| `services/device-peq-service.svelte.ts` | 290 | read / write / Device EQ / auto-write, outliving the panel | Compare against our `AutoPushScheduler` (1.5 s debounce, coalescing, manual-save mode for `disconnectOnSave`). Keep whichever has the clearer push semantics and merge the other's features. |

## C. Reference only: re-implement slim

| File | Lines | Why not copy |
|---|---:|---|
| `graph/GraphEngine.svelte.ts` | 781 | Built around FR measurement data (`frStore`, baselines, normalization, sample sets). uniPEQ has no measurement curve; the graph is the EQ response itself. |
| `graph/GraphEqOverlay.ts` | 691 | Nodes sit on the EQ-modified **FR** curve. Reuse the ideas: d3-drag click-vs-drag threshold (3 px), drag throttling, node radius from Q, keyboard handling outside widget roles, click-empty-area adds a band. |
| `graph/GraphHandle.ts`, `components/graph/GraphContainer.svelte` | 137 + 492 | Same coupling (`graphStore`, `menuStore`, overlays we don't have). |
| `stores/eq-history-store.svelte.ts`, `services/eq-commands.ts`, `command-history.svelte.ts` | 204 + 471 + 75 | A/B snapshot compare and a command pattern over `frStore`. Our `UndoRedoStack` (snapshot before mutation, drag coalescing) is enough. |

Plan for a slim `EqGraph` (one SVG, log x 20 Hz–20 kHz, linear dB y, response from `biquad.ts`,
one node per band). Their gestures are desktop-only (scroll = Q, double-click = remove). Phones need
a touch path: tap selects a band, the band editor sheet adjusts Q, and maybe pinch for Q.

## D. Not applicable

AutoEQ (`workers/`, turboEQ wasm), FR parsing / smoothing / normalization / averaging, squig.link
and cross-site search, phone selector, target customizer, preference bounds, audio player and
spectrum, share URLs, CrinGraph `phone_book.json` compatibility, operator `config.js`.

## Invariants to carry over (from `device-peq/AGENTS.md`)

1. **Every write is `fit` + `complete`d first, and what `fit` changed is shown before writing.**
   The bridge never clamps or pads. No silent rewrite anywhere on the push path.
2. **A push writes the layout on screen.** A disabled band goes out as 0 dB at its own Fc and Q.
   Slots still empty take the target preset's own bands, flat (needs eqcaps ≥ 0.2.2).
3. **Connecting never edits the filters.** The profile only flags what doesn't fit; the user
   folds it in with an explicit **Fit**.
4. **Device EQ is what the device plays.** With ≥ 2 memories it's one dropdown (memories + Off);
   picking an entry switches the device at once (`setEnabled`). With one or none it's an on/off
   switch. The bypass preset is the Off entry, not a memory.
5. **Read and write only the preset you can reach.** Protocols without `readsSlot` / `writesSlot`
   act on whatever the device is on, so the button is disabled unless that's the target.
   ⚠ This **conflicts** with uniPEQ's current `eqStore.pushToDevice`, which silently retargets to
   the first writable slot (see CLAUDE.md). The rebuild follows modernGraphTool's rule.
6. **One status line**, chosen by priority (failure › auto-write paused › unreachable preset ›
   clip risk › sync). Fixed facts about the profile (shared, guessed, draft, experimental,
   write-only) go in the device row's popover.
7. **The chooser needs the click's user activation.** `warmUp()` on hover/focus starts the index
   load. A click waits at most `INDEX_WAIT_MS` before opening the chooser with guessable vendors
   only.

## Test traps worth knowing up front

- Feature detection uses `'hid' in navigator`, so a test that hides a transport must delete it
  from `Navigator.prototype`.
- Vitest browser mode needs `optimizeDeps.exclude: ['bits-ui']`, or bits-ui gets its own Svelte
  runtime copy and context breaks.
- d3-drag v3 binds `mousedown` and listens on `event.view`. Synthetic pointer events start drags
  that never move.
- Browser-mode's default viewport (414×896) is a phone. Pin the viewport per spec when layout
  matters.
- Pin the UI language in the test setup, or a non-English host locale breaks every string query.
