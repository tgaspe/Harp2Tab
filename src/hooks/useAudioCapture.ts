import { addAudioFrameListener, startCapture, stopCapture, setThreshold } from '@/native/AudioCapture';
import { createNoteDetector } from '@/audio/NoteDetector';
import { selectHarmonicaType, selectIsPaused, selectIsRecording, selectKey, useAppStore } from '@/store/useAppStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useEffect, useRef, useState } from 'react';
import { PermissionsAndroid } from 'react-native';

export function useAudioCapture(): { permissionDenied: boolean } {
  const isRecording        = useAppStore(selectIsRecording);
  const isPaused           = useAppStore(selectIsPaused);
  const selectedKey        = useAppStore(selectKey);
  const harmonicaType      = useAppStore(selectHarmonicaType);
  const addTabNote         = useAppStore((s) => s.addTabNote);
  const recordingStartTime = useAppStore((s) => s.recordingStartTime);
  const stopRecording      = useAppStore((s) => s.stopRecording);
  const micSensitivity     = useSettingsStore((s) => s.micSensitivity);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const isPausedRef  = useRef(isPaused);
  const detectorRef  = useRef<ReturnType<typeof createNoteDetector> | null>(null);

  useEffect(() => {
    if (!isRecording || !selectedKey) {
      stopCapture();
      return;
    }

    setPermissionDenied(false);
    let cancelled = false;
    let sub: ReturnType<typeof addAudioFrameListener> | null = null;

    (async () => {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      if (cancelled) return;
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        stopRecording();
        setPermissionDenied(true);
        return;
      }

      setThreshold((micSensitivity / 100) * 0.05);
      startCapture();

      const detector = createNoteDetector(
        (note) => addTabNote(note),
        selectedKey,
        harmonicaType,
      );
      detectorRef.current = detector;
      const startMs = recordingStartTime ?? Date.now();

      sub = addAudioFrameListener((frame) => {
        // Keep the native stream alive while paused — just stop feeding it
        // into detection so no notes get appended.
        if (isPausedRef.current) return;
        detector.process(frame, startMs);
      });
    })();

    return () => {
      cancelled = true;
      sub?.remove();
      stopCapture();
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
  }, [isPaused]);

  // Live sensitivity adjustment while recording
  useEffect(() => {
    if (isRecording) setThreshold((micSensitivity / 100) * 0.05);
  }, [micSensitivity, isRecording]);

  return { permissionDenied };
}
