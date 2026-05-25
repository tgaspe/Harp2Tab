import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { ExportOption } from '@/components/ExportOption';
import { useTheme } from '@/hooks/useTheme';
import { useAppStore, selectKey, selectTabNotes, selectExportFmt, selectHarmonicaType } from '@/store/useAppStore';
import { generateForFormat } from '@/export/generators';
import { EXPORT_FORMATS, FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
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
  const reset           = useAppStore((s) => s.reset);
  const [isExporting, setIsExporting] = useState(false);

  function handleNewRecording() {
    reset();
    router.replace('/');
  }

  async function buildFile() {
    const { content, encoding, ext, mimeType } = generateForFormat(
      tabNotes, selectedKey!, harmonicaType, exportFormat,
    );
    const uri = FileSystem.cacheDirectory + `harp2tab_export.${ext}`;
    await FileSystem.writeAsStringAsync(uri, content, { encoding });
    return { uri, ext, mimeType };
  }

  async function handleShare() {
    if (!selectedKey || tabNotes.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      const { uri, mimeType } = await buildFile();
      await Sharing.shareAsync(uri, { mimeType, dialogTitle: `Export as ${exportFormat}` });
    } finally {
      setIsExporting(false);
    }
  }

  async function handleSave() {
    if (!selectedKey || tabNotes.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      const { content, encoding, ext, mimeType } = generateForFormat(
        tabNotes, selectedKey, harmonicaType, exportFormat,
      );
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

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>

        {/* Nav */}
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

        {/* Header */}
        <View style={styles.header}>
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
            style={({ pressed }) => [
              styles.saveBtn,
              (tabNotes.length === 0 || isExporting) && styles.btnDisabled,
              pressed && tabNotes.length > 0 && !isExporting && styles.saveBtnPressed,
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
            style={({ pressed }) => [
              styles.shareBtn,
              (tabNotes.length === 0 || isExporting) && styles.btnDisabled,
              pressed && tabNotes.length > 0 && !isExporting && styles.shareBtnPressed,
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
    </SafeAreaView>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    safe:      { flex: 1, backgroundColor: t.bg },
    container: {
      flex: 1,
      paddingHorizontal: 24,
      paddingTop: 16,
      paddingBottom: 24,
      gap: 16,
    },
    navRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    backBtn: { padding: 4 },
    gearBtn: { padding: 4 },
    header: { gap: 10, marginTop: -8 },
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
    buttonRow: {
      flexDirection: 'column',
      gap: 10,
    },
    saveBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: t.surface,
      borderRadius: 14,
      paddingVertical: 18,
      borderWidth: 1,
      borderColor: t.accent,
    },
    saveBtnPressed:  { opacity: 0.7 },
    saveBtnText:     { fontSize: FONT.md, fontFamily: Poppins.bold, color: t.accent },
    shareBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: t.accent,
      borderRadius: 14,
      paddingVertical: 18,
    },
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
