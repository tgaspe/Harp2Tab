/**
 * The Score view — conventional staff notation over the same session the List and the Piano
 * Roll are editing, with the Harp2Tab tab under every note.
 *
 * Read-only, deliberately. List and Piano Roll remain the editing surfaces; this is the view
 * you hand to someone who reads music, and the thing the SVG/PDF/PNG exports are made of.
 * What it does offer is the two decisions a transcription actually needs — how fine a rhythm
 * grid to fit, and whether the tabs are shown — plus an honest banner when the quantizer had
 * to move notes to write them down.
 *
 * The paper is white in both themes. Notation is black-on-white everywhere it is ever
 * printed, and a dark-mode score would either be invisible or would be a picture that cannot
 * be exported without re-rendering it. The surrounding chrome follows the theme; the page
 * does not.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { singlePart } from '@/export/generators';
import { createScoreRenderer, type ScoreRenderer } from '@/notation/render/osmd.web';
import { buildScoreDocument } from '@/notation/quantize';
import { tickToMs, type RhythmMode } from '@/notation/scoreDocument';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType, TabNote } from '@/types';

export interface ScoreViewProps {
  notes:          TabNote[];
  harmonicaKey:   HarmonicaKey | null;
  harmonicaType:  HarmonicaType;
  bpm:            number;
  /** The tab's own name, engraved as the score's title. Empty falls back to `Harp2Tab`,
   *  which is what an unnamed tab exports under too. The harmonica is named separately, on
   *  the subtitle line, so titling a tab never costs it the key. */
  title:          string;
  selectedId:     string | null;
  /** Only ever called with a real id — a click either lands on a notehead or on the page. */
  onSelect:       (id: string) => void;
  /** The note sounding right now, or null. Highlighted over the selection. */
  playingNoteId:  string | null;
  onSeek:         (ms: number) => void;
  theme:          Theme;
  /** Lifted so the export surface can render at whatever the reader is looking at. */
  rhythmMode:     RhythmMode;
  onRhythmMode:   (mode: RhythmMode) => void;
  showTabs:       boolean;
  onShowTabs:     (show: boolean) => void;
}

const MODES: { id: RhythmMode; label: string; hint: string }[] = [
  { id: 'readable', label: 'Readable', hint: 'Eighth-note grid — simplest to read' },
  { id: 'balanced', label: 'Balanced', hint: 'Sixteenth-note grid' },
  { id: 'precise',  label: 'Precise',  hint: 'Thirty-second grid — closest to the performance' },
  { id: 'triplet',  label: 'Triplet',  hint: 'Three to the beat, for shuffle and swing material' },
];

export function ScoreView({
  notes, harmonicaKey, harmonicaType, bpm, title, selectedId, onSelect, playingNoteId, onSeek,
  theme, rhythmMode, onRhythmMode, showTabs, onShowTabs,
}: ScoreViewProps) {
  const hostRef     = useRef<View | null>(null);
  const rendererRef = useRef<ScoreRenderer | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError]   = useState<string | null>(null);
  /** The renderer loads asynchronously, so the first engrave has to wait for it rather than
   *  silently doing nothing. */
  const [rendererReady, setRendererReady] = useState(false);
  /** Bumped by every render request, so a slow engrave that has been superseded knows to
   *  drop its result instead of painting over a newer one. */
  const generation = useRef(0);

  const doc = useMemo(() => {
    if (!harmonicaKey || notes.length === 0) return null;
    return buildScoreDocument(singlePart(notes, harmonicaKey, harmonicaType), {
      bpm, beats: 4, beatType: 4, rhythmMode, title: title.trim() || undefined,
    });
  }, [notes, harmonicaKey, harmonicaType, bpm, rhythmMode, title]);

  /** How many source notes the quantizer had to move to write the score down. */
  const movedCount = useMemo(
    () => (doc ? new Set(doc.warnings.map((w) => w.sourceId)).size : 0),
    [doc],
  );

  // One renderer for the life of the view. OSMD is a 1.3 MB lazy chunk and holds a DOM
  // subtree; rebuilding it per document would re-download nothing but would re-engrave
  // everything from scratch.
  useEffect(() => {
    let disposed = false;
    const host = hostRef.current as unknown as HTMLElement | null;
    if (!host) return;

    createScoreRenderer(host)
      .then((renderer) => {
        if (disposed) { renderer.dispose(); return; }
        rendererRef.current = renderer;
        renderer.onNoteClick(({ sourceIds, tick }) => {
          const [first] = sourceIds;
          if (first) onSelect(first);
          // Clicking a note is also asking to hear from there — the same gesture the piano
          // roll's ruler already means by it.
          const current = docRef.current;
          if (current) onSeek(Math.max(0, Math.round(tickToMs(current, tick))));
        });
        setRendererReady(true);
      })
      .catch((e: Error) => {
        if (disposed) return;
        setError(e.message);
        setStatus('error');
      });

    return () => {
      disposed = true;
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
    // Mount-only: the click handler reads the current document through a ref precisely so
    // this doesn't have to tear the renderer down every time the notes change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The click handler needs today's document without being re-registered for each one.
  const docRef = useRef(doc);
  docRef.current = doc;

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !doc || !rendererReady) return;

    const mine = ++generation.current;
    setStatus('loading');
    renderer.render(doc, { showTabs })
      .then(() => {
        if (mine !== generation.current) return;
        setStatus('ready');
        setError(null);
      })
      .catch((e: Error) => {
        if (mine !== generation.current) return;
        setError(e.message);
        setStatus('error');
      });
  }, [doc, showTabs, rendererReady]);

  // Selection and playback are attribute writes on notes that are already drawn, so neither
  // costs an engrave. Playback wins when both point at the same note: the moving highlight
  // is the one a reader is following.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready') return;
    const id = playingNoteId ?? selectedId;
    renderer.highlight(id ? [id] : [], playingNoteId ? theme.accent : theme.accentDeep);
  }, [playingNoteId, selectedId, status, theme.accent, theme.accentDeep]);

  const setMode = useCallback((mode: RhythmMode) => onRhythmMode(mode), [onRhythmMode]);

  if (Platform.OS !== 'web') return null;

  return (
    <View style={{ flex: 1 }}>
      {/* Controls sit on the app's surface, not on the page — they are chrome, and putting
          them on the white paper would make them look like part of the score. */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12,
        paddingVertical: 8, flexWrap: 'wrap',
      }}>
        <Text style={{ color: theme.textSub, fontSize: 12, fontWeight: '600' }}>RHYTHM</Text>
        <View style={{
          flexDirection: 'row', backgroundColor: theme.surfaceAlt, borderRadius: 8, padding: 2,
        }}>
          {MODES.map((mode) => (
            <Pressable
              key={mode.id}
              onPress={() => setMode(mode.id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: rhythmMode === mode.id }}
              accessibilityLabel={`${mode.label} rhythm — ${mode.hint}`}
              style={{
                paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
                backgroundColor: rhythmMode === mode.id ? theme.accent : 'transparent',
              }}
            >
              <Text style={{
                fontSize: 12, fontWeight: '600',
                color: rhythmMode === mode.id ? '#fff' : theme.textSub,
              }}>{mode.label}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={() => onShowTabs(!showTabs)}
          accessibilityRole="switch"
          accessibilityState={{ checked: showTabs }}
          accessibilityLabel="Show harmonica tabs under the notes"
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10,
            paddingVertical: 6, borderRadius: 8,
            backgroundColor: showTabs ? theme.accent : theme.surfaceAlt,
          }}
        >
          <Ionicons name="text-outline" size={14} color={showTabs ? '#fff' : theme.textSub} />
          <Text style={{
            fontSize: 12, fontWeight: '600', color: showTabs ? '#fff' : theme.textSub,
          }}>Tabs</Text>
        </Pressable>

        {status === 'loading' && <ActivityIndicator size="small" color={theme.textSub} />}
      </View>

      {/* The quantizer moved notes to write them down. Saying so is the difference between a
          transcription and a claim about what was played. */}
      {movedCount > 0 && status === 'ready' && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 12,
          marginBottom: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
          backgroundColor: theme.surfaceAlt,
        }}>
          <Ionicons name="information-circle-outline" size={15} color={theme.textSub} />
          <Text style={{ color: theme.textSub, fontSize: 12, flexShrink: 1 }}>
            {movedCount} {movedCount === 1 ? 'note was' : 'notes were'} moved to fit the{' '}
            {MODES.find((m) => m.id === rhythmMode)?.label.toLowerCase()} grid. The Piano Roll
            still shows what was played.
          </Text>
        </View>
      )}

      {error && (
        <View style={{
          marginHorizontal: 12, marginBottom: 6, padding: 10, borderRadius: 8,
          backgroundColor: theme.surfaceAlt,
        }}>
          <Text style={{ color: theme.textSub, fontSize: 12 }}>
            The score could not be drawn: {error}
          </Text>
        </View>
      )}

      {!doc && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: theme.textMuted, fontSize: 14, textAlign: 'center' }}>
            {notes.length === 0
              ? 'Record or add some notes and they will be engraved here.'
              : 'Pick a harmonica key to see the score.'}
          </Text>
        </View>
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16 }}
        showsVerticalScrollIndicator
      >
        <View
          ref={hostRef}
          // White paper in both themes: notation is black-on-white wherever it is printed,
          // and this element is literally what the SVG and PNG exports are made from.
          style={{
            backgroundColor: '#fff',
            borderRadius: 6,
            padding: 12,
            minHeight: doc ? 200 : 0,
            display: doc ? 'flex' : 'none',
          }}
        />
      </ScrollView>
    </View>
  );
}
