/**
 * The MIDI Studio's export popup.
 *
 * Replaces the bare "Download MIDI" header action from Phase 11. That button did one thing
 * and named it, which was right while MIDI was the only thing a project could become; with
 * WAV/MP3/OGG behind the same arrangement it becomes "Export" plus a format, matching the
 * editor's own popup rather than growing four header buttons.
 *
 * Format selection is local state, deliberately not the app-wide `exportFormat` the editor
 * writes: picking MP3 here must not silently change what the tab editor offers to save next
 * time, and audio has no representation in that union anyway.
 *
 * Available on every platform, with the Audio section filtered out off web (see
 * `exportSections`), so native does not lose the MIDI download it has today.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ExportFormatSections } from '@/components/ExportFormatSections';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import { isAudioFormat, projectExportSections } from '@/export/exportSections';
import type { Theme } from '@/theme';

interface Props {
  visible: boolean;
  /** Runs the export. Resolves when the file has been handed to the browser; rejects with a
   *  message the user can act on. */
  onExport: (format: string, onStatus: (label: string | null) => void) => Promise<void>;
  onClose: () => void;
}

export function ExportProjectModal({ visible, onExport, onClose }: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const sections = useMemo(() => projectExportSections(), []);

  const [format, setFormat] = useState('MIDI');
  const [busy, setBusy]     = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);

  // Reopening after a failure should not show the previous attempt's error. The chosen
  // format survives, since re-picking it every time would be tedious.
  useEffect(() => { if (visible) { setBusy(false); setStatus(null); setError(null); } }, [visible]);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onExport(format, setStatus);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed. Try again.');
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? undefined : onClose}>
      {/* Dismiss by backdrop, except mid-export: a render that has already started cannot be
          cancelled (neither spessasynth's offline render nor the WASM encoders expose a safe
          abort), so closing the card would just hide work that is still running. */}
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>Export project</Text>
            <Pressable
              onPress={onClose}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
            >
              <Ionicons name="close" size={20} color={theme.textMuted} />
            </Pressable>
          </View>

          <ExportFormatSections
            sections={sections}
            selectedId={format}
            onSelect={(id) => { setError(null); setFormat(id); }}
            titleStyle={styles.sectionLabel}
            groupStyle={styles.group}
          />

          {isAudioFormat(format) && (
            <Text style={styles.note}>
              Rendered with the same instruments you hear on playback. Muted and soloed tracks
              are all included.
            </Text>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            onPress={run}
            disabled={busy}
            style={({ pressed }) => [styles.action, (pressed || busy) && styles.actionBusy]}
            accessibilityRole="button"
            accessibilityLabel={`Export as ${format}`}
          >
            <Ionicons name="download-outline" size={16} color="#fff" />
            <Text style={styles.actionText}>{status ?? (busy ? 'Working…' : `Export ${format}`)}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    backdrop: {
      flex:              1,
      backgroundColor:   'rgba(0,0,0,0.7)',
      alignItems:        'center',
      justifyContent:    'center',
      paddingHorizontal: 24,
    },
    card: {
      backgroundColor:   t.bg,
      borderRadius:      24,
      paddingHorizontal: 24,
      paddingVertical:   24,
      width:             '100%',
      maxWidth:          420,
      borderWidth:       1,
      borderColor:       t.border,
      gap:               12,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: {
      fontSize:   FONT.lg,
      fontFamily: SpaceGrotesk.bold,
      color:      t.textPrimary,
    },
    sectionLabel: {
      fontSize:      FONT.xs,
      fontFamily:    Poppins.bold,
      color:         t.textMuted,
      letterSpacing: 1.2,
      paddingHorizontal: 2,
      marginTop:     4,
    },
    group: {
      backgroundColor: t.surface,
      borderRadius:    14,
      borderWidth:     1,
      borderColor:     t.border,
      overflow:        'hidden',
    },
    note: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      lineHeight: 16,
    },
    error: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.record,
      lineHeight: 16,
    },
    action: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             8,
      backgroundColor: t.accent,
      borderRadius:    12,
      paddingVertical: 12,
      marginTop:       4,
    },
    actionBusy: { opacity: 0.7 },
    actionText: { fontSize: FONT.base, fontFamily: Poppins.semiBold, color: '#fff' },
  });
}
