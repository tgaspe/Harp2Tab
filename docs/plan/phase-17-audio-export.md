# Phase 17 — Audio export (WAV / MP3 / OGG)

*Part of the [Harp2Tab implementation plan](README.md).*

The Edit screen and the MIDI Studio both export *notation* — five text formats through
`generateForFormat`, plus the Studio's raw SMF download. Neither can hand the user something
they can play outside the app. This phase adds rendered audio to both, through one shared
web-only pipeline:

```
Tab editor / MIDI Studio
        ↓  (existing generators)
standard MIDI bytes
        ↓  SpessaSynth offline SoundFont render
stereo AudioBuffer
        ↓  WAV writer / MP3 / OGG WASM encoder
Blob → browser download
```

The point of routing through SoundFont rather than a fresh renderer is that exported audio
sounds like *playback already sounds* — real instruments, percussion, velocity layers,
filter envelopes — instead of the oscillator fallback. Phase 11-6's soundfont is already
bundled and already loaded on web; this phase reuses it, offline.

**Web-only.** Native gets nothing new here and loses nothing it has (see 17-8).

---

## Status — implemented 2026-08-28, browser checks outstanding

Steps 1–7 of the delivery sequence are built and green: `npx tsx scripts/verify-audio-export.ts`
is 19/19, and `verify-export.ts` (42), `verify-midi-studio.ts` (81) and `verify-playback.ts`
(17) are unchanged. Lint is net one warning *below* the pre-existing baseline and adds no
errors. `npx expo export --platform web` succeeds and ships the worklet, the soundfont and all
three encoder assets.

**What is not yet verified is everything that needs a real audio thread** — the offline
SoundFont render has never been run, because Node has no `OfflineAudioContext`. Nothing below
the "Browser-only" heading in 17-9 has been done. Until it has, treat WAV/MP3/OGG on both
screens as written but unproven; the encoders themselves are proven (a synthetic sine
round-trips through both, asserted in the harness via the vendored binaries).

**Deviations from the plan as written, all recorded in place below:**

- **`ExportMenuSurface` became `ExportFormatSections`** and shares the format *list* only,
  not the popup chrome. The editor has an anchored-dropdown and a centered-modal variant and
  the export screen is a full page; those three wrappers have nothing in common but the list,
  and flattening them into one component with three layout modes would have been a worse
  component than the duplication it removed. Wrapping styles arrive as props.
- **The Studio's popup is its own component** (`ExportProjectModal.tsx`) rather than a second
  caller of the editor's dropdown, for the same reason.
- **The encoder vendoring got stricter** — see settled decision 6, which now records a
  measured 785KB bundle regression that the planned approach would have shipped.
- **Studio Export is offered on every platform, MIDI-only off web.** The plan already
  corrected the draft's "make the whole popup web-only"; in code this falls out of
  `projectExportSections()` filtering the Audio section rather than any screen-level gate.

---

## 17-0 — Verified against the installed code, 2026-08-28

This phase was drafted against the docs and then checked against what is actually in
`node_modules` and `src/`. Recording what was confirmed, because three of these are load-
bearing and one of them contradicts the obvious implementation.

**Confirmed available in `spessasynth_lib@4.3.14` (the pinned version):**

- `WorkletSynthesizer.startOfflineRender(config)` — `dist/index.d.ts:913`.
- The constructor takes `BaseAudioContext`, not `AudioContext` (`dist/index.d.ts:904`), so an
  `OfflineAudioContext` is a legal argument. This is the whole phase's foundation.
- `audioBufferToWav(buffer, options?): Blob` is exported (`dist/index.d.ts:1194`).
- `BasicMIDI.duration` is a number of seconds (`spessasynth_core/dist/index.d.ts:4054`) — that
  is where the offline render's length comes from. **Runtime-checked, not just read off the
  type**: `writeSmf` → `BasicMIDI.fromArrayBuffer` on four 400ms notes at 500ms intervals
  reports `duration === 1.9`, so the field is populated at parse time and does not need a
  sequencer to be attached first.
- The "call `startOfflineRender` immediately, Chromium ignores worklet messages for
  `OfflineAudioContext`" constraint is the library's own JSDoc (`dist/index.d.ts:908-911`), not
  community folklore. It is a real ordering constraint and 17-3 is built around it.

**The one that contradicts the obvious implementation:** the soundbank does **not** go in
through `soundBankManager.addSoundBank()` the way `SoundFontSynth.web.ts:56` does it for live
playback. It rides inside the `startOfflineRender` config as
`soundBankList: { bankOffset, soundBankBuffer }[]` (`dist/index.d.ts:338-341`) — which is what
makes "do not call any other method first" satisfiable at all.

**And the trap that follows from it:** `startOfflineRender` posts the config with the
soundbank buffers as **transferables** —

```js
// node_modules/spessasynth_lib/dist/index.js:976
this.post({ type: "startOfflineRender", data: config, channelNumber: -1 },
          config.soundBankList.map((b) => b.soundBankBuffer));
```

so the `ArrayBuffer` is **detached** once the render starts. A module-level cache holding the
fetched `ArrayBuffer` would work for the first export and hand the second one a zero-length
detached buffer. The cache must hold `Uint8Array` bytes and mint a fresh copy per render
(17-3). This is a 40 MB `slice()` per export; it is the price of the API and it is paid once
per export, not per note.

**Assets are already where this phase needs them** — `public/spessasynth_processor.min.js` and
`public/soundfonts/MuseScore_General-0.2.0.sf3` (39.9 MB), fetched by those exact URLs at
`SoundFontSynth.web.ts:28-29`, with the standing note there that Metro does not implement
`import.meta.url` so the worklet must be loaded by plain URL. Expo copies `public/` into the
static export; `/assets` is reserved and is not used here.

**`wasm-media-encoders`** is real, MIT, and bundles focused LAME + libvorbis builds rather than
a full FFmpeg runtime. It is also **last published 2024-05-24 and still 0.x**. That does not
disqualify it — LAME and libvorbis do not move — but it does change how it is adopted (17-4).

---

## Settled decisions

1. **The offline renderer is a fresh, throwaway synthesizer, never the live one.** Reusing the
   playback instance would interrupt playback and cannot satisfy the "nothing before
   `startOfflineRender`" rule, since the live synth has already had a soundbank added.
2. **Audio formats stay out of `ExportFormat`.** The existing union
   (`src/types/index.ts:9`) is consumed by `generateForFormat`, which returns text/base64
   content. WAV/MP3/OGG have no `content`/`encoding` and must not leak into that API.
3. **Export renders at the project's own tempo**, ignoring the transport's playback-rate
   setting, and excludes the metronome (which is a playback-only click and never enters the
   MIDI source, so this is free).
4. **Stereo, 44.1 kHz.** WAV 16-bit PCM; MP3 192 kbps CBR; OGG Vorbis quality 0.5; a 1.0 s tail
   past the last note-off so reverb and release are not clipped.
5. **The "unplayable on this harmonica" confirm sheet does not apply to audio.** That warning
   (`edit.tsx`'s `handleSave`, which counts `tabNotes.filter((n) => n.tab === '')`) exists
   because a tab file cannot represent a note with no hole. A rendered audio file can play any
   pitch, so the sheet is skipped for audio formats.
6. **The encoder is vendored under `public/encoders/` — glue included — and
   `wasm-media-encoders` is a devDependency that nothing imports.** The original draft treated
   vendoring as a fallback if a Metro spike failed; it is the starting position instead, and
   the build measurement below turned out to justify a stronger version of it than planned.

   **Measured, 2026-08-28.** Importing the package's ESM entry — even as a dynamic `import()`
   that only calls `createEncoder(mime, url)` — pulled **778,120 base64 characters (~760KB) of
   inlined WASM** into a bundle chunk. That single 783KB module also defines
   `createMp3Encoder`/`createOggEncoder`, whose inline binaries Metro does not tree-shake, so
   the codecs shipped twice: once as dead base64 in JavaScript, once as the real `.wasm` the
   code fetches. Total web JS was 9.42MB.

   **The fix is the UMD build**, which is the same library with the inlining stripped: 5.9KB
   of glue that fetches its binary from a URL you give it. It is copied to
   `public/encoders/WasmMediaEncoder.min.js` and loaded with a `<script>` tag, so no bundler
   participates at all — the same reasoning that already puts the spessasynth worklet and the
   soundfont in `public/`. After the change: **zero inlined-WASM chunks, total web JS
   8.64MB** (~785KB saved). `verify-audio-export.ts` asserts that no source file imports the
   package, because this regresses silently — dev builds behave identically either way.

   One more reason the explicit URLs matter: the UMD build's *default* is to fetch its
   binaries from unpkg.com. Passing our own paths keeps audio export free of any third-party
   network request.

7. **Export ignores mute and solo. Every track is rendered.** (Theo, 2026-08-28.) A muted
   track is silent in the room and present in the file, for audio exactly as it already is for
   the MIDI download — so no existing behaviour changes, and WAV, MP3, OGG and MIDI of the
   same project are all the same piece of music.

   The line this draws is **material versus monitoring**, and the code already draws it.
   `audibleProject`'s velocity and duration floors *do* apply to export, because those are
   edits to the material: a note below the floor is transcription noise the user has judged is
   not part of the piece. Mute and solo are a mixing desk — a temporary way of listening to
   what you are working on — and `projectToSmfBytes`'s own doc comment already says a
   downloaded file "carries the music, not the mixing desk". Phase 17 extends that sentence to
   audio rather than contradicting it.

   **Accepted trade-off:** there is no way to render a soloed track on its own. Someone who
   solos the melody and exports will get the full mix. If that turns out to be a common ask,
   the answer is an explicit *Export selected tracks only* checkbox in the popup — a
   deliberate export control — not a re-reading of the mixer buttons.

## Open

Nothing. The landing-page question below was settled during implementation.

**WAV/MP3/OGG appear on the landing page** (Theo, 2026-08-28). `LandingPage.web.tsx` renders
the "Export it anywhere" grid, and audio now appears in it alongside the five text formats.
Built as one flat list at the call site rather than by widening `EXPORT_FORMATS` — that
constant is typed to `ExportFormat` and feeds `generateForFormat`, which has no case that
could produce a WAV. The landing page is the only place that knows the two families belong
side by side, which is where that knowledge should sit.

---

## 17-1 — The format contract

Two things are needed and the original draft conflated them: a *shared option shape* so one
popup can render both families, and a *separate audio format union* so audio never reaches
`generateForFormat`.

**Create `src/export/audioFormats.ts`:**

```ts
export type AudioExportFormat = 'WAV' | 'MP3' | 'OGG';

/** What the offline renderer hands the encoders — deliberately not an AudioBuffer, so the
 *  encoders are pure functions that a Node harness can call. */
export interface RenderedAudio {
  left:       Float32Array;
  right:      Float32Array;
  sampleRate: number;
  durationSec: number;
}

export interface AudioExportResult {
  blob:     Blob;
  ext:      string;   // 'wav' | 'mp3' | 'ogg'
  mimeType: string;   // 'audio/wav' | 'audio/mpeg' | 'audio/ogg'
}

export const AUDIO_EXPORT_FORMATS: AudioExportFormat[] = ['WAV', 'MP3', 'OGG'];

export const AUDIO_FORMAT_META: Record<
  AudioExportFormat, { label: string; description: string; icon: string }
> = {
  WAV: { label: 'WAV', description: 'Uncompressed audio, largest file',        icon: 'pulse-outline' },
  MP3: { label: 'MP3', description: 'Compressed audio, plays everywhere',      icon: 'musical-note-outline' },
  OGG: { label: 'OGG', description: 'Compressed audio, open Vorbis format',    icon: 'disc-outline' },
};
```

**Generalise `ExportOption` (`src/components/ExportOption.tsx`).** It currently takes
`format: ExportFormat` and looks the row's text up in `EXPORT_FORMAT_META` itself
(`ExportOption.tsx:11-20`). Change it to take the already-resolved presentation, so one
component serves both families:

```ts
interface ExportOptionProps {
  id:          string;                    // was: format: ExportFormat
  label:       string;
  description: string;
  icon:        string;
  isSelected:  boolean;
  onSelect:    (id: string) => void;
  showDivider?: boolean;
}
```

Both call sites (`export.tsx:236-241` and `edit.tsx`'s `ExportMenu`) then map over their own
list and pass `...EXPORT_FORMAT_META[fmt]` or `...AUDIO_FORMAT_META[fmt]`. `EXPORT_FORMATS`,
`EXPORT_FORMAT_META` and `ExportFormat` are left exactly as they are — which is what keeps the
landing page unchanged.

**Deliverable:** the app builds and behaves identically; no audio anywhere yet.

---

## 17-2 — The MIDI source for each screen

Both screens must produce standard MIDI bytes, so the renderer has exactly one input type.

**Edit** — `src/export/audioSource.ts`:

Reuse `useAudibleNotes()` (already the source for every export path, so the velocity/duration
floors apply) and the existing MIDI generator via
`generateForFormat(singlePart(tabNotes, key, harmonicaType), 'MIDI')`, then base64-decode its
`content` to bytes with `base64ToBytes`. Going through `generateForFormat` rather than a second
note→MIDI path is the point: the audio a user exports is the MIDI file they could have
exported, rendered. Filename comes from `recordingTitle` through `exportFileName`.

**Studio** — in `studio.tsx`, alongside `handleDownloadMidi`:

`projectToSmfBytes(audibleProject(project))` — byte-for-byte the call `handleDownloadMidi`
already makes (`studio.tsx:484`), with no track filter, per settled decision 7. This
inherits per-track programs, the percussion channel, the tempo
map and the time-signature map for free, because they are all already in the SMF that
persistence round-trips through. Filename comes from `project.title` via the same sanitiser
`handleDownloadMidi` already uses.

**Deliverable:** a pure function per screen returning `Uint8Array`, harness-testable in Node
with no browser at all. This is the only part of the phase Node can fully test, which is why
17-9 leans on it.

---

## 17-3 — Offline SoundFont rendering

**Create `src/audio/export/renderMidiAudio.web.ts`**, with `renderMidiAudio.ts` as a native
stub that throws `new Error('Audio export is web-only')`.

The full sequence, in this order, because the order is the constraint:

```ts
import { WorkletSynthesizer } from 'spessasynth_lib';
import { BasicMIDI } from 'spessasynth_core';

const PROCESSOR_URL = '/spessasynth_processor.min.js';
const SOUNDFONT_URL = '/soundfonts/MuseScore_General-0.2.0.sf3';
const TAIL_SEC = 1.0;
const SAMPLE_RATE = 44100;

/** Bytes, not an ArrayBuffer. `startOfflineRender` transfers (and therefore detaches) every
 *  buffer in `soundBankList`, so the cache must be able to mint a fresh copy each time —
 *  see 17-0. */
let soundFontBytes: Uint8Array | null = null;

async function loadSoundFontBytes(): Promise<Uint8Array> {
  if (soundFontBytes) return soundFontBytes;
  const response = await fetch(SOUNDFONT_URL);
  if (!response.ok) throw new Error(`Soundfont fetch failed: ${response.status}`);
  soundFontBytes = new Uint8Array(await response.arrayBuffer());
  return soundFontBytes;
}

export async function renderMidiAudio(smf: Uint8Array): Promise<RenderedAudio> {
  const bytes = await loadSoundFontBytes();
  // `.slice()` copies; `.buffer` alone would hand the cache itself to be detached.
  const soundBankBuffer = bytes.slice().buffer;

  const midi = BasicMIDI.fromArrayBuffer(smf.slice().buffer as ArrayBuffer);
  const lengthSec = midi.duration + TAIL_SEC;
  const ctx = new OfflineAudioContext(2, Math.ceil(lengthSec * SAMPLE_RATE), SAMPLE_RATE);

  await ctx.audioWorklet.addModule(PROCESSOR_URL);
  const synth = new WorkletSynthesizer(ctx);
  try {
    synth.connect(ctx.destination);
    // Immediately after construction. No soundBankManager, no isReady, nothing —
    // Chromium drops worklet messages sent to an OfflineAudioContext before this.
    await synth.startOfflineRender({
      midiSequence:  midi,
      loopCount:     0,
      soundBankList: [{ bankOffset: 0, soundBankBuffer }],
    });
    const buffer = await ctx.startRendering();
    return {
      left:        buffer.getChannelData(0),
      right:       buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0),
      sampleRate:  buffer.sampleRate,
      durationSec: buffer.duration,
    };
  } finally {
    synth.destroy();
  }
}
```

**Leading silence must be asked for.** The sequencer's `skipToFirstNoteOn` defaults to
**true**, so the first version of this renderer dropped whatever silence came before the first
note. That default is right for a player and wrong for an export: the count-in before a take's
first note is part of its timing, and the tab/MIDI exports of the same take keep it. Worse, the
render length still comes from `midi.duration`, which *includes* the leading silence
(measured: a 3s lead-in on a 1.4s phrase reports `duration === 4.4`), so the skip did not
shorten the file — it moved the music to the front and left the silence trailing. Fixed by
passing `sequencerOptions: { skipToFirstNoteOn: false }`. Reported by Theo from the built
feature, 2026-08-28.

Three things the first draft of this phase left out and that are not optional:
`synth.connect(ctx.destination)`, `await ctx.startRendering()` (without it the returned promise
resolves and nothing has been rendered), and computing the context length up front from
`midi.duration` — an `OfflineAudioContext` is fixed-length at construction and cannot grow.

**Memory note.** A four-minute stereo 44.1 kHz render is ~42 MB of `Float32Array`, held
alongside a 40 MB soundbank copy *and* the live playback synth's own 40 MB copy. That is fine
on desktop and is the reason 17-6 refuses concurrent exports rather than queueing them.

---

## 17-4 — The encoders

**WAV — `src/export/encodeWav.ts`, hand-written, not `audioBufferToWav`.**

The library's `audioBufferToWav` takes an `AudioBuffer`, a type that does not exist in Node.
Using it would make every WAV assertion in 17-9 browser-only, for a function that is forty
lines of `DataView` writes. Writing it against `RenderedAudio` instead keeps WAV fully
testable in the existing `npx tsx` harness, and is why `RenderedAudio` carries raw
`Float32Array`s rather than an `AudioBuffer`.

```ts
export function encodeWav(audio: RenderedAudio): AudioExportResult;
// 44-byte RIFF/WAVE header, 16-bit PCM, interleaved L/R,
// samples clamped to [-1, 1] then scaled by 32767 — clamping, not normalising,
// so two exports of the same project are byte-identical.
```

**MP3 / OGG — `src/export/encodeCompressed.web.ts`.**

`wasm-media-encoders`, pinned exactly, with both `.wasm` artifacts copied into
`public/encoders/` at the pinned version and loaded by URL (per the settled decision above and
the same Metro reasoning already recorded at `SoundFontSynth.web.ts:25-27`). The encoder module
is behind a `await import(...)` inside the MP3/OGG branch only, so app startup and WAV export
never fetch a codec.

```ts
export async function encodeCompressed(
  audio: RenderedAudio, format: 'MP3' | 'OGG',
): Promise<AudioExportResult>;
// MP3 → 192 kbps CBR, 'audio/mpeg', 'mp3'
// OGG → vorbis quality 0.5, 'audio/ogg', 'ogg'
```

**`src/export/exportAudio.web.ts`** is the one entry point the UI calls: takes SMF bytes plus a
format, runs `renderMidiAudio` then the right encoder, returns `AudioExportResult`.

---

## 17-5 — Fix `triggerWebDownload` before any audio flows through it

`src/export/webDownload.ts:11-16` revokes the object URL **synchronously**, one statement after
`a.click()`:

```ts
a.click();
URL.revokeObjectURL(url);   // ← fine for a 3 KB CSV, not for a 40 MB WAV
```

Chrome tolerates this. Firefox and Safari can abort a large download when the URL is revoked
before the browser has finished reading the blob. Every existing export is a few kilobytes of
text, which is why this has never been seen.

Defer the revoke, and remove the node:

```ts
export function triggerWebDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Revoking synchronously can abort a multi-megabyte download in Firefox and Safari before
  // the blob has been read. The timeout is the standard workaround; the URL is scoped to this
  // document and dies with the tab regardless, so a missed timer leaks nothing lasting.
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 60_000);
}
```

This is shared code: the five text formats, the Studio's MIDI download and `profile.tsx`'s
export all route through it. The change is strictly more conservative for all of them.

---

## 17-6 — Progress and errors

Replace each popup's `isExporting` boolean with:

```ts
type ExportPhase = 'idle' | 'rendering' | 'encoding' | 'downloading' | 'error';
```

Button label follows the phase: *Rendering audio…* → *Encoding MP3…* → *Downloading…*. Rules:

- One export at a time — every entry point returns early unless the phase is `idle`.
- **Stop playback before rendering.** Both an export and playback want the soundfont and the
  audio thread, and the export holds ~80 MB while it runs.
- Failures surface in the popup, not just `console`. Distinguish three cases, because the user
  can act on the first two: *this browser can't do audio export* (no `OfflineAudioContext` or
  no `audioWorklet`), *the soundfont or encoder failed to load* (network / hosting), and
  *encoding failed*.
- Closing the popup before rendering starts cancels; once rendering starts it runs to
  completion. Real cancellation waits for a later pass — neither `startOfflineRender` nor the
  encoders expose safe termination.
- A percentage for the encode step is nice-to-have and only if the encoder reports honestly.
  Stage labels ship first.

---

## 17-7 — The shared popup

`ExportMenu` is a local component inside `edit.tsx` (`edit.tsx:1273`), and `export.tsx` is a
near-duplicate of its logic for native. Extract the presentation to
**`src/components/ExportMenuSurface.tsx`**, taking: section list (`{ title, options }[]`),
selected id, `onSelect`, `onDownload`, optional `onShare`, phase and status label.

- **Edit popup** — a *Tab & data* section (TXT, CSV, MIDI, MusicXML, JSON) and, on web, an
  *Audio* section (WAV, MP3, OGG).
- **Studio popup** — the `TopBar` header action changes from *Download MIDI* to *Export* and
  opens the same shell with MIDI, plus WAV/MP3/OGG on web. Save and Discard stay as their own
  Studio actions. Note that the Studio's Export lives in `useHeaderActionStore`, and Phase 15
  already records that this `TopBar` is `null` on native — so on native the Studio's export is
  unreachable today and this phase does not change that either way.
- **Selection state stays local to each popup.** Studio must not write the global
  `exportFormat` (`useAppStore`), or picking MP3 in the Studio would silently change what the
  Edit screen exports next time.

---

## 17-8 — Platform gating

- `renderMidiAudio.ts` / `encodeCompressed.ts` are native stubs that throw; the `.web.ts`
  variants carry the implementations. Metro's platform resolution keeps the WASM and the
  worklet out of the native bundle entirely.
- The *Audio* section renders only when `Platform.OS === 'web'`. Native's `export.tsx` keeps
  exactly its current five formats and its `FileSystem`/`Sharing` paths, untouched.
- **`studio.tsx` is not a web-only route.** It has no platform gate — only
  `Platform.OS === 'web'` styling details (`studio.tsx:538`, `:605`, `:804`). An earlier draft
  proposed making the Studio's whole export popup web-only "because the Studio is web-focused";
  that would have removed the MIDI download native Studio has today. MIDI stays on every
  platform; only the three audio formats are gated.
- No `expo-file-system` or `expo-sharing` work for audio — browser download only.

---

## 17-9 — Verification

Add `scripts/verify-audio-export.ts`, following the existing harness convention
(`npx tsx scripts/verify-audio-export.ts`, named cases, `PASS`/`FAIL` lines, non-zero exit).

**Node-testable (the harness proper).** Be honest about the boundary: Node has no
`OfflineAudioContext` and no `AudioWorklet`, so the harness covers the MIDI source and the WAV
encoder, and nothing that requires a render.

- `encodeWav` over a synthesised `RenderedAudio`: RIFF/WAVE magic, channel count 2, sample rate
  44100, byte length matches `duration × 44100 × 4 + 44`, PCM is non-silent, samples clamp
  rather than wrap at ±1.
- Determinism: encoding the same `RenderedAudio` twice is byte-identical.
- `exportFileName` sanitisation and the MIME/extension table.
- An empty arrangement is rejected before any render is attempted.
- Edit's source drops notes hidden by the velocity/duration floors.
- Studio's source is unaffected by mute and solo — a project with one track muted and another
  soloed produces the same bytes as the same project with both cleared (decision 7), while
  raising a velocity floor still removes notes.
- Program changes, the percussion channel, tempo changes and the time-signature map all
  survive `projectToSmfBytes` → `readSmf`.
- The existing `verify-export.ts` stays green — the 17-1 `ExportOption` change must not alter
  any generated file.

**Browser-only (a written manual checklist, not the harness).** MP3 and OGG magic bytes,
`OggS` + Vorbis identification, and every render assertion belong here, because they need a
real audio thread:

- WAV, MP3 and OGG export from Edit and from Studio in current Chrome, Firefox and Safari, and
  the resulting files decode and play in each.
- A long multi-track project completes and leaves playback working afterwards.
- Repeated exports in one session succeed — **this is the regression test for the detached
  soundbank buffer in 17-0**; exporting twice without reloading is the whole check.
- `npx expo export --platform web` output contains the worklet, the soundfont and both encoder
  `.wasm` files, and the exported site serves them.
- Static hydration touches no browser API during server rendering.

---

## Delivery sequence

Ordered so the two genuine risks — the offline render and the encoder loading — are answered
before any UI is built on top of them. (The original draft put the encoder spike fifth, after
four steps of UI work, while its own closing paragraph named it the largest risk.)

1. **Vendor the encoders and prove they load.** Pin `wasm-media-encoders`, copy both `.wasm`
   files into `public/encoders/`, encode a synthetic sine to MP3 and OGG from a scratch page,
   and confirm `npx expo export --platform web` ships them. Nothing else starts until this
   passes.
2. **Fix `triggerWebDownload`** (17-5) and re-run `verify-export.ts`. Small, shared, and wanted
   regardless of the rest of the phase.
3. **`renderMidiAudio.web.ts`** (17-3) driven from a scratch button — SMF in, `RenderedAudio`
   out, verified by exporting the same project twice in one page load.
4. **`encodeWav` + the harness** (17-4, 17-9). First real deliverable: WAV export from Edit.
5. **Studio's MIDI source + WAV export** (17-2). Nothing blocks this any more — decision 7
   means the Studio's audio source is the exact call `handleDownloadMidi` already makes.
6. **Generalise `ExportOption` and extract `ExportMenuSurface`** (17-1, 17-7), moving both
   screens onto it with no behaviour change beyond the new Audio section.
7. **MP3, then OGG** (17-4), each one popup entry over the already-proven encoder module.
8. **Phase/error UI** (17-6), then lint, `verify-export.ts`, `verify-midi-studio.ts`,
   `verify-playback.ts`, the new `verify-audio-export.ts`, and the browser checklist.
