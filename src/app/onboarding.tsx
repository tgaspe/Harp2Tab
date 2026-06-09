import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import { addAudioFrameListener, startCapture, stopCapture, setThreshold } from '@/native/AudioCapture';
import { useSettingsStore } from '@/store/useSettingsStore';
import type { Theme } from '@/theme';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PermissionsAndroid } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ── Calibration constants ────────────────────────────────────────────────────
const SILENCE_DURATION_MS  = 3000;
const BLOW_WINDOW_MS       = 5000;
const NOISE_GATE_MULT      = 2.0;
const THRESHOLD_BLOW_MULT  = 0.50;
const THRESHOLD_FLOOR_MULT = 3.0;
const NOISE_FLOOR_MIN      = 0.005;
const MAX_NATIVE_THRESHOLD = 0.05;
const CLIPPING_RMS         = 0.04;

type CalibrationStep = 'permission' | 'silence' | 'blow' | 'result' | 'denied';

export default function OnboardingScreen() {
  const router  = useRouter();
  const theme   = useTheme();
  const styles  = useMemo(() => createStyles(theme), [theme]);
  const { skipPermission } = useLocalSearchParams<{ skipPermission?: string }>();

  const hasCompletedOnboarding    = useSettingsStore((s) => s.hasCompletedOnboarding);
  const setMicSensitivity        = useSettingsStore((s) => s.setMicSensitivity);
  const setHasCompletedOnboarding = useSettingsStore((s) => s.setHasCompletedOnboarding);

  const [step,            setStep]            = useState<CalibrationStep>('permission');
  const [countdownSec,    setCountdownSec]    = useState(0);
  const [calibratedValue, setCalibratedValue] = useState(0);
  const [blowDetected,    setBlowDetected]    = useState(false);
  const [blowStarted,     setBlowStarted]     = useState(false);

  const noiseFloorRef    = useRef(0);
  const rmsBuffer        = useRef<number[]>([]);
  const activeSamples    = useRef<number[]>([]);
  const meterAnim        = useRef(new Animated.Value(0)).current;
  const listenerRef      = useRef<ReturnType<typeof addAudioFrameListener> | null>(null);
  const intervalRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Guard: returning users can only reach this via Settings ──────────────
  useEffect(() => {
    if (hasCompletedOnboarding && skipPermission !== 'true') {
      router.replace('/');
    } else if (skipPermission === 'true') {
      beginSilenceMeasurement();
    }
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      listenerRef.current?.remove();
      stopCapture();
    };
  }, []);

  // ── Step: permission ──────────────────────────────────────────────────────
  async function requestPermission() {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    if (result === PermissionsAndroid.RESULTS.GRANTED) {
      beginSilenceMeasurement();
    } else {
      setStep('denied');
    }
  }

  // ── Step: silence (3 s) ───────────────────────────────────────────────────
  function beginSilenceMeasurement() {
    rmsBuffer.current = [];
    setCountdownSec(Math.ceil(SILENCE_DURATION_MS / 1000));
    setStep('silence');

    setThreshold(0);
    startCapture();

    listenerRef.current = addAudioFrameListener((frame) => {
      rmsBuffer.current.push(frame.rms);
    });

    let elapsed = 0;
    intervalRef.current = setInterval(() => {
      elapsed += 1000;
      const remaining = Math.ceil((SILENCE_DURATION_MS - elapsed) / 1000);
      setCountdownSec(Math.max(remaining, 0));
      if (elapsed >= SILENCE_DURATION_MS) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        finishSilence();
      }
    }, 1000);
  }

  function finishSilence() {
    listenerRef.current?.remove();
    listenerRef.current = null;

    const buf = rmsBuffer.current;
    const avg = buf.length > 0 ? buf.reduce((a, b) => a + b, 0) / buf.length : 0;
    noiseFloorRef.current = Math.max(avg, NOISE_FLOOR_MIN);

    beginBlowWindow();
  }

  // ── Step: blow — show instructions, wait for user to tap Ready ───────────
  function beginBlowWindow() {
    activeSamples.current = [];
    setBlowStarted(false);
    setBlowDetected(false);
    setCountdownSec(Math.ceil(BLOW_WINDOW_MS / 1000));
    setStep('blow');
  }

  function startBlowCountdown() {
    setBlowStarted(true);

    const gate = noiseFloorRef.current * NOISE_GATE_MULT;

    listenerRef.current = addAudioFrameListener((frame) => {
      const fill = Math.min(frame.rms / CLIPPING_RMS, 1);
      Animated.spring(meterAnim, {
        toValue: fill,
        useNativeDriver: false,
        speed: 50,
        bounciness: 0,
      }).start();

      if (frame.rms > gate) {
        activeSamples.current.push(frame.rms);
        setBlowDetected(true);
      }
    });

    let elapsed = 0;
    intervalRef.current = setInterval(() => {
      elapsed += 1000;
      const remaining = Math.ceil((BLOW_WINDOW_MS - elapsed) / 1000);
      setCountdownSec(Math.max(remaining, 0));
      if (elapsed >= BLOW_WINDOW_MS) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        finishBlow();
      }
    }, 1000);
  }

  function finishBlow() {
    listenerRef.current?.remove();
    listenerRef.current = null;
    stopCapture();

    const samples = activeSamples.current;
    const activeAvg = samples.length > 0
      ? samples.reduce((a, b) => a + b, 0) / samples.length
      : 0;

    const sensitivity = samples.length === 0
      ? 0
      : Math.min(
          Math.round(
            (Math.max(
              activeAvg * THRESHOLD_BLOW_MULT,
              noiseFloorRef.current * THRESHOLD_FLOOR_MULT,
            ) / MAX_NATIVE_THRESHOLD) * 100,
          ),
          100,
        );

    setCalibratedValue(sensitivity);
    setStep('result');
  }

  // ── Step: result — retry calibration ─────────────────────────────────────
  function retry() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    listenerRef.current?.remove();
    listenerRef.current = null;
    noiseFloorRef.current = 0;
    beginSilenceMeasurement();
  }

  // ── Step: result — commit and proceed ────────────────────────────────────
  function finish() {
    setMicSensitivity(calibratedValue);
    setHasCompletedOnboarding(true);
    router.replace('/');
  }

  // ── Step: denied — skip with defaults ────────────────────────────────────
  function skip() {
    setHasCompletedOnboarding(true);
    router.replace('/');
  }

  // ── Meter color ───────────────────────────────────────────────────────────
  const goodThresholdFill = Math.min(
    (noiseFloorRef.current * THRESHOLD_FLOOR_MULT) / CLIPPING_RMS,
    0.85,
  );

  const meterColor = meterAnim.interpolate({
    inputRange:  [0, goodThresholdFill, 0.85, 1],
    outputRange: [theme.textMuted, theme.accent, theme.accent, theme.record],
    extrapolate: 'clamp',
  });

  // ── Step dots ─────────────────────────────────────────────────────────────
  const stepIndex = { permission: 0, silence: 1, blow: 2, result: 3, denied: 0 }[step];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>

        {/* Step dots */}
        <View style={styles.dots}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={[styles.dot, i <= stepIndex && step !== 'denied' && styles.dotActive]}
            />
          ))}
        </View>

        {/* ── Permission ── */}
        {step === 'permission' && (
          <StepCard
            icon="mic-outline"
            title="Mic Calibration"
            body={
              'Harp2Tab needs a moment to learn your environment.\n\n' +
              'First, we\'ll need access to your microphone.'
            }
            theme={theme}
            styles={styles}
          >
            <Pressable
              style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
              onPress={requestPermission}
            >
              <Text style={styles.btnText}>Allow Microphone</Text>
            </Pressable>
          </StepCard>
        )}

        {/* ── Silence ── */}
        {step === 'silence' && (
          <StepCard
            icon="volume-mute-outline"
            title="Stay Quiet"
            body={'Set down your harmonica and stay still.\nMeasuring your environment\'s noise floor…'}
            theme={theme}
            styles={styles}
          >
            <View style={styles.countdown}>
              <Text style={styles.countdownNumber}>{countdownSec}</Text>
              <Text style={styles.countdownLabel}>seconds remaining</Text>
            </View>
          </StepCard>
        )}

        {/* ── Blow ── */}
        {step === 'blow' && (
          <StepCard
            icon="musical-note-outline"
            title="Blow Hole 1"
            body={'Pick up your harmonica and blow hole 1 a few times.\nTry to play at your normal volume.'}
            theme={theme}
            styles={styles}
          >
            {!blowStarted ? (
              <Pressable
                style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
                onPress={startBlowCountdown}
              >
                <Text style={styles.btnText}>I'm Ready</Text>
              </Pressable>
            ) : (
              <>
                {/* Live RMS meter */}
                <View style={styles.meterTrack}>
                  <Animated.View
                    style={[
                      styles.meterFill,
                      {
                        width: meterAnim.interpolate({
                          inputRange:  [0, 1],
                          outputRange: ['0%', '100%'],
                        }),
                        backgroundColor: meterColor,
                      },
                    ]}
                  />
                  {/* Good-zone marker */}
                  <View style={[styles.meterMarker, { left: `${goodThresholdFill * 100}%` as any }]} />
                </View>
                <View style={styles.meterLabels}>
                  <Text style={styles.meterLabelLeft}>Too quiet</Text>
                  <Text style={styles.meterLabelRight}>Good</Text>
                </View>

                <View style={[styles.countdown, { marginTop: 24 }]}>
                  <Text style={styles.countdownNumber}>{countdownSec}</Text>
                  <Text style={styles.countdownLabel}>
                    {blowDetected ? 'seconds — keep going!' : 'seconds remaining'}
                  </Text>
                </View>
              </>
            )}
          </StepCard>
        )}

        {/* ── Result ── */}
        {step === 'result' && (
          <StepCard
            icon={blowDetected ? 'checkmark-circle-outline' : 'alert-circle-outline'}
            title={blowDetected ? 'All Set!' : 'No Blow Detected'}
            body={
              blowDetected
                ? `Mic sensitivity set to ${calibratedValue}%.\n\nYou can always adjust this later in Settings.`
                : 'We couldn\'t detect a blow. Mic sensitivity has been set to 0%.\n\nYou can retry or adjust it manually in Settings.'
            }
            theme={theme}
            styles={styles}
          >
            <Pressable
              style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
              onPress={finish}
            >
              <Text style={styles.btnText}>Start Using Harp2Tab</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.btnGhost, pressed && { opacity: 0.5 }]}
              onPress={retry}
            >
              <Text style={styles.btnGhostText}>Try Again</Text>
            </Pressable>
          </StepCard>
        )}

        {/* ── Denied ── */}
        {step === 'denied' && (
          <StepCard
            icon="mic-off-outline"
            title="Microphone Access Needed"
            body={
              'Harp2Tab records audio to detect harmonica notes.\n\n' +
              'Please allow microphone access in Settings, or skip calibration and adjust sensitivity manually later.'
            }
            theme={theme}
            styles={styles}
          >
            <Pressable
              style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
              onPress={() => Linking.openSettings()}
            >
              <Text style={styles.btnText}>Open Settings</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.btnGhost, pressed && { opacity: 0.5 }]}
              onPress={skip}
            >
              <Text style={styles.btnGhostText}>Skip for now</Text>
            </Pressable>
          </StepCard>
        )}

      </View>
    </SafeAreaView>
  );
}

// ── Shared card wrapper ───────────────────────────────────────────────────────

function StepCard({
  icon, title, body, theme, styles, children,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  theme: Theme;
  styles: ReturnType<typeof createStyles>;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={48} color={theme.accent} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

function createStyles(t: Theme) {
  return StyleSheet.create({
    safe:      { flex: 1, backgroundColor: t.bg },
    container: {
      flex: 1,
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: 32,
      justifyContent: 'center',
    },

    dots: {
      flexDirection:  'row',
      justifyContent: 'center',
      gap:            8,
      marginBottom:   40,
    },
    dot: {
      width:        8,
      height:       8,
      borderRadius: 4,
      backgroundColor: t.surfaceAlt,
    },
    dotActive: { backgroundColor: t.accent },

    card: {
      backgroundColor: t.surface,
      borderRadius:    20,
      padding:         28,
      gap:             0,
    },
    iconWrap: {
      width:           72,
      height:          72,
      borderRadius:    36,
      backgroundColor: t.accentSoft,
      alignItems:      'center',
      justifyContent:  'center',
      marginBottom:    20,
    },
    title: {
      fontSize:      FONT.xl,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textPrimary,
      marginBottom:  12,
    },
    body: {
      fontSize:   FONT.base,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      lineHeight: 24,
      marginBottom: 28,
    },
    actions: { gap: 12 },

    btn: {
      backgroundColor: t.accent,
      borderRadius:    12,
      paddingVertical: 16,
      alignItems:      'center',
    },
    btnPressed:  { backgroundColor: t.accentDim },
    btnText: {
      fontSize:   FONT.md,
      fontFamily: Poppins.bold,
      color:      '#fff',
    },
    btnGhost: {
      paddingVertical: 12,
      alignItems:      'center',
    },
    btnGhostText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
      color:      t.textMuted,
    },

    countdown: {
      alignItems: 'center',
      gap: 4,
    },
    countdownNumber: {
      fontSize:   FONT['2xl'],
      fontFamily: SpaceGrotesk.bold,
      color:      t.textPrimary,
    },
    countdownLabel: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textSub,
    },

    meterTrack: {
      height:          16,
      backgroundColor: t.surfaceAlt,
      borderRadius:    8,
      overflow:        'hidden',
      position:        'relative',
    },
    meterFill: {
      position:     'absolute',
      left:         0,
      top:          0,
      bottom:       0,
      borderRadius: 8,
    },
    meterMarker: {
      position:        'absolute',
      top:             0,
      bottom:          0,
      width:           2,
      backgroundColor: t.border,
    },
    meterLabels: {
      flexDirection:  'row',
      justifyContent: 'space-between',
      marginTop:      6,
    },
    meterLabelLeft: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
    },
    meterLabelRight: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.accent,
    },
  });
}
