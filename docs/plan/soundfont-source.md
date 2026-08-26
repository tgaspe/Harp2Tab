# Soundfont source, licence and provenance

*Task 1 of [Phase 11-6](phase-11-6-sampled-instruments.md). Recorded 2026-08-26.*

This closes the blocker at [`README.md:223`](README.md) — *"which soundfont (they carry real
and differing licences), and bundled vs. fetched on demand."*

---

> **Superseded in part, 2026-08-26.** The conversion pipeline this document describes is
> gone. The app now loads this `.sf3` **directly** into a `spessasynth_lib` AudioWorklet
> synthesizer, the way [Signal](https://github.com/ryohey/signal) does, and plays it by
> sending MIDI events rather than by building audio nodes per note. See the "Why the
> converter was removed" section at the end. Everything below about *which* soundfont, its
> checksum and its licence still stands and still governs what ships.

## The pinned source

| | |
|---|---|
| **Soundfont** | MuseScore General |
| **Version** | `0.2.0` (the mirror's `VERSION` file; the readme inside calls it "0.2, 13th May 2020") |
| **File** | `MuseScore_General.sf3` |
| **URL** | `ftp://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3` |
| **Size** | 39,900,972 bytes |
| **Mirror date** | 2020-07-10 |
| **SHA-256** | `5b85b6c2c61d10b2b91cddd41efcce7b25cd31c8271d511c73afafbef20b6fa3` |

**The file is committed**, at `public/soundfonts/MuseScore_General-0.2.0.sf3` — the version
is in the filename so it can be served `immutable`. Re-download from the URL above and check
the SHA-256 before replacing it; the mirror path has no version in it, so the checksum is the
only thing actually pinning this.

The `.sf2` beside it is 215,614,036 bytes for the same content. That 5.4× ratio is the
Vorbis compression, and it is the reason this phase takes the `.sf3`.

## Licence: MIT, with a named-attribution clause

Read from `MuseScore_General_License.md` in the pinned release, not from a summary page.
The licence is MIT. It also carries a requirement that is stronger than bare MIT and is
easy to miss:

> The acknowledgements and copyright notices above must be included in any derivative work.

So the following must appear wherever the generated assets are shipped — they are not
optional and they are not collapsible into "MuseScore General, MIT":

- FluidR3 (original version) by **Frank Wen**, Copyright © 2000–02, 2008
- Mono conversion (FluidR3Mono) by **Michael Cowgill**, Copyright © 2014–17
- Adaptation for MuseScore_General.sf2 by **S. Christian Collins**, Copyright © 2018–19
- Temple Blocks instrument provided by **Ethan Winer**, Copyright © 2002
- Drumline Cymbals provided by **Michael Schorsch**, Copyright © 2016

Three places carry it:

1. `public/soundfonts/musescore-general-0.2.0/LICENSE.txt` — the full text of
   `MuseScore_General_License.md`, verbatim.
2. Every generated `manifest.json`, via `source.license` (Task 2's `InstrumentManifest`).
3. The app's About/Legal screen.

## The prebuilt-set evaluation (Task 1, Step 3)

Timeboxed as the plan asks, so that writing a converter is a decision on the record rather
than a default.

| Candidate | Licence | 128 programs | GM drum kit | Verdict |
|---|---|---|---|---|
| [`gleitz/midi-js-soundfonts`](https://github.com/gleitz/midi-js-soundfonts) (FluidR3_GM) | MIT | Yes | **No** | Rejected |
| [`danigb/smplr`](https://github.com/danigb/smplr) | **None declared** | Via the same gleitz assets | **No** (TR-808-style machines, not a GM kit) | Rejected |

**`gleitz/midi-js-soundfonts`** is the closest fit and would have deleted the largest task in
the phase. It fails on the drum kit: its 641 entries are the 128 melodic programs in ogg and
mp3, and the only "drum" names in it are the melodic GM programs — `steel_drums` (114),
`synth_drum` (118), `taiko_drum` (116). There is no percussion-bank kit, which is the
long-standing MIDI.js gap. It also carries no zone metadata at all — no loop points, no
`initialFilterFc`, no key ranges — so sustained instruments could not loop and the filter
decision in the plan could not be honoured.

**`smplr`** is a runtime library rather than an asset set, so adopting it would mean
replacing the scheduler rather than the voice — far outside this phase. Its General MIDI
support resolves to the same gleitz assets, and its drum offering is classic drum machines
(TR-808 and similar), not a GM percussion map. GitHub detects no licence on the repository.

**Decision: build the converter** (Tasks 3 and 6). Neither candidate meets the "all 128
programs *and* a drum kit" rule, and both would have forced dropping loop points and the
low-pass filter.

## Structure of the pinned file, verified

Checked against the downloaded bytes before any converter was written, because every one of
these is an assumption the plan's design rests on.

```
RIFF sfbk
  LIST INFO  416 bytes
  LIST sdta  39,720,044 bytes → smpl (39,720,032)
  LIST pdta  180,476 bytes → phdr pbag pmod pgen inst ibag imod igen shdr
```

- **`smpl` holds Ogg Vorbis streams.** The first sample's bytes begin `OggS`. This is what
  makes extraction a byte-range slice and not a transcode — the plan's "repackage, never
  re-encode" decision is confirmed against the file rather than assumed from the extension.
- **`shdr.start`/`end` are byte offsets into `smpl`, not frame indices.** The first sample
  spans 11,524 bytes, which is far too small to be PCM frames for its length.
- **`dwStartloop`/`dwEndloop` are frames of *decoded* audio.** The same sample loops 8→24,343
  while occupying 11,524 compressed bytes. This is the detail that makes
  `loopSecondsFor` divide by the zone's own `sampleRate` rather than by the decoded buffer's
  rate — the two units are not interchangeable and the error is silent.
- **1,246 sample headers.**
- **Velocity layers are pervasive.** The first three headers are `Temple Block 5-mp`,
  `-mf` and `-f` — the same drum at three velocities. The plan's "keep the layer covering
  velocity 64" rule is therefore a real reduction, not a theoretical one, and the layers it
  drops must be listed in the build report.

## Hosting decision

Answering the second half of the `README.md:224` blocker.

**Bundled, versioned, same-origin.** Assets live at
`public/soundfonts/musescore-general-0.2.0/`, are copied into `dist/` on export, and are
served by Firebase Hosting from the app's own origin under
`Cache-Control: public, max-age=31536000, immutable`. The version sits in the directory name,
so a future rebuild writes a new directory rather than overwriting one — a deploy can never
pair new manifests with cached old samples.

Not a CDN, which means there is no CSP question to answer. The `/models/**` rule already in
`firebase.json` is the same pattern; `public/models` is 900K and committed today.

The generated assets are committed. The 38 MB source `.sf3` is not — the checksum above is
what pins it. Task 6, Step 6 sets the size rule for the generated set against a measured
number, with a curated-subset fallback that needs no runtime change.


## Why the converter was removed (2026-08-26)

The first implementation converted this file offline into per-program manifests and Ogg
samples, and built an `AudioBufferSourceNode` per note at playback. It worked, and then hit
three walls that were all properties of hand-rolling a synthesizer rather than bugs that
could be fixed:

- **Node count.** One dense track — 3,840 notes, chords eight deep — cost **19,200 audio
  nodes**, committed to the graph in a single synchronous pass. Nothing threw; the audio
  thread simply gave up partway through the song.
- **Fidelity.** SF2 voices are shaped by filter *envelopes*, LFOs, velocity layers and
  modulators. Reproducing a static slice of that meant a judgement call about which filters
  to keep (this file sets one 300 Hz cutoff across the grand piano's entire range, expecting
  an envelope to open it) and dropping every velocity layer but one.
- **Loop points.** They had to be reconstructed from `shdr` by hand against a
  Vorbis-compressed sample body, and getting the units wrong made every held note retrigger
  its own attack.

A real synthesizer solves all three by construction. `spessasynth_lib`'s `WorkletSynthesizer`
reads this `.sf3` as-is and renders it in **one AudioWorklet node**, whatever the song. What
went with the converter: `scripts/build-soundfont.ts`, `src/audio/soundfont/`,
`scripts/verify-soundfont.ts`, and the ~39 MB of generated packages under
`public/soundfonts/musescore-general-0.2.0/`. Roughly a wash on bytes — the 38 MB source
replaces them — but it loads once for the session instead of per project, so time-to-first-
sound is worse and every note after that is better.

### Refreshing the worklet processor

`public/spessasynth_processor.min.js` is copied verbatim out of
`node_modules/spessasynth_lib/dist/`. It is served by URL rather than loaded through
`new URL(..., import.meta.url)` as spessasynth's own docs show, because **Metro does not
implement `import.meta.url`** and silently produces a path the browser cannot fetch. Re-copy
it whenever `spessasynth_lib` is upgraded:

```bash
cp node_modules/spessasynth_lib/dist/spessasynth_processor.min.js public/
```
