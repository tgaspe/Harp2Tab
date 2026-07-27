import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FlatList } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import DraggableFlatList, {
  ScaleDecorator,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { TabCard } from '@/components/TabCard';
import { useTheme } from '@/hooks/useTheme';
import { useAppStore, selectTabNotes, selectKey, selectHarmonicaType, selectCanUndo } from '@/store/useAppStore';
import { FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import type { Theme } from '@/theme';
import type { TabNote } from '@/types';

export default function EditScreen() {
  const router       = useRouter();
  const theme        = useTheme();
  const styles       = useMemo(() => createStyles(theme), [theme]);
  const tabNotes       = useAppStore(selectTabNotes);
  const harmonicaKey   = useAppStore(selectKey);
  const harmonicaType  = useAppStore(selectHarmonicaType);
  const reorderNotes = useAppStore((s) => s.reorderNotes);
  const deleteNote   = useAppStore((s) => s.deleteNote);
  const updateNote   = useAppStore((s) => s.updateNote);
  const addTabNote   = useAppStore((s) => s.addTabNote);
  const reset        = useAppStore((s) => s.reset);
  const canUndo      = useAppStore(selectCanUndo);
  const undo         = useAppStore((s) => s.undo);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef      = useRef<FlatList<TabNote>>(null);
  const prevLenRef   = useRef(tabNotes.length);

  useEffect(() => {
    if (tabNotes.length > prevLenRef.current) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
    prevLenRef.current = tabNotes.length;
  }, [tabNotes.length]);

  function handleSelect(id: string) {
    setSelectedId(prev => prev === id ? null : id);
  }

  const renderItem = useCallback(
    ({ item, getIndex, drag, isActive }: RenderItemParams<TabNote>) => (
      <ScaleDecorator activeScale={0.96}>
        <TabCard
          note={item}
          index={getIndex() ?? 0}
          harmonicaKey={harmonicaKey ?? undefined}
          harmonicaType={harmonicaType}
          isSelected={selectedId === item.id}
          onSelect={handleSelect}
          onDelete={deleteNote}
          onUpdate={updateNote}
          draggable
          drag={drag}
          isActive={isActive}
        />
      </ScaleDecorator>
    ),
    [deleteNote, updateNote, selectedId],
  );

  function handleAddNote() {
    const existing = useAppStore.getState().tabNotes;
    const prev     = existing[existing.length - 1];
    const start    = prev ? prev.start_time + prev.duration : 0;
    addTabNote({ tab: '-1', note: 'D4', start_time: start, duration: 300, confidence: 100 });
    const updated = useAppStore.getState().tabNotes;
    const last    = updated[updated.length - 1];
    if (last) setSelectedId(last.id);
  }

  function handleNewRecording() {
    reset();
    router.dismissAll();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.title}>Edit</Text>
            <Pressable
              onPress={() => router.push('/settings')}
              style={({ pressed }) => [styles.gearBtn, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
            >
              <Ionicons name="settings-outline" size={28} color={theme.textSub} />
            </Pressable>
          </View>
          <Text style={styles.subtitle}>
            {tabNotes.length} note{tabNotes.length !== 1 ? 's' : ''}
            {tabNotes.length > 0 ? ' · hold to reorder' : ''}
          </Text>
        </View>

        {tabNotes.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="musical-notes-outline" size={48} color={theme.textMuted} />
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyHint}>Go back and record something first.</Text>
          </View>
        ) : (
          <DraggableFlatList
            ref={listRef}
            data={tabNotes}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            onDragEnd={({ data }) => {
              let cursor = 0;
              reorderNotes(data.map(note => {
                const updated = { ...note, start_time: cursor };
                cursor += note.duration;
                return updated;
              }));
            }}
            containerStyle={styles.list}
            contentContainerStyle={{ paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
            autoscrollThreshold={50}
            autoscrollSpeed={100}
          />
        )}

        {/* Bottom actions */}
        <View style={styles.actions}>
          <Pressable
            onPress={undo}
            style={({ pressed }) => [
              styles.btn,
              styles.btnGhost,
              !canUndo && styles.btnFilledDisabled,
              pressed && styles.btnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Undo last action"
            accessibilityState={{ disabled: !canUndo }}
          >
            <Ionicons name="arrow-undo" size={20} color={canUndo ? theme.textSub : theme.textMuted} />
            <Text style={[styles.btnTextGhost, !canUndo && styles.btnTextDisabled]}>Undo</Text>
          </Pressable>

          <Pressable
            onPress={handleNewRecording}
            style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.btnPressed]}
            accessibilityRole="button"
            accessibilityLabel="New Recording"
          >
            <Ionicons name="mic-outline" size={20} color={theme.textSub} />
            <Text style={styles.btnTextGhost}>New</Text>
          </Pressable>

          <Pressable
            onPress={handleAddNote}
            style={({ pressed }) => [styles.btn, styles.btnOutlined, pressed && styles.btnPressed]}
            accessibilityRole="button"
            accessibilityLabel="Add Note"
          >
            <Ionicons name="add" size={20} color={theme.accent} />
            <Text style={styles.btnTextOutlined}>Add</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push('/export')}
            disabled={tabNotes.length === 0}
            style={({ pressed }) => [
              styles.btn,
              styles.btnFilled,
              tabNotes.length === 0 && styles.btnFilledDisabled,
              pressed && tabNotes.length > 0 && styles.btnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Go to Export"
            accessibilityState={{ disabled: tabNotes.length === 0 }}
          >
            <Ionicons
              name="share-outline"
              size={20}
              color={tabNotes.length === 0 ? theme.textMuted : '#fff'}
            />
            <Text style={[
              styles.btnTextFilled,
              tabNotes.length === 0 && styles.btnTextDisabled,
            ]}>
              Export
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
      paddingTop: 24,
      paddingBottom: 24,
      gap: 16,
    },
    header:    { gap: 4 },
    headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    gearBtn:   { padding: 4 },
    title:     { fontSize: FONT.xl, fontFamily: SpaceGrotesk.bold, color: t.accent, letterSpacing: -0.5 },
    subtitle: { fontSize: FONT.sm, fontFamily: Poppins.regular, color: t.textMuted },
    list:     { flex: 1 },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },

    emptyTitle: { fontSize: FONT.md, fontFamily: Poppins.bold,    color: t.textSub },
    emptyHint:  { fontSize: FONT.sm, fontFamily: Poppins.regular, color: t.textMuted },
    actions: { flexDirection: 'row', gap: 10 },

    btn: {
      flex:            1,
      flexDirection:   'column',
      alignItems:      'center',
      justifyContent:  'center',
      paddingVertical: 16,
      borderRadius:    14,
      borderWidth:     1,
      gap:             5,
    },
    btnGhost: {
      backgroundColor: t.surface,
      borderColor:     t.border,
    },
    btnOutlined: {
      backgroundColor: t.surface,
      borderColor:     t.accent,
    },
    btnFilled: {
      backgroundColor: t.accent,
      borderColor:     t.accent,
    },
    btnFilledDisabled: {
      backgroundColor: t.surface,
      borderColor:     t.border,
    },
    btnPressed: { opacity: 0.7 },

    btnTextGhost:    { fontSize: FONT.base, fontFamily: Poppins.semiBold, color: t.textSub },
    btnTextOutlined: { fontSize: FONT.base, fontFamily: Poppins.semiBold, color: t.accent },
    btnTextFilled:   { fontSize: FONT.base, fontFamily: Poppins.semiBold, color: '#fff' },
    btnTextDisabled: { color: t.textMuted },
  });
}
