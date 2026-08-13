# Harp2Tab

Turn harmonica playing into harmonica tab.

Record straight from the microphone, or upload an audio or MIDI file, and Harp2Tab works out
which hole and breath direction produces each note — `4` for blow, `-4` for draw, `-3'` for a
bend, `4o` for an overblow — then lets you edit the result and export it.

Live on Google Play as [Harp2Tab](https://play.google.com/store/apps/details?id=com.chewpacastudios.harp2tab),
and as a web app built from the same codebase.

## What it does

- **Record** — live pitch detection while you play, with the tab building up as you go.
- **Upload audio** — transcribe a file, with the harmonica key detected automatically.
- **Upload MIDI** — convert an existing part to tab for a harmonica key you choose, with
  bends and overblows flagged so you can simplify them.
- **Edit** — a list editor and a piano-roll editor over the same session, with playback.
- **MIDI Studio** — a multi-track editor for imported MIDI; convert any track to tab.
- **Export** — TXT, CSV, JSON, MIDI, MusicXML.

Supports all 12 diatonic keys, including bends, overblows and overdraws.

## Getting started

```bash
npm install
cp .env.example .env      # fill in the six Firebase web values
npm run web               # web dev server
```

For an Android device build, Play Store releases, Firebase emulators and the ADB workflow,
see [docs/development.md](docs/development.md).

## How it fits together

| Area | Where | What it holds |
|---|---|---|
| Screens | `src/app/` | expo-router file-based routes — record, import, edit, studio, export, profile, settings |
| Audio pipeline | `src/audio/` | decode → transcribe → notes → tab. The largest and most load-bearing directory |
| Transcription engines | `src/audio/algorithms/` | `pmpm` (offline pitch tracker), `basicPitch` (neural, web), `spectral` (planned) |
| Harmonica mapping | `src/audio/HarmonicaMapper.ts` | pitch ↔ hole/breath, for all 12 keys |
| Export | `src/export/generators.ts` | pure `TabNote[]` → file, per format |
| State | `src/store/` | persisted Zustand stores |
| Auth & billing | `src/auth/`, `src/billing/` | Firebase Auth, entitlements |
| Native audio | `android/audiocapture/` | C++ (Oboe) capture + MPM pitch detection |
| Cloud Functions | `functions/` | RevenueCat webhook → entitlement writer |
| Harnesses | `scripts/verify-*.ts` | the test suite — see [docs/testing.md](docs/testing.md) |

Platform differences are handled by file extension, not by branching: `foo.ts` is the native
implementation and `foo.web.ts` the web one, and the bundler picks. See
[docs/architecture.md](docs/architecture.md).

## Documentation

| Document | For |
|---|---|
| [docs/architecture.md](docs/architecture.md) | How the pipeline is put together, and the conventions to follow |
| [docs/development.md](docs/development.md) | Running, building, releasing, device debugging |
| [docs/testing.md](docs/testing.md) | The verification harnesses and what each covers |
| [docs/plan/](docs/plan/) | Phase-by-phase implementation plan and status ledger |
| [PRIVACY_POLICY.md](PRIVACY_POLICY.md) | Published privacy policy |
| [AGENTS.md](AGENTS.md) | Instructions for coding agents |
