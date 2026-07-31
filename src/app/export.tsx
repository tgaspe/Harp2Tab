import React, { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { ExportOption } from '@/components/ExportOption';
import { NameRecordingModal } from '@/components/NameRecordingModal';
import { RatingModal } from '@/components/RatingModal';
import { ActionSheetModal } from '@/components/ActionSheetModal';
import { useTheme } from '@/hooks/useTheme';
import { useAppStore, selectKey, selectTabNotes, selectExportFmt, selectHarmonicaType } from '@/store/useAppStore';
import { saveCurrentSessionToLibrary, getDefaultRecordingTitle, startNewRecordingSession } from '@/store/sessionSnapshot';
import { generateForFormat } from '@/export/generators';
import { contentToBlob, triggerWebDownload } from '@/export/webDownload';
import { EXPORT_FORMATS, FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { webMaxWidth, WEB_CONTENT_WIDTH, WEB_SCREEN_PADDING_TOP, WEB_SCREEN_PADDING_BOTTOM } from '@/constants/layout';
import type { Theme } from '@/theme';
import type { ExportFormat } from '@/types';

export default function ExportScreen() {
  const router          = useRouter();
  const theme           = useTheme();
  const styles          = useMemo(() => createStyles(theme), [theme]);
  const selectedKey     = useAppStore(selectKey);
  const tabNotes        = useAppStore(selectTabNotes);
  const harmonicaType   = useAppStore(selectHarmonicaType);
  const exportFormat    = useAppStore(selectExportFmt);
  const setExportFormat = useAppStore((s) => s.setExportFormat);
  const [isExporting, setIsExporting] = useState(false);
  const [pendingExport, setPendingExport] = useState<{ action: 'share' | 'save'; count: number } | null>(null);
  const [naming, setNaming] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);

  // "New Recording" means "drop me straight back into recording" — not back to the home
  // screen. Respects the same free-tier gate every other start-a-session entry point does.
  function goToNewRecording() {
    const gate = startNewRecordingSession();
    if (gate === 'showPaywall') { router.push('/paywall'); return; }
    if (gate === 'showRating') { setShowRatingModal(true); return; }
    router.dismissAll();
    router.push('/recording');
  }

  function handleNewRecording() {
    if (tabNotes.length === 0) {
      goToNewRecording();
      return;
    }
    setNaming(true);
  }

  function handleConfirmNaming(title: string) {
    // Always write a fresh entry — see the comment in edit.tsx's handleConfirmNaming.
    saveCurrentSessionToLibrary(title, { asNew: true });
    setNaming(false);
    goToNewRecording();
  }

  async function buildFile() {
    const { content, encoding, ext, mimeType } = generateForFormat(
      tabNotes, selectedKey!, harmonicaType, exportFormat,
    );
    const uri = FileSystem.cacheDirectory + `harp2tab_export.${ext}`;
    await FileSystem.writeAsStringAsync(uri, content, { encoding });
    return { uri, ext, mimeType };
  }

  async function doShare() {
    if (!selectedKey || tabNotes.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      if (Platform.OS === 'web') {
        const { content, encoding, ext, mimeType } = generateForFormat(
          tabNotes, selectedKey, harmonicaType, exportFormat,
        );
        const filename = `harp2tab_export.${ext}`;
        const blob = contentToBlob(content, encoding, mimeType);
        const canUseWebShare = typeof navigator.share === 'function'
          && typeof navigator.canShare === 'function';
        if (canUseWebShare) {
          const file = new File([blob], filename, { type: mimeType });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: filename });
            return;
          }
        }
        triggerWebDownload(blob, filename);
        return;
      }
      const { uri, mimeType } = await buildFile();
      await Sharing.shareAsync(uri, { mimeType, dialogTitle: `Export as ${exportFormat}` });
    } finally {
      setIsExporting(false);
    }
  }

  async function doSave() {
    if (!selectedKey || tabNotes.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      const { content, encoding, ext, mimeType } = generateForFormat(
        tabNotes, selectedKey, harmonicaType, exportFormat,
      );

      if (Platform.OS === 'web') {
        triggerWebDownload(contentToBlob(content, encoding, mimeType), `harp2tab_export.${ext}`);
        return;
      }

      // Pre-navigate the picker to the Downloads folder (user just taps "Use this folder")
      const DOWNLOADS_URI =
        'content://com.android.externalstorage.documents/tree/primary%3ADownload';
      const permission =
        await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(DOWNLOADS_URI);
      if (!permission.granted) return;
      const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
        permission.directoryUri,
        `harp2tab_export.${ext}`,
        mimeType,
      );
      await FileSystem.StorageAccessFramework.writeAsStringAsync(fileUri, content, { encoding });
      Alert.alert('Saved', `harp2tab_export.${ext} saved to Downloads.`);
    } finally {
      setIsExporting(false);
    }
  }

  // Pre-flight gate in front of doShare/doSave — a note with tab: '' has no real
  // position on the current harmonica (see getGridRows/PianoRoll.tsx). Skips the
  // confirm sheet entirely when there's nothing to warn about.
  function handleShare() {
    const count = tabNotes.filter((n) => n.tab === '').length;
    if (count > 0) { setPendingExport({ action: 'share', count }); return; }
    doShare();
  }

  function handleSave() {
    const count = tabNotes.filter((n) => n.tab === '').length;
    if (count > 0) { setPendingExport({ action: 'save', count }); return; }
    doSave();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>

        {/* Nav — TopBar's back chevron + gear cover this on web */}
        {Platform.OS !== 'web' && (
          <View style={styles.navRow}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={28} color={theme.accent} />
            </Pressable>
            <Pressable
              onPress={handleNewRecording}
              style={({ pressed }) => [styles.newPill, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel="New Recording"
            >
              <Ionicons name="mic-outline" size={14} color={theme.textSub} />
              <Text style={styles.newPillText}>New Recording</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/settings')}
              style={({ pressed }) => [styles.gearBtn, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
            >
              <Ionicons name="settings-outline" size={28} color={theme.textSub} />
            </Pressable>
          </View>
        )}

        {/* Header — "New Recording" is a real action (not nav chrome), so it
            moves in here on web instead of disappearing with navRow. */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Export</Text>
            <View style={styles.metaRow}>
              <View style={styles.metaBadge}>
                <Text style={styles.metaBadgeText}>Key of {selectedKey ?? '—'}</Text>
              </View>
              <View style={styles.metaBadge}>
                <Text style={styles.metaBadgeText}>{tabNotes.length} notes</Text>
              </View>
            </View>
          </View>
          {Platform.OS === 'web' && (
            <Pressable
              onPress={handleNewRecording}
              style={({ pressed }) => [styles.newPill, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel="New Recording"
            >
              <Ionicons name="mic-outline" size={14} color={theme.textSub} />
              <Text style={styles.newPillText}>New Recording</Text>
            </Pressable>
          )}
        </View>

        {/* Format picker */}
        <Text style={styles.sectionLabel}>FORMAT</Text>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Grouped list — iOS Settings style */}
          <View style={styles.formatGroup}>
            {EXPORT_FORMATS.map((fmt: ExportFormat, i) => (
              <ExportOption
                key={fmt}
                format={fmt}
                isSelected={exportFormat === fmt}
                onSelect={setExportFormat}
                showDivider={i < EXPORT_FORMATS.length - 1}
              />
            ))}
          </View>
        </ScrollView>

        {/* Actions */}
        <View style={styles.buttonRow}>
          <Pressable
            onPress={handleSave}
            disabled={tabNotes.length === 0 || isExporting}
            style={({ pressed, hovered }: any) => [
              styles.saveBtn,
              (tabNotes.length === 0 || isExporting) && styles.btnDisabled,
              (pressed || (Platform.OS === 'web' && hovered)) && tabNotes.length > 0 && !isExporting && styles.saveBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Save to Device"
            accessibilityState={{ disabled: tabNotes.length === 0 || isExporting }}
          >
            <Ionicons name="download-outline" size={18} color={theme.accent} />
            <Text style={[styles.saveBtnText, (tabNotes.length === 0 || isExporting) && styles.btnTextDisabled]}>
              {isExporting ? '…' : 'Save'}
            </Text>
          </Pressable>

          <Pressable
            onPress={handleShare}
            disabled={tabNotes.length === 0 || isExporting}
            style={({ pressed, hovered }: any) => [
              styles.shareBtn,
              (tabNotes.length === 0 || isExporting) && styles.btnDisabled,
              (pressed || (Platform.OS === 'web' && hovered)) && tabNotes.length > 0 && !isExporting && styles.shareBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Share File"
            accessibilityState={{ disabled: tabNotes.length === 0 || isExporting }}
          >
            <Ionicons name="share-outline" size={18} color="#fff" />
            <Text style={[styles.shareBtnText, (tabNotes.length === 0 || isExporting) && styles.btnTextDisabled]}>
              {isExporting ? 'Exporting…' : 'Share'}
            </Text>
          </Pressable>

        </View>

      </View>

      <NameRecordingModal
        visible={naming}
        defaultTitle={getDefaultRecordingTitle()}
        onSave={handleConfirmNaming}
        onCancel={() => setNaming(false)}
      />

      <RatingModal
        visible={showRatingModal}
        onClose={() => setShowRatingModal(false)}
        onUpgrade={() => router.push('/paywall')}
      />

      <ActionSheetModal
        visible={pendingExport !== null}
        title={pendingExport ? `${pendingExport.count} note${pendingExport.count !== 1 ? 's' : ''} aren't playable on this harmonica` : undefined}
        options={[{
          label: 'Continue',
          onPress: () => {
            if (pendingExport?.action === 'share') doShare();
            else if (pendingExport?.action === 'save') doSave();
          },
        }]}
        onClose={() => setPendingExport(null)}
      />
    </SafeAreaView>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    safe:      { flex: 1, backgroundColor: t.bg },
    container: {
      flex: 1,
      ...webMaxWidth(WEB_CONTENT_WIDTH.standard),
      paddingHorizontal: 24,
      paddingTop: Platform.OS === 'web' ? WEB_SCREEN_PADDING_TOP : 16,
      paddingBottom: Platform.OS === 'web' ? WEB_SCREEN_PADDING_BOTTOM : 24,
      gap: 16,
    },
    navRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    backBtn: { padding: 4 },
    gearBtn: { padding: 4 },
    header: Platform.select({
      web: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
      default: { gap: 10, marginTop: -8 },
    }) as ViewStyle,
    title: {
      fontSize:      FONT.xl,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.accent,
      letterSpacing: -0.5,
    },
    metaRow:  { flexDirection: 'row', gap: 8 },
    metaBadge: {
      backgroundColor: t.surface,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.border,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    metaBadgeText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
      color:      t.textSub,
    },
    sectionLabel: {
      fontSize:      FONT.xs,
      fontFamily:    Poppins.bold,
      color:         t.textMuted,
      letterSpacing: 1.4,
    },
    scroll:        { flex: 1 },
    scrollContent: { paddingBottom: 8 },
    formatGroup: {
      backgroundColor: t.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      overflow: 'hidden',
    },
    buttonRow: Platform.select({
      web: { flexDirection: 'row', gap: 10 },
      default: { flexDirection: 'column', gap: 10 },
    }) as ViewStyle,
    saveBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: t.surface,
      borderRadius: 14,
      paddingVertical: Platform.OS === 'web' ? 14 : 18,
      borderWidth: 1,
      borderColor: t.accent,
      ...(Platform.OS === 'web' ? { flex: 1, cursor: 'pointer' } : null),
    } as ViewStyle,
    // Real hover tint on web (matches the edit screen's toolbar language) instead of a
    // flat opacity dim — this button is outlined, not filled, so a color shift reads
    // clearly as "hovered" where a dim would barely register.
    saveBtnPressed: Platform.OS === 'web' ? { backgroundColor: t.accentSoft } : { opacity: 0.7 },
    saveBtnText:     { fontSize: FONT.md, fontFamily: Poppins.bold, color: t.accent },
    shareBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: t.accent,
      borderRadius: 14,
      paddingVertical: Platform.OS === 'web' ? 14 : 18,
      ...(Platform.OS === 'web' ? { flex: 1, cursor: 'pointer' } : null),
    } as ViewStyle,
    shareBtnPressed:  { backgroundColor: t.accentDim },
    shareBtnText:     { fontSize: FONT.md, fontFamily: Poppins.bold, color: '#fff' },
    btnDisabled:      { backgroundColor: t.surface, borderColor: t.border },
    btnTextDisabled:  { color: t.textMuted },
    newPill: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               5,
      backgroundColor:   t.surface,
      borderRadius:      20,
      paddingVertical:   7,
      paddingHorizontal: 14,
      borderWidth:       1,
      borderColor:       t.border,
    },
    newPillText: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textSub },
  });
}
