/**
 * One line reporting what sync is doing. Never a dashboard.
 *
 * The `discarded` variant is the one that earns its place. Last-write-wins resolves a real
 * conflict by throwing one side away, and the failure mode of doing that quietly is a user
 * who concludes the app ate their edit. Naming the document and the time turns a data-loss
 * bug report into understood behaviour.
 *
 * **`unavailable` is not a placeholder any more, but it is still the honest default.** It now
 * means the engine is deliberately not running — signed out, address unconfirmed, or the
 * feature switched off — and each of those says which. A green "Synced" tick is only ever
 * shown when a pull and a push both completed; anything less invites someone to trust a backup
 * that is not there.
 */

import React, { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Poppins } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import type { SyncStatus } from '@/auth/types';
import type { Theme } from '@/theme';

interface Props {
  sync:     SyncStatus;
  /** Absent when there is nothing to ask — signed out, or a build with no engine running. */
  onSyncNow?: () => void;
}

/** "2 minutes ago" / "just now". Relative because the absolute time is never the question:
 *  the user wants to know whether it happened recently, not at what o'clock. */
function relativeTime(epochMs: number): string {
  const seconds = Math.round((Date.now() - epochMs) / 1000);
  if (seconds < 45)   return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60)   return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24)     return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function clockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

interface Presentation {
  icon:    React.ComponentProps<typeof Ionicons>['name'];
  tint:    (t: Theme) => string;
  text:    string;
  /** Second line, only where the first cannot carry the whole message. */
  detail?: string;
}

function present(sync: SyncStatus): Presentation {
  switch (sync.state) {
    case 'unavailable':
      return {
        // Not `phone-portrait-outline`: it is in the glyphmap but missing from the Ionicons
        // font Expo web actually serves, so it renders as a tofu box.
        icon: 'time-outline',
        tint: (t) => t.textMuted,
        text: 'Not syncing',
        // Each reason names the way out, because "not syncing" with no next step reads as a
        // fault in the app rather than a state the user can leave.
        detail:
          sync.reason === 'unverified'
            ? 'Confirm your email address and your library will start syncing.'
            : sync.reason === 'signedOut'
              ? 'Your tabs are saved on this device. Sign in to keep them on every device.'
              : 'Your tabs are saved on this device.',
      };
    case 'needsChoice':
      return {
        icon: 'help-circle-outline',
        tint: (t) => t.warning,
        text: 'Waiting on you',
        detail: 'This device holds tabs from another account. Choose what happens to them before syncing starts.',
      };
    case 'syncing':
      return { icon: 'sync-outline', tint: (t) => t.accent, text: 'Syncing…' };
    case 'offline':
      return {
        icon: 'cloud-offline-outline',
        tint: (t) => t.warning,
        text: `Offline — ${sync.pendingCount ?? 0} change${sync.pendingCount === 1 ? '' : 's'} waiting`,
        detail: 'They will upload when you are back online.',
      };
    case 'error':
      return { icon: 'alert-circle-outline', tint: (t) => t.record, text: 'Sync failed' };
    case 'discarded':
      return {
        icon: 'git-merge-outline',
        tint: (t) => t.warning,
        text: sync.lastSyncedAt ? `Synced ${relativeTime(sync.lastSyncedAt)}` : 'Synced',
        detail: sync.discarded
          ? `Replaced this device's copy of "${sync.discarded.title}" with a newer version from ${clockTime(sync.discarded.at)}.`
          : undefined,
      };
    case 'idle':
    default:
      return {
        icon: 'checkmark-circle-outline',
        tint: (t) => t.success,
        text: sync.lastSyncedAt ? `Synced ${relativeTime(sync.lastSyncedAt)}` : 'Synced',
      };
  }
}

export function SyncStatusRow({ sync, onSyncNow }: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const view   = present(sync);
  const tint   = view.tint(theme);

  return (
    <View style={styles.row}>
      <Ionicons name={view.icon} size={18} color={tint} style={styles.icon} />
      <View style={styles.body}>
        <Text style={[styles.text, { color: tint }]}>{view.text}</Text>
        {!!view.detail && <Text style={styles.detail}>{view.detail}</Text>}
      </View>

      {!!onSyncNow && (
        <Pressable
          onPress={onSyncNow}
          style={({ pressed, hovered }: any) => [
            styles.action,
            Platform.OS === 'web' && hovered && styles.actionHovered,
            pressed && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={sync.state === 'error' ? 'Retry sync' : 'Sync now'}
        >
          <Text style={styles.actionText}>{sync.state === 'error' ? 'Retry' : 'Sync now'}</Text>
        </Pressable>
      )}
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems:    'flex-start',
      gap:           10,
    },
    icon: { marginTop: 1 },
    body: { flex: 1, gap: 2 },
    text: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
    },
    detail: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      lineHeight: 16,
    },
    action: {
      paddingHorizontal: 12,
      paddingVertical:   6,
      borderRadius:      10,
      borderWidth:       1,
      borderColor:       t.border,
    },
    actionHovered: { backgroundColor: t.surface },
    actionText: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.semiBold,
      color:      t.textSub,
    },
  });
}
