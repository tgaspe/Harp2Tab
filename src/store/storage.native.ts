import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

// Native: backed by AsyncStorage
export const settingsStorage = createJSONStorage(() => AsyncStorage);
