/**
 * Password input with a reveal toggle and, optionally, a strength meter.
 *
 * **The meter scores length only.** Composition rules ("one uppercase, one symbol") push
 * people toward `Password1!` — short, predictable, and worse than four ordinary words. So
 * the bar rewards the thing that actually helps and the app enforces a floor of 8 rather
 * than Firebase's default 6, which is too low to ship as the product's answer.
 *
 * The reveal control is a real button with state, not a decorative icon — it is operable by
 * keyboard and announces what it does.
 */

import React, { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Poppins } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/theme';

export const MIN_PASSWORD_LENGTH = 8;

interface Props {
  value:        string;
  onChangeText: (v: string) => void;
  label:        string;
  placeholder?: string;
  /** Sign-up shows the meter; sign-in does not — scoring the password of someone who
   *  already has an account is noise, and mildly insulting. */
  showStrength?: boolean;
  autoFocus?:    boolean;
  onSubmitEditing?: () => void;
  /** Ties an error message to this field rather than leaving it floating. */
  error?:        string;
}

interface Strength { score: 0 | 1 | 2 | 3; label: string; tint: (t: Theme) => string }

export function strengthOf(password: string): Strength {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { score: 0, label: `At least ${MIN_PASSWORD_LENGTH} characters`, tint: (t) => t.textMuted };
  }
  if (password.length < 12) return { score: 1, label: 'Okay', tint: (t) => t.warning };
  if (password.length < 16) return { score: 2, label: 'Good', tint: (t) => t.accent };
  return { score: 3, label: 'Strong', tint: (t) => t.success };
}

export function PasswordField({
  value, onChangeText, label, placeholder, showStrength, autoFocus, onSubmitEditing, error,
}: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [revealed, setRevealed] = useState(false);

  const strength = strengthOf(value);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label} nativeID="password-label">{label}</Text>

      <View style={[styles.inputRow, !!error && styles.inputRowError]}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          secureTextEntry={!revealed}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          autoFocus={autoFocus}
          returnKeyType="go"
          onSubmitEditing={onSubmitEditing}
          accessibilityLabelledBy="password-label"
          accessibilityLabel={label}
        />
        <Pressable
          onPress={() => setRevealed((r) => !r)}
          style={({ pressed, hovered }: any) => [
            styles.reveal,
            Platform.OS === 'web' && hovered && { opacity: 0.7 },
            pressed && { opacity: 0.5 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
          accessibilityState={{ selected: revealed }}
        >
          <Ionicons
            name={revealed ? 'eye-off-outline' : 'eye-outline'}
            size={18}
            color={theme.textMuted}
          />
        </Pressable>
      </View>

      {showStrength && value.length > 0 && (
        <View style={styles.strengthRow}>
          <View style={styles.bars}>
            {[0, 1, 2].map((i) => (
              <View
                key={i}
                style={[
                  styles.bar,
                  i < strength.score && { backgroundColor: strength.tint(theme) },
                ]}
              />
            ))}
          </View>
          <Text style={[styles.strengthLabel, { color: strength.tint(theme) }]}>
            {strength.label}
          </Text>
        </View>
      )}

      {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    wrap: { gap: 6 },
    label: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.semiBold,
      color:      t.textSub,
    },
    inputRow: {
      flexDirection:   'row',
      alignItems:      'center',
      borderWidth:     1,
      borderColor:     t.border,
      borderRadius:    12,
      backgroundColor: t.surface,
    },
    inputRowError: { borderColor: t.record },
    input: {
      flex:              1,
      paddingHorizontal: 14,
      paddingVertical:   12,
      fontSize:          FONT.base,
      fontFamily:        Poppins.medium,
      color:             t.textPrimary,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : null),
    },
    reveal: {
      paddingHorizontal: 12,
      paddingVertical:   12,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    strengthRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    bars: { flexDirection: 'row', gap: 4, flex: 1 },
    bar: {
      flex:            1,
      height:          4,
      borderRadius:    2,
      backgroundColor: t.surfaceAlt,
    },
    strengthLabel: { fontSize: FONT.xs, fontFamily: Poppins.semiBold },
    error: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.medium,
      color:      t.record,
      lineHeight: 16,
    },
  });
}
