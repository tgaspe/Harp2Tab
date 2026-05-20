import { addAudioFrameListener, startCapture, stopCapture, setThreshold } from '@/native/AudioCapture';
import { createNoteDetector } from '@/audio/NoteDetector';
import { selectHarmonicaType, selectIsRecording, selectKey, useAppStore } from '@/store/useAppStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useEffect } from 'react';
import { PermissionsAndroid } from 'react-native';

export function useAudioCapture() {
  const isRecording        = useAppStore(selectIsRecording);
  const selectedKey        = useAppStore(selectKey);
  const harmonicaType      = useAppStore(selectHarmonicaType);
  const addTabNote         = useAppStore((s) => s.addTabNote);
  const recordingStartTime = useAppStore((s) => s.recordingStartTime);
  const stopRecording      = useAppStore((s) => s.stopRecording);
  const micSensitivity     = useSettingsStore((s) => s.micSensitivity);

  useEffect(() => {
    if (!isRecording || !selectedKey) {
      stopCapture();
      return;
    }

    let cancelled = false;
    let sub: ReturnType<typeof addAudioFrameListener> | null = null;

    (async () => {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      if (cancelled) return;
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        stopRecording();
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
}
