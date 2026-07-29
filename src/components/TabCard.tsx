import { FONT } from '@/constants/keys';
import { Poppins } from '@/constants/fonts';
import { useTheme } from '@/hooks/useTheme';
import { tabToNote, noteToTab } from '@/audio/HarmonicaMapper';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType, TabNote } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleProp, StyleSheet, Text, TextInput, TextStyle, View } from 'react-native';

type EditableField = 'tab' | 'note' | 'start_time' | 'duration';

const TAB_RE_DIATONIC  = /^(?:-\d{1,2}'{0,3}|\d{1,2}(?:'{1,3}|o)?)$/;
const TAB_RE_CHROMATIC = /^-?\d{1,2}\+?$/;
const NOTE_RE          = /^[A-G]#?\d$/;

function validateField(field: EditableField, value: string, harmonicaType?: HarmonicaType): boolean {
  switch (field) {
    case 'tab': {
      const re = harmonicaType === 'chromatic' ? TAB_RE_CHROMATIC : TAB_RE_DIATONIC;
      return re.test(value.trim());
    }
    case 'note':       return NOTE_RE.test(value.trim().toUpperCase());
    case 'start_time': { const n = parseInt(value, 10); return !isNaN(n) && n >= 0; }
    case 'duration':   { const n = parseInt(value, 10); return !isNaN(n) && n >= 1; }
  }
}

interface TabCardProps {
  note:            TabNote;
  index:           number;
  harmonicaKey?:   HarmonicaKey;
  harmonicaType?:  HarmonicaType;
  isSelected?:     boolean;
  onSelect?:      (id: string) => void;
  onDelete?:      (id: string) => void;
  onUpdate?:      (id: string, changes: Partial<Pick<TabNote, 'tab' | 'note' | 'start_time' | 'duration'>>) => void;
  draggable?:     boolean;
  drag?:          () => void;
  isActive?:      boolean;
}

function fmtStartTime(ms: number): string { return `${(ms / 1000).toFixed(1)}s`; }
function fmtDuration(ms: number): string  { return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`; }

export function TabCard({
  note, index, harmonicaKey, harmonicaType, isSelected, onSelect, onDelete, onUpdate, draggable, drag, isActive,
}: TabCardProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [editValue,    setEditValue]    = useState('');
  const [editValid,    setEditValid]    = useState(true);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!isSelected) setEditingField(null);
  }, [isSelected]);

  useEffect(() => {
    if (editingField) setTimeout(() => inputRef.current?.focus(), 50);
  }, [editingField]);

  function startEdit(field: EditableField) {
    const raw = String(note[field]);
    setEditValue(raw);
    setEditValid(true);
    setEditingField(field);
  }

  function handleChangeText(v: string) {
    setEditValue(v);
    if (editingField) setEditValid(validateField(editingField, v, harmonicaType));
  }

  function commitEdit() {
    if (editingField && onUpdate && editValid) {
      if (editingField === 'start_time' || editingField === 'duration') {
        onUpdate(note.id, { [editingField]: parseInt(editValue, 10) });
      } else if (editingField === 'tab') {
        const trimmed = editValue.trim();
        const type    = harmonicaType ?? 'diatonic';
        const linked  = harmonicaKey ? tabToNote(trimmed, harmonicaKey, type) : null;
        onUpdate(note.id, linked ? { tab: trimmed, note: linked } : { tab: trimmed });
      } else if (editingField === 'note') {
        const trimmed = editValue.trim().toUpperCase();
        const type    = harmonicaType ?? 'diatonic';
        const linked  = harmonicaKey ? noteToTab(trimmed, harmonicaKey, type) : null;
        onUpdate(note.id, linked ? { note: trimmed, tab: linked } : { note: trimmed });
      }
    }
    setEditingField(null);
    setEditValid(true);
  }

  return (
    <Pressable
      onPress={() => !isActive && onSelect?.(note.id)}
      disabled={isActive}
      style={({ pressed }) => [
        styles.card,
        isSelected && styles.cardSelected,
        isActive   && styles.cardActive,
        pressed && !isSelected && !isActive && styles.cardPressed,
      ]}
      accessibilityLabel={`Note ${index + 1}: ${note.tab}, ${note.note}`}
    >
      <View style={styles.row}>

        {/* Index */}
        <View style={styles.indexCell}>
          <Text style={styles.indexValue}>{String(index + 1).padStart(2, '0')}</Text>
        </View>

        {/* TAB */}
        <EditableCell
          label="TAB"
          displayValue={note.tab}
          valueStyle={styles.cellValueTab}
          isSelected={!!isSelected}
          isEditing={editingField === 'tab'}
          editValue={editValue}
          editValid={editValid}
          inputRef={editingField === 'tab' ? inputRef : undefined}
          onTap={() => startEdit('tab')}
          onChangeText={handleChangeText}
          onBlur={commitEdit}
          numeric={false}
          theme={theme}
          styles={styles}
        />

        {/* NOTE */}
        <EditableCell
          label="NOTE"
          displayValue={note.note}
          valueStyle={styles.cellValueNote}
          isSelected={!!isSelected}
          isEditing={editingField === 'note'}
          editValue={editValue}
          editValid={editValid}
          inputRef={editingField === 'note' ? inputRef : undefined}
          onTap={() => startEdit('note')}
          onChangeText={handleChangeText}
          onBlur={commitEdit}
          numeric={false}
          theme={theme}
          styles={styles}
        />

        {/* START */}
        <EditableCell
          label="START"
          displayValue={fmtStartTime(note.start_time)}
          valueStyle={styles.cellValueTime}
          isSelected={!!isSelected}
          isEditing={editingField === 'start_time'}
          editValue={editValue}
          editValid={editValid}
          inputRef={editingField === 'start_time' ? inputRef : undefined}
          onTap={() => startEdit('start_time')}
          onChangeText={handleChangeText}
          onBlur={commitEdit}
          numeric={true}
          theme={theme}
          styles={styles}
        />

        {/* DUR */}
        <EditableCell
          label="DUR"
          displayValue={fmtDuration(note.duration)}
          valueStyle={styles.cellValueTime}
          isSelected={!!isSelected}
          isEditing={editingField === 'duration'}
          editValue={editValue}
          editValid={editValid}
          inputRef={editingField === 'duration' ? inputRef : undefined}
          onTap={() => startEdit('duration')}
          onChangeText={handleChangeText}
          onBlur={commitEdit}
          numeric={true}
          theme={theme}
          styles={styles}
        />

        {/* Actions */}
        <View style={styles.actionsCell}>
          {isSelected && onDelete && (
            <Pressable
              onPress={() => onDelete(note.id)}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.5 }]}
              hitSlop={10}
              accessibilityLabel="Delete note"
            >
              <Ionicons name="close" size={18} color={theme.record} />
            </Pressable>
          )}
          {draggable && drag && (
            <Pressable
              // On web, a long-press timer races the underlying
              // GestureDetector's own pointer listener (a separate gesture
              // system from Pressable) — the hand-off between the two can
              // miss the pointer sequence. Starting on mousedown avoids the
              // race entirely and matches how desktop drag handles usually
              // behave anyway (grab-and-go, no hold delay).
              {...(Platform.OS === 'web' ? { onPressIn: drag } : { onLongPress: drag, delayLongPress: 0 })}
              style={styles.iconBtn}
              hitSlop={12}
              accessibilityLabel="Drag to reorder"
            >
              <Ionicons
                name="reorder-three"
                size={24}
                color={isActive ? theme.accent : theme.textMuted}
              />
            </Pressable>
          )}
        </View>

      </View>
    </Pressable>
  );
}

// ─── EditableCell ─────────────────────────────────────────────────────────────

interface EditableCellProps {
  label:        string;
  displayValue: string;
  valueStyle:   StyleProp<TextStyle>;
  isSelected:   boolean;
  isEditing:    boolean;
  editValue:    string;
  editValid:    boolean;
  inputRef?:    React.RefObject<TextInput | null>;
  onTap:        () => void;
  onChangeText: (v: string) => void;
  onBlur:       () => void;
  numeric:      boolean;
  theme:        ReturnType<typeof useTheme>;
  styles:       ReturnType<typeof createStyles>;
}

function EditableCell({
  label, displayValue, valueStyle, isSelected, isEditing,
  editValue, editValid, inputRef, onTap, onChangeText, onBlur, numeric, theme, styles,
}: EditableCellProps) {
  if (isEditing) {
    return (
      <View style={styles.cell}>
        <Text style={[styles.cellLabelEditing, !editValid && { color: theme.record }]}>{label}</Text>
        <TextInput
          ref={inputRef}
          style={[styles.cellInput, !editValid && styles.cellInputError]}
          value={editValue}
          onChangeText={onChangeText}
          onBlur={onBlur}
          onSubmitEditing={onBlur}
          keyboardType={numeric ? 'numeric' : 'default'}
          selectTextOnFocus
          autoCapitalize="none"
        />
      </View>
    );
  }

  if (isSelected) {
    return (
      <Pressable onPress={onTap} style={styles.cell}>
        <Text style={[styles.cellLabel, { color: theme.accent }]}>{label}</Text>
        <Text style={[valueStyle, styles.cellValueEditable]}>{displayValue}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={valueStyle}>{displayValue}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────


function createStyles(t: Theme) {
  return StyleSheet.create({
    card: {
      backgroundColor:   t.surface,
      borderRadius:      10,
      marginVertical:    3,
      paddingHorizontal: 12,
      paddingVertical:   10,
    },
    cardSelected: { backgroundColor: t.accentSoft },
    cardActive: {
      borderWidth: 1.5,
      borderColor: t.accent,
    },
    cardPressed: { opacity: 0.75 },

    row: {
      flexDirection: 'row',
      alignItems:    'center',
    },

    indexCell: {
      alignItems:  'center',
      paddingRight: 10,
      gap:          2,
    },
    indexLabel: {
      fontSize:      7,
      fontFamily:    Poppins.bold,
      color:         t.textMuted,
      letterSpacing: 0.8,
    },
    indexValue: {
      fontSize:    FONT.xs,
      fontFamily:  Poppins.semiBold,
      color:       t.textMuted,
      fontVariant: ['tabular-nums'],
    },

    cell: {
      flex:            1,
      alignItems:      'center',
      gap:             3,
      paddingVertical: 2,
    },
    cellLabel: {
      fontSize:      7,
      fontFamily:    Poppins.bold,
      color:         t.textMuted,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    cellLabelEditing: {
      fontSize:      7,
      fontFamily:    Poppins.bold,
      color:         t.accent,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    cellValueTab: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.extraBold,
      color:      t.accent,
    },
    cellValueNote: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
      color:      t.textPrimary,
    },
    cellValueTime: {
      fontSize:    FONT.xs,
      fontFamily:  Poppins.semiBold,
      color:       t.textSub,
      fontVariant: ['tabular-nums'],
    },
    cellValueEditable: {
      color:             t.accent,
      borderBottomWidth: 1,
      borderBottomColor: t.accent,
    },
    cellInput: {
      fontSize:          FONT.sm,
      fontFamily:        Poppins.semiBold,
      color:             t.textPrimary,
      borderBottomWidth: 1.5,
      borderBottomColor: t.accent,
      width:             44,
      textAlign:         'center',
      padding:           0,
    },
    cellInputError: {
      color:             t.record,
      borderBottomColor: t.record,
    },

    actionsCell: {
      flexDirection: 'row',
      alignItems:    'center',
      paddingLeft:   4,
    },
    iconBtn: { padding: 4, alignItems: 'center', justifyContent: 'center' },
  });
}
