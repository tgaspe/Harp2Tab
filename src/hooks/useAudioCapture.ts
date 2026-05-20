import { addAudioFrameListener, startCapture, stopCapture, setThreshold } from '@/native/AudioCapture';
import { createNoteDetector } from '@/audio/NoteDetector';
import { selectHarmonicaType, selectIsRecording, selectKey, useAppStore } from '@/store/useAppStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useEffect, useState } from 'react';
import { PermissionsAndroid } from 'react-native';

export function useAudioCapture(): { permissionDenied: boolean } {
  const isRecording        = useAppStore(selectIsRecording);
  const selectedKey        = useAppStore(selectKey);
  const harmonicaType      = useAppStore(selectHarmonicaType);
  const addTabNote         = useAppStore((s) => s.addTabNote);
  const recordingStartTime = useAppStore((s) => s.recordingStartTime);
  const stopRecording      = useAppStore((s) => s.stopRecording);
  const micSensitivity     = useSettingsStore((s) => s.micSensitivity);
  const [permissionDenied, setPermissionDenied] = useState(false);

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
      const startMs = recordingStartTime ?? Date.now();

      sub = addAudioFrameListener((frame) => {
        detector.process(frame, startMs);
      });
    })();

    return () => {
      cancelled = true;
      sub?.remove();
      stopCapture();
    };
  }, [isRecording]);

  // Live sensitivity adjustment while recording
  useEffect(() => {
    if (isRecording) setThreshold((micSensitivity / 100) * 0.05);
  }, [micSensitivity, isRecording]);

  return { permissionDenied };
}
