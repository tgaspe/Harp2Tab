import React from 'react';
import { Platform, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Divider, IconButton, Tooltip } from '@/components/EditControls';
import type { Theme } from '@/theme';
import type { EditStyles } from '@/app/editStyles';
import type { EditHistory } from '@/hooks/useEditHistory';

/**
 * The editor's transport bar, shared by the tab editor and the MIDI Studio.
 *
 * Its own module rather than a `WebTransportBar` export on the edit route: the Studio
 * renders exactly this bar, and reaching it through `@/app/edit` meant importing that
 * screen — every store subscription, modal and sidebar in it — to draw a play button.
 */
export function WebTransportBar({
  tabNotesLength, isPlaying, isPaused, onPlayToggle, onStop, onSkipBack, onSkipForward,
  currentTimeMs, totalTimeMs, formatElapsed,
  loopEnabled, onToggleLoop, playbackRate, onCycleRate,
  bpm, setBpm, startControl, metronomeEnabled, onToggleMetronome, history, glued, containerStyle, compact, theme, styles,
  instrumentsLoading = false,
}: {
  /** Sampled instruments are still arriving. Shown rather than hidden because the alternative
   *  is a play press that looks like it did nothing; the transport is never disabled by it,
   *  and playback starts on oscillators if the samples are slow. */
  instrumentsLoading?: boolean;
  tabNotesLength: number;
  isPlaying: boolean;
  isPaused: boolean;
  onPlayToggle: () => void;
  onStop: () => void;
  /** Jump the playhead back/forward one full bar — works while stopped, paused, or mid-playback. */
  onSkipBack: () => void;
  onSkipForward: () => void;
  currentTimeMs: number;
  totalTimeMs: number;
  formatElapsed: (ms: number) => string;
  loopEnabled: boolean;
  onToggleLoop: () => void;
  playbackRate: number;
  onCycleRate: () => void;
  bpm: number;
  setBpm: (bpm: number) => void;
  /**
   * Rendered immediately right of the BPM stepper, in the same pill.
   *
   * The Studio's "Start" field lives here: where the arrangement's first note sits is a
   * fact about the whole project, exactly like its tempo, so the two belong in one cluster.
   * Optional because the tab editor has no arrangement to slide — a tab is one voice that
   * already begins where it begins.
   */
  startControl?: React.ReactNode;
  metronomeEnabled: boolean;
  onToggleMetronome: () => void;
  /**
   * Undo/redo controls, rendered at the right end of the bar when supplied.
   *
   * Optional because the tab editor already has these in its own toolbar and sidebar —
   * a second pair would be redundant there. The Studio has no toolbar of its own by
   * design (see the note at the top of `studio.tsx`), so this is where its history
   * becomes clickable rather than keyboard-only.
   */
  history?: EditHistory;
  /** True in piano-roll mode — sits flush against the data panel above it (no gap, no
   *  separating line) instead of floating below it like it does over the list view. */
  glued?: boolean;
  /**
   * Applied last, so a host that isn't `edit.tsx` can undo its layout compensations.
   *
   * `webTransportBar` carries three negative margins whose only job is to cancel this
   * screen's container padding (`marginHorizontal: -24`, `marginBottom:
   * -WEB_SCREEN_PADDING_BOTTOM`) and its `gap: 16` (`glued`'s `marginTop: -16`). In a host
   * without that padding they don't cancel anything — they pull the bar outside its own
   * box, which reads as the contents sitting off-centre.
   */
  containerStyle?: StyleProp<ViewStyle>;
  /**
   * Shorter bar: tighter vertical padding and a smaller play button (48px tall instead of
   * 68px). Exists as a flag rather than something `containerStyle` could do, because the
   * height is set by the play circle as much as by the padding, and a caller can't reach
   * a nested child's style from the outside.
   */
  compact?: boolean;
  theme: Theme;
  styles: EditStyles;
}) {
  // A real transport: Loop / Tempo / Metronome / Skip / Stop / Play-Pause / Speed /
  // elapsed-of-total time. Undo, New, Add, Export, Save, Inspect all live in the top
  // toolbar now — this bar is only about hearing the tab. Three-column layout
  // (side / controls / side), both sides flex:1, so the center controls stay
  // dead-centered regardless of what either side's content weighs — space-between
  // would instead push them off-center.
  const disabled = tabNotesLength === 0;
  // Every tooltip in this bar opens upward: the bar is pinned to the bottom edge of the
  // screen in both hosts (`edit.tsx`, `studio.tsx`), so the default downward placement
  // draws the label past the viewport, where it is simply cut off.
  const tip = 'above' as const;
  return (
    <View style={[styles.webTransportBar, glued && styles.webTransportBarGlued, compact && styles.webTransportBarCompact, containerStyle]}>
      <View style={styles.webTransportSide}>
        <View style={styles.webTransportGroup}>
          <IconButton
            icon="repeat"
            label={loopEnabled ? 'Disable loop' : 'Enable loop'}
            onPress={onToggleLoop}
            disabled={disabled}
            variant={loopEnabled ? 'active' : 'ghost'}
            selected={loopEnabled}
            tooltipPlacement={tip}
            theme={theme}
            styles={styles}
          />
          <Divider styles={styles} />
          <View style={styles.webBpmControl}>
            <Pressable onPress={() => setBpm(bpm - 1)} disabled={disabled} style={styles.webMiniStepBtn} accessibilityRole="button" accessibilityLabel="Decrease tempo">
              <Ionicons name="remove" size={12} color={disabled ? theme.textMuted : theme.textSub} />
            </Pressable>
            <Text style={[styles.webBpmValue, disabled && { color: theme.textMuted }]}>{bpm} BPM</Text>
            <Pressable onPress={() => setBpm(bpm + 1)} disabled={disabled} style={styles.webMiniStepBtn} accessibilityRole="button" accessibilityLabel="Increase tempo">
              <Ionicons name="add" size={12} color={disabled ? theme.textMuted : theme.textSub} />
            </Pressable>
          </View>
          {startControl !== undefined && (
            <>
              <Divider styles={styles} />
              {startControl}
            </>
          )}
          <IconButton
            icon="musical-notes"
            label={metronomeEnabled ? 'Disable metronome' : 'Enable metronome'}
            onPress={onToggleMetronome}
            disabled={disabled}
            variant={metronomeEnabled ? 'active' : 'ghost'}
            selected={metronomeEnabled}
            tooltipPlacement={tip}
            theme={theme}
            styles={styles}
          />
        </View>
      </View>

      <View style={styles.webTransportCenter}>
        <IconButton icon="play-skip-back" label="Back one bar" onPress={onSkipBack} disabled={disabled} tooltipPlacement={tip} theme={theme} styles={styles} iconSize={13} />
        <IconButton icon="stop" label="Stop" onPress={onStop} disabled={disabled} tooltipPlacement={tip} theme={theme} styles={styles} iconSize={13} />
        <Pressable
          onPress={onPlayToggle}
          disabled={disabled}
          style={({ pressed, hovered }: any) => [
            styles.webPlayCircle,
            compact && styles.webPlayCircleCompact,
            disabled && styles.webPlayCircleDisabled,
            (pressed || hovered) && !disabled && styles.webPlayCircleHover,
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            instrumentsLoading && !isPlaying ? 'Loading instruments'
              : isPlaying && !isPaused ? 'Pause' : isPaused ? 'Resume' : 'Play tab'
          }
          accessibilityState={{ disabled, busy: instrumentsLoading }}
          {...(Platform.OS === 'web' && instrumentsLoading && !isPlaying
            ? ({ title: 'Loading instruments…' } as any)
            : null)}
        >
          <Ionicons
            name={instrumentsLoading && !isPlaying
              ? 'ellipsis-horizontal'
              : isPlaying && !isPaused ? 'pause' : 'play'}
            size={compact ? 14 : 17}
            color={disabled ? theme.textMuted : '#fff'}
          />
        </Pressable>
        <IconButton icon="play-skip-forward" label="Forward one bar" onPress={onSkipForward} disabled={disabled} tooltipPlacement={tip} theme={theme} styles={styles} iconSize={13} />
      </View>

      <View style={[styles.webTransportSide, styles.webTransportSideRight]}>
        <View style={styles.webTransportGroup}>
          {history && (
            <>
              <IconButton
                icon="arrow-undo"
                label="Undo"
                onPress={history.undo}
                disabled={!history.canUndo}
                tooltipPlacement={tip}
                theme={theme}
                styles={styles}
                iconSize={13}
              />
              <IconButton
                icon="arrow-redo"
                label="Redo"
                onPress={history.redo}
                disabled={!history.canRedo}
                tooltipPlacement={tip}
                theme={theme}
                styles={styles}
                iconSize={13}
              />
              <Divider styles={styles} />
            </>
          )}
          {/* The one control in the bar that renders its own text rather than an icon, and
              so the one that had no tooltip: "1x" says what the speed is, not that the
              button changes it. */}
          <Tooltip label="Playback speed" placement={tip} disabled={disabled} styles={styles}>
            {(hoverProps) => (
              <Pressable
                onPress={onCycleRate}
                disabled={disabled}
                {...hoverProps}
                style={({ hovered }: any) => [styles.webSpeedBtn, !disabled && hovered && styles.webIconBtnHover]}
                accessibilityRole="button"
                accessibilityLabel={`Playback speed: ${playbackRate}x. Tap to change.`}
              >
                <Text style={[styles.webSpeedBtnText, disabled && { color: theme.textMuted }]}>{playbackRate}x</Text>
              </Pressable>
            )}
          </Tooltip>
          <Text style={styles.webPlayTime}>
            {formatElapsed(currentTimeMs)} / {formatElapsed(totalTimeMs)}
          </Text>
        </View>
      </View>
    </View>
  );
}
