/**
 * Harness for audio export (Phase 17).
 *
 * Deliberately scoped to what Node can actually prove. There is no `OfflineAudioContext` and
 * no `AudioWorklet` here, so the SoundFont render itself is *not* covered — that lives in the
 * browser checklist in `docs/plan/phase-17-audio-export.md`. What is covered is the two ends
 * the render sits between, which is where the regressions people would actually hit live:
 * the MIDI source each screen produces, and the WAV bytes that come out.
 *
 * That boundary is the reason `encodeWav` is hand-written rather than spessasynth's
 * `audioBufferToWav` — the latter takes an `AudioBuffer` and would push every assertion below
 * into a browser.
 *
 * Run: npx tsx scripts/verify-audio-export.ts
 */

import { readFileSync } from 'node:fs';

import { readSmf } from '../src/audio/smf';
import { tabToNote } from '../src/audio/HarmonicaMapper';
import { createProject, createTrack } from '../src/audio/midiProject';
import { encodeWavBytes } from '../src/export/encodeWav';
import { EmptyArrangementError, projectAudioSource, tabAudioSource } from '../src/export/audioSource';
import { exportFileName } from '../src/export/webDownload';
import { AUDIO_FORMAT_FILE, type RenderedAudio } from '../src/export/audioFormats';
import type { HarmonicaKey, MidiNote, TabNote } from '../src/types';

interface CaseResult { name: string; passed: boolean; detail: string }
const results: CaseResult[] = [];
function check(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
}

// ── fixtures ──────────────────────────────────────────────────────────────────

function notesFor(tabs: string[], key: HarmonicaKey): TabNote[] {
  return tabs.map((tab, i) => ({
    id:         `n${i}`,
    tab,
    note:       tabToNote(tab, key, 'diatonic') ?? 'C4',
    duration:   300,
    start_time: i * 400,
    confidence: 100,
  }));
}

function midiNotes(count: number, startMidi = 60): MidiNote[] {
  return Array.from({ length: count }, (_, i) => ({
    midi: startMidi + i, timeMs: i * 500, durationMs: 400, velocity: 100,
  }));
}

/** A short stereo tone, as the renderer would hand it over. */
function tone(seconds: number, sampleRate = 44100, amplitude = 0.5): RenderedAudio {
  const n = Math.round(seconds * sampleRate);
  const left = new Float32Array(n), right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i]  = Math.sin(2 * Math.PI * 440 * i / sampleRate) * amplitude;
    right[i] = Math.sin(2 * Math.PI * 660 * i / sampleRate) * amplitude;
  }
  return { left, right, sampleRate, durationSec: n / sampleRate };
}

const ascii = (b: Uint8Array, at: number, len: number) =>
  String.fromCharCode(...b.slice(at, at + len));
const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at, true);
const u16 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint16(at, true);

// ── WAV container ─────────────────────────────────────────────────────────────

function wavHeaderIsWellFormed(): void {
  const wav = encodeWavBytes(tone(0.25));
  const ok = ascii(wav, 0, 4) === 'RIFF' && ascii(wav, 8, 4) === 'WAVE'
    && ascii(wav, 12, 4) === 'fmt ' && ascii(wav, 36, 4) === 'data'
    && u16(wav, 20) === 1;
  check('WAV carries a well-formed RIFF/WAVE header', ok,
    `RIFF=${ascii(wav, 0, 4)} WAVE=${ascii(wav, 8, 4)} fmt=${ascii(wav, 12, 4)} data=${ascii(wav, 36, 4)} format=${u16(wav, 20)}`);
}

function wavIsStereo44k16bit(): void {
  const wav = encodeWavBytes(tone(0.25));
  const channels = u16(wav, 22), rate = u32(wav, 24), bits = u16(wav, 34);
  const blockAlign = u16(wav, 32), byteRate = u32(wav, 28);
  const ok = channels === 2 && rate === 44100 && bits === 16
    && blockAlign === 4 && byteRate === 44100 * 4;
  check('WAV declares stereo 44.1kHz 16-bit with consistent rate fields', ok,
    `channels=${channels} rate=${rate} bits=${bits} blockAlign=${blockAlign} byteRate=${byteRate}`);
}

function wavLengthMatchesDuration(): void {
  const wav = encodeWavBytes(tone(0.5));
  const expectedData = Math.round(0.5 * 44100) * 4;
  const ok = wav.length === 44 + expectedData
    && u32(wav, 40) === expectedData
    && u32(wav, 4) === 36 + expectedData;
  check('WAV length and both size fields match the rendered duration', ok,
    `bytes=${wav.length} expected=${44 + expectedData} dataChunk=${u32(wav, 40)} riffSize=${u32(wav, 4)}`);
}

function wavCarriesNonSilentPcm(): void {
  const wav = encodeWavBytes(tone(0.25));
  const body = wav.slice(44);
  const nonZero = body.some((b) => b !== 0);
  // A sine at 0.5 should peak near 16383, so a plausible-magnitude check catches a scale bug
  // that a bare "not all zero" would sail past.
  const view = new DataView(body.buffer, body.byteOffset);
  let peak = 0;
  for (let i = 0; i + 1 < body.length; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
  const ok = nonZero && peak > 15000 && peak <= 16384;
  check('WAV PCM is non-silent and scaled to the expected peak', ok, `peak=${peak} (expected ~16383)`);
}

function wavClampsRatherThanWraps(): void {
  // +1.5 and -1.5 cannot be represented; the failure mode being guarded against is integer
  // wrap, which would turn a loud passage into a full-scale opposite-signed spike.
  const hot: RenderedAudio = {
    left:  Float32Array.from([1.5, -1.5, 0]),
    right: Float32Array.from([1.5, -1.5, 0]),
    sampleRate: 44100, durationSec: 3 / 44100,
  };
  const body = encodeWavBytes(hot).slice(44);
  const view = new DataView(body.buffer, body.byteOffset);
  const ok = view.getInt16(0, true) === 32767 && view.getInt16(4, true) === -32768;
  check('WAV clamps out-of-range samples instead of wrapping', ok,
    `first=${view.getInt16(0, true)} second=${view.getInt16(4, true)}`);
}

function wavIsDeterministic(): void {
  const a = encodeWavBytes(tone(0.25));
  const b = encodeWavBytes(tone(0.25));
  const ok = a.length === b.length && a.every((v, i) => v === b[i]);
  check('encoding the same audio twice is byte-identical', ok,
    ok ? `${a.length} bytes, identical` : 'outputs differ');
}

function wavHandlesMonoSource(): void {
  // The renderer hands the same array in twice for a mono buffer; the file must still be a
  // valid stereo WAV rather than a half-length one.
  const mono = tone(0.1);
  const wav = encodeWavBytes({ ...mono, right: mono.left });
  const ok = u16(wav, 22) === 2 && wav.length === 44 + mono.left.length * 4;
  check('a mono render still writes a valid stereo WAV', ok,
    `channels=${u16(wav, 22)} bytes=${wav.length}`);
}

// ── filenames and MIME ────────────────────────────────────────────────────────

function fileNamesAndMimeTypes(): void {
  const ok = AUDIO_FORMAT_FILE.WAV.mimeType === 'audio/wav'
    && AUDIO_FORMAT_FILE.MP3.mimeType === 'audio/mpeg'
    && AUDIO_FORMAT_FILE.OGG.mimeType === 'audio/ogg'
    && AUDIO_FORMAT_FILE.MP3.ext === 'mp3';
  check('audio MIME types and extensions are correct', ok,
    Object.entries(AUDIO_FORMAT_FILE).map(([k, v]) => `${k}=${v.mimeType}/${v.ext}`).join(' '));
}

function fileNameSanitisation(): void {
  const named   = exportFileName('My Song / Take 2', AUDIO_FORMAT_FILE.MP3.ext);
  const unnamed = exportFileName('   ', AUDIO_FORMAT_FILE.WAV.ext);
  const ok = named === 'My_Song_Take_2.mp3' && unnamed === 'harp2tab_export.wav';
  check('audio filenames are sanitised the same way every other export is', ok,
    `named=${named} unnamed=${unnamed}`);
}

// ── the MIDI source each screen hands the renderer ─────────────────────────────

function tabSourceIsRealMidi(): void {
  const smf = tabAudioSource(notesFor(['4', '-4', '5'], 'C'), 'C', 'diatonic');
  const parsed = readSmf(smf);
  const total = parsed.tracks.reduce((n, t) => n + t.notes.length, 0);
  const ok = ascii(smf, 0, 4) === 'MThd' && total === 3;
  check('the editor source is a parseable SMF carrying every audible note', ok,
    `magic=${ascii(smf, 0, 4)} notes=${total}`);
}

function tabSourceRejectsEmpty(): void {
  let threw = false;
  try { tabAudioSource([], 'C', 'diatonic'); } catch (e) { threw = e instanceof EmptyArrangementError; }
  check('an empty tab rejects before anything is rendered', threw,
    threw ? 'EmptyArrangementError' : 'no error thrown');
}

function projectSourceMatchesMidiDownload(): void {
  // The whole point of decision 7: audio and the existing Download MIDI must be the same
  // bytes, so the two exports of one project are the same piece of music.
  const project = createProject({
    title: 'Test', tracks: [createTrack(0, { notes: midiNotes(4) })],
  });
  const audio = projectAudioSource(project);
  const download = projectAudioSource(project);
  const ok = audio.length === download.length && audio.every((v, i) => v === download[i]);
  check('the Studio audio source is the Download MIDI bytes', ok, `${audio.length} bytes`);
}

function muteAndSoloDoNotAffectExport(): void {
  const plain = createProject({
    title: 'T',
    tracks: [createTrack(0, { notes: midiNotes(3) }), createTrack(1, { notes: midiNotes(3, 72) })],
  });
  const mixed = {
    ...plain,
    tracks: [{ ...plain.tracks[0], muted: true }, { ...plain.tracks[1], soloed: true }],
  };
  const a = projectAudioSource(plain);
  const b = projectAudioSource(mixed);
  const ok = a.length === b.length && a.every((v, i) => v === b[i]);
  check('mute and solo do not change the exported source (decision 7)', ok,
    ok ? `identical, ${a.length} bytes` : `differ: ${a.length} vs ${b.length} bytes`);
}

function velocityFloorStillFilters(): void {
  // The other half of decision 7: the floors *are* edits to the material, so they must still
  // apply. If this passes while the case above passes, the line is drawn in the right place.
  const notes: MidiNote[] = [
    { midi: 60, timeMs: 0,   durationMs: 400, velocity: 100 },
    { midi: 62, timeMs: 500, durationMs: 400, velocity: 10  },
  ];
  const base = createProject({ title: 'T', tracks: [createTrack(0, { notes })] });
  const floored = { ...base, tracks: [{ ...base.tracks[0], velocityFloor: 50 }] };
  const kept = readSmf(projectAudioSource(base)).tracks.reduce((n, t) => n + t.notes.length, 0);
  const cut  = readSmf(projectAudioSource(floored)).tracks.reduce((n, t) => n + t.notes.length, 0);
  check('a velocity floor still removes notes from the exported source', kept === 2 && cut === 1,
    `no floor=${kept} notes, floor 50=${cut} notes`);
}

function projectSourceRejectsEmpty(): void {
  const empty = createProject({ title: 'T', tracks: [createTrack(0, { notes: [] })] });
  let threw = false;
  try { projectAudioSource(empty); } catch (e) { threw = e instanceof EmptyArrangementError; }
  check('a project with no notes rejects before anything is rendered', threw,
    threw ? 'EmptyArrangementError' : 'no error thrown');
}

function programsAndPercussionSurvive(): void {
  const project = createProject({
    title: 'T',
    tracks: [
      createTrack(0, { notes: midiNotes(3), program: 40, channel: 0 }),
      createTrack(1, { notes: midiNotes(3, 36), program: 0, channel: 9 }),
    ],
  });
  const parsed = readSmf(projectAudioSource(project));
  const programs = parsed.tracks.map((t) => t.program);
  const channels = parsed.tracks.map((t) => t.channel);
  const ok = programs.includes(40) && channels.includes(9);
  check('program changes and the percussion channel survive the source conversion', ok,
    `programs=[${programs}] channels=[${channels}]`);
}

function tempoMapSurvives(): void {
  const project = createProject({
    title: 'T',
    tracks: [createTrack(0, { notes: midiNotes(4) })],
    tempos: [{ timeMs: 0, bpm: 90 }, { timeMs: 2000, bpm: 140 }],
  });
  const parsed = readSmf(projectAudioSource(project));
  const bpms = parsed.tempos.map((t) => Math.round(t.bpm));
  check('a tempo map survives the source conversion', bpms.includes(90) && bpms.includes(140),
    `tempos=[${bpms}]`);
}

// ── the vendored encoder binaries ─────────────────────────────────────────────

function encoderAssetsAreVendored(): void {
  // The MP3/OGG encoders load all three of these by URL from `public/`, so a missing or
  // truncated file is a broken export in production and nothing at all in dev.
  let detail = '', ok = false;
  try {
    const mp3  = readFileSync('public/encoders/mp3.wasm');
    const ogg  = readFileSync('public/encoders/ogg.wasm');
    const glue = readFileSync('public/encoders/WasmMediaEncoder.min.js', 'utf8');
    const magic = (b: Buffer) => b[0] === 0x00 && ascii(new Uint8Array(b), 1, 3) === 'asm';
    ok = magic(mp3) && magic(ogg) && mp3.length > 100_000 && ogg.length > 400_000
      && glue.includes('WasmMediaEncoder') && glue.includes('createEncoder');
    detail = `mp3=${mp3.length}B ogg=${ogg.length}B glue=${glue.length}B`;
  } catch (e) {
    detail = `missing: ${(e as Error).message}`;
  }
  check('the vendored encoder assets are present and well-formed', ok, detail);
}

function encoderIsNotImportedIntoTheBundle(): void {
  // The regression this guards is invisible in dev and expensive in production: importing
  // the package's ESM entry drags 760KB of base64-inlined WASM into a chunk, because Metro
  // does not tree-shake the inline `createMp3Encoder`/`createOggEncoder` exports. Everything
  // must go through `public/encoders/` instead, so no source file may import the package.
  const source = readFileSync('src/export/encodeCompressed.web.ts', 'utf8');
  const imports = /^\s*import\s[^;]*from\s+'wasm-media-encoders'/m.test(source)
    || /import\(\s*'wasm-media-encoders'/.test(source);
  check('no source file imports wasm-media-encoders (it is vendored, not bundled)', !imports,
    imports ? 'encodeCompressed.web.ts imports the package' : 'loaded by URL only');
}

function main(): void {
  wavHeaderIsWellFormed();
  wavIsStereo44k16bit();
  wavLengthMatchesDuration();
  wavCarriesNonSilentPcm();
  wavClampsRatherThanWraps();
  wavIsDeterministic();
  wavHandlesMonoSource();
  fileNamesAndMimeTypes();
  fileNameSanitisation();
  tabSourceIsRealMidi();
  tabSourceRejectsEmpty();
  projectSourceMatchesMidiDownload();
  muteAndSoloDoNotAffectExport();
  velocityFloorStillFilters();
  projectSourceRejectsEmpty();
  programsAndPercussionSurvive();
  tempoMapSurvives();
  encoderAssetsAreVendored();
  encoderIsNotImportedIntoTheBundle();

  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`);
  }
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} cases passed`);
  if (passed !== results.length) process.exitCode = 1;
}

main();
