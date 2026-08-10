import {
  addAudioFrameListener, setMaxTakeMs, setRetaining, setRetentionFormat, setThreshold,
  startCapture, stopCapture,
} from '@/native/AudioCapture';
import { createNoteDetector } from '@/audio/NoteDetector';
import { pushFrame } from '@/audio/frameBuffer';
import { selectHarmonicaType, selectIsPaused, selectIsRecording, selectKey, selectRecordingId, useAppStore } from '@/store/useAppStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

export function useAudioCapture(): { permissionDenied: boolean } {
  const isRecording        = useAppStore(selectIsRecording);
  const isPaused           = useAppStore(selectIsPaused);
  const selectedKey        = useAppStore(selectKey);
  const harmonicaType      = useAppStore(selectHarmonicaType);
  const recordingId        = useAppStore(selectRecordingId);
  const addTabNote         = useAppStore((s) => s.addTabNote);
  const recordingStartTime = useAppStore((s) => s.recordingStartTime);
  const stopRecording      = useAppStore((s) => s.stopRecording);
  const micSensitivity     = useSettingsStore((s) => s.micSensitivity);
  const compactTakes       = useSettingsStore((s) => s.compactTakes);
  const maxTakeMinutes     = useSettingsStore((s) => s.maxTakeMinutes);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const isPausedRef  = useRef(isPaused);
  const detectorRef  = useRef<ReturnType<typeof createNoteDetector> | null>(null);
  const startMsRef   = useRef(0);

  useEffect(() => {
    if (!isRecording || !selectedKey) {
      stopCapture();
      return;
    }

    setPermissionDenied(false);
    let cancelled = false;
    let sub: ReturnType<typeof addAudioFrameListener> | null = null;

    (async () => {
      if (Platform.OS === 'web') {
        // On web, requesting the mic stream *is* the permission prompt —
        // there's no separate pre-check API. startCapture() is idempotent,
        // so calling it again below (once granted) is a harmless no-op.
        try {
          await startCapture();
        } catch {
          if (!cancelled) {
            stopRecording();
            setPermissionDenied(true);
          }
          return;
        }
      } else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        );
        if (cancelled) return;
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          stopRecording();
          setPermissionDenied(true);
          return;
        }
      }
      if (cancelled) return;

      setThreshold((micSensitivity / 100) * 0.05);
      // Set before the capture graph exists: the format is latched when the take starts,
      // so a later flip of the setting applies to the next take rather than corrupting
      // this one's buffer with two block types.
      setRetentionFormat(compactTakes ? 'int16' : 'float32');
      setMaxTakeMs(maxTakeMinutes * 60 * 1000);
      startCapture();

      const detector = createNoteDetector(
        (note) => addTabNote(note),
        selectedKey,
        harmonicaType,
      );
      detectorRef.current = detector;
      const startMs = recordingStartTime ?? Date.now();
      startMsRef.current = startMs;

      sub = addAudioFrameListener((frame) => {
        // Keep the native stream alive while paused — just stop feeding it
        // into detection so no notes get appended.
        if (isPausedRef.current) return;
        const now = Date.now();
        detector.process(frame, now, startMs);
        if (recordingId) {
          pushFrame(recordingId, { frequency: frame.frequency, rms: frame.rms, t: now - startMs });
        }
      });
    })();

    return () => {
      cancelled = true;
      sub?.remove();
      stopCapture();
      // Commit whatever note was still in flight when recording stopped —
      // otherwise the last note played before hitting Stop is silently lost,
      // since nothing else triggers its silence-grace commit.
      // Must run (and null the ref) before the [isPaused] effect below fires
      // its reset() on the same stopRecording() commit — do not reorder
      // these two effects, this ordering is what makes flush-before-discard
      // work when isRecording and isPaused flip together on Stop.
      detectorRef.current?.flush(startMsRef.current);
      detectorRef.current = null;
    };
  }, [isRecording]);

  // Keep the ref in sync so the frame listener (captured once above) always
  // sees the latest pause state, and clear in-flight detection state on every
  // pause/resume transition so a paused gap isn't misread as one continuous
  // silence or one continuous held note.
  useEffect(() => {
    isPausedRef.current = isPaused;
    detectorRef.current?.reset();
    // Paused audio is dropped rather than kept, which is what keeps the retained take
    // aligned with the live timeline: the elapsed clock already discounts pauses, so
    // recording the silence would slide every note after a pause later than the HUD
    // showed it.
    setRetaining(!isPaused);
  }, [isPaused]);

  // Live sensitivity adjustment while recording
  useEffect(() => {
    if (isRecording) setThreshold((micSensitivity / 100) * 0.05);
  }, [micSensitivity, isRecording]);

  return { permissionDenied };
}
