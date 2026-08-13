import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

// Native: backed by AsyncStorage
export const settingsStorage = createJSONStorage(() => AsyncStorage);
export const recordingsStorage = createJSONStorage(() => AsyncStorage);
export const midiProjectsStorage = createJSONStorage(() => AsyncStorage);
export const authStorage = createJSONStorage(() => AsyncStorage);
