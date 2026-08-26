/**
 * Harness for the sampled-instrument resolver (Phase 11-6).
 *
 * Everything here is deliberately pure: `tsx` has no `AudioContext`, so the split in this
 * phase is that all the *decisions* (which sample, what rate, where the loop is) live in
 * `resolver.ts` and are checked here, while only the *scheduling* needs a browser. The
 * cases that matter most are the boundary ones — a key exactly on a zone edge, and the
 * loop-offset conversion, which is silently wrong by the ratio of two sample rates if you
 * divide by the decoded buffer's rate instead of the sample's own.
 *
 * Run: npx tsx scripts/verify-soundfont.ts
 */

import {
  drumZoneForKey,
  loopSecondsFor,
  playbackRateFor,
  zoneForKey,
} from '../src/audio/soundfont/resolver';
import type { DrumKitManifest, InstrumentManifest, SampleZone } from '../src/audio/soundfont/types';
import { pairStereo, type ResolvedZone, type SampleHeader } from './build-soundfont';
import { createTrack } from '../src/audio/midiProject';
import { trackToTabNotes } from '../src/audio/studioNotes';

// ── Assertions ────────────────────────────────────────────────────────────────

interface CaseResult { name: string; passed: boolean; detail: string }

const results: CaseResult[] = [];

function check(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
}

function near(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

const SOURCE = { soundfont: 'MuseScore General', version: 'test', license: 'MIT' };

function zone(partial: Partial<SampleZone>): SampleZone {
  return {
    file: 'c4.ogg', rootKey: 60, loKey: 0, hiKey: 127, sampleRate: 44100,
    tuneCents: 0, gain: 1, pan: 0, releaseSec: 0.1, bytes: 1, sha256: '', ...partial,
  };
}

const piano: InstrumentManifest = {
  program: 0, name: 'Acoustic Grand Piano', source: SOURCE,
  zones: [
    zone({ file: 'c2.ogg', rootKey: 36, loKey: 0,  hiKey: 47 }),
    zone({ file: 'c4.ogg', rootKey: 60, loKey: 48, hiKey: 71 }),
    zone({ file: 'c6.ogg', rootKey: 84, loKey: 72, hiKey: 127 }),
  ],
};

// ── Zone selection ────────────────────────────────────────────────────────────

function zonesSplitByRange(): void {
  check('zone: middle of a range', zoneForKey(piano, 60)?.file === 'c4.ogg', 'key 60 → c4');
  check('zone: low range',        zoneForKey(piano, 24)?.file === 'c2.ogg', 'key 24 → c2');
  check('zone: high range',       zoneForKey(piano, 100)?.file === 'c6.ogg', 'key 100 → c6');
}

function zoneBoundariesAreInclusive(): void {
  // The off-by-one that a "sounds fine" listening test never catches: one key either side
  // of a zone edge must land in different zones, and both edges are inclusive.
  check('zone: hiKey is inclusive', zoneForKey(piano, 47)?.file === 'c2.ogg', 'key 47 → c2');
  check('zone: loKey is inclusive', zoneForKey(piano, 48)?.file === 'c4.ogg', 'key 48 → c4');
  check('zone: upper edge',         zoneForKey(piano, 71)?.file === 'c4.ogg', 'key 71 → c4');
  check('zone: next zone starts',   zoneForKey(piano, 72)?.file === 'c6.ogg', 'key 72 → c6');
}

function keyOutsideEveryZone(): void {
  const narrow: InstrumentManifest = {
    program: 1, name: 'Narrow', source: SOURCE,
    zones: [zone({ loKey: 60, hiKey: 62 })],
  };
  check('zone: no cover → null', zoneForKey(narrow, 30) === null, 'key 30 has no zone');
}

// ── Pitch ─────────────────────────────────────────────────────────────────────

function playbackRateBySemitoneAndOctave(): void {
  const z = zone({ rootKey: 60 });
  check('rate: root plays untransposed', near(playbackRateFor(z, 60), 1, 1e-9), '60 → 1.0');
  check('rate: octave up is 2x',         near(playbackRateFor(z, 72), 2, 1e-9), '72 → 2.0');
  check('rate: octave down is 0.5x',     near(playbackRateFor(z, 48), 0.5, 1e-9), '48 → 0.5');
  check('rate: one semitone up',         near(playbackRateFor(z, 61), 1.059463, 1e-6), '61 → 2^(1/12)');
}

function tuningFoldsIntoRate(): void {
  const sharp = zone({ rootKey: 60, tuneCents: 100 });
  check('rate: +100 cents equals a semitone',
    near(playbackRateFor(sharp, 60), playbackRateFor(zone({ rootKey: 60 }), 61), 1e-9),
    '100 cents == 1 semitone');
}

// ── Loops ─────────────────────────────────────────────────────────────────────

function loopOffsetsUseTheSamplesOwnRate(): void {
  // The bug this exists to catch: dividing by the decoded buffer's rate (48000) instead of
  // the sample's own (44100) shortens every loop by ~8%, which reads as a subtly wrong
  // pitch-stable wobble rather than as an obvious defect.
  const looped = zone({ sampleRate: 44100, loopStartFrames: 44100, loopEndFrames: 88200 });
  const loop = loopSecondsFor(looped);
  check('loop: start in seconds', loop !== null && near(loop.start, 1, 1e-9), '44100 frames @44.1k → 1.0s');
  check('loop: end in seconds',   loop !== null && near(loop.end, 2, 1e-9),   '88200 frames @44.1k → 2.0s');
  check('loop: one-shot has none', loopSecondsFor(zone({})) === null, 'no loop frames → null');
}

// ── Percussion ────────────────────────────────────────────────────────────────

function drumsAreSelectedNotTransposed(): void {
  const kit: DrumKitManifest = {
    name: 'Standard Kit', source: SOURCE,
    zones: [
      { ...zone({ file: 'kick.ogg', rootKey: 36 }), key: 36, drumName: 'Bass Drum 1' },
      { ...zone({ file: 'snare.ogg', rootKey: 38 }), key: 38, drumName: 'Acoustic Snare' },
    ],
  };
  check('drums: key 36 is the kick',  drumZoneForKey(kit, 36)?.file === 'kick.ogg', '36 → kick');
  check('drums: key 38 is the snare', drumZoneForKey(kit, 38)?.file === 'snare.ogg', '38 → snare');
  check('drums: unmapped key is silent', drumZoneForKey(kit, 21) === null, '21 → null');
  const kick = drumZoneForKey(kit, 36)!;
  check('drums: never transposed', near(playbackRateFor(kick, kick.key), 1, 1e-9), 'kick plays at 1.0');
}

// ── Stereo pairs ──────────────────────────────────────────────────────────────

function header(name: string): SampleHeader {
  return { name, start: 0, end: 100, loopStart: 0, loopEnd: 0, sampleRate: 44100, rootKey: 60, correctionCents: 0 };
}

function resolved(name: string, index: number, loKey: number, hiKey: number): ResolvedZone {
  return { sample: header(name), sampleIndex: index, loKey, hiKey, loVel: 0, hiVel: 127, rootKey: 60, loops: false };
}

function stereoPairsCollapseToOneZone(): void {
  // The bug this locks out: `Piano MF Bv1(L)` and `(R)` are two mono samples sharing one key
  // range. Left as two zones they overlap, the thinning keeps whichever sorts first, and the
  // grand piano plays one channel of a stereo recording — which sounds like a slightly thin
  // piano rather than like a defect. It hits the piano and every drum kit.
  const paired = pairStereo([
    resolved('Piano MF Bv1(L)', 0, 12, 24),
    resolved('Piano MF Bv1(R)', 1, 12, 24),
  ]);
  check('stereo: a pair is one zone', paired.length === 1, '2 zones -> 1');
  check('stereo: left is the primary', paired[0]?.sample.name === 'Piano MF Bv1(L)', 'file is (L)');
  check('stereo: right is carried', paired[0]?.right?.name === 'Piano MF Bv1(R)', 'fileRight is (R)');
}

function loneChannelsAndMonoSurvive(): void {
  const mixed = pairStereo([
    resolved('Flute C4', 0, 60, 71),
    resolved('Orphan(L)', 1, 12, 24),
  ]);
  check('stereo: mono zones pass through', mixed.some((z) => z.sample.name === 'Flute C4'), 'mono kept');
  // Better a half-stereo instrument than a hole in the keyboard.
  check('stereo: an unpaired (L) is kept', mixed.some((z) => z.sample.name === 'Orphan(L)'), 'lone (L) kept');
  check('stereo: unpaired has no right', mixed.find((z) => z.sample.name === 'Orphan(L)')?.right === undefined, 'no fileRight');
}

function pairsDoNotCrossKeyRanges(): void {
  // An (L) and an (R) that don't share a key range are not a pair, and merging them would
  // silently move a sample to the wrong part of the keyboard.
  const apart = pairStereo([
    resolved('Kick(L)', 0, 36, 36),
    resolved('Kick(R)', 1, 40, 40),
  ]);
  check('stereo: ranges must match', apart.length === 2, 'different ranges -> not paired');
}

// ── Percussion plumbing ───────────────────────────────────────────────────────

function percussionSurvivesTheFlatten(): void {
  // studio.tsx:218 flattens every audible track into one TabNote[] carrying `program` and
  // nothing else. Before this flag a drum track reached the scheduler indistinguishable from
  // a piano track — harmless while everything was a test tone, and a room full of pianos
  // playing a drum part the moment samples arrived.
  const drums = createTrack(0, {
    channel: 9,
    notes: [{ midi: 36, timeMs: 0, durationMs: 100, velocity: 100 }],
  });
  check('percussion: flagged on channel 9', trackToTabNotes(drums)[0]?.percussion === true, 'channel 9 → percussion');

  const piano = createTrack(0, {
    channel: 0,
    notes: [{ midi: 60, timeMs: 0, durationMs: 100, velocity: 100 }],
  });
  check('percussion: absent elsewhere', trackToTabNotes(piano)[0]?.percussion !== true, 'channel 0 → not percussion');

  // Channel 15 is the escape hatch `createTrack` uses for a tenth track so it doesn't land
  // on percussion by accident (midiProject.ts:59). It must not read as drums.
  const tenth = createTrack(9, { notes: [{ midi: 60, timeMs: 0, durationMs: 100, velocity: 100 }] });
  check('percussion: the tenth track is not drums', trackToTabNotes(tenth)[0]?.percussion !== true, 'channel 15 → not percussion');
}

function main(): void {
  zonesSplitByRange();
  zoneBoundariesAreInclusive();
  keyOutsideEveryZone();
  playbackRateBySemitoneAndOctave();
  tuningFoldsIntoRate();
  loopOffsetsUseTheSamplesOwnRate();
  drumsAreSelectedNotTransposed();
  stereoPairsCollapseToOneZone();
  loneChannelsAndMonoSurvive();
  pairsDoNotCrossKeyRanges();
  percussionSurvivesTheFlatten();

  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`);
  }
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} cases passed`);
  if (passed !== results.length) process.exitCode = 1;
}

main();
