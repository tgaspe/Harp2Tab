import { createJSONStorage } from 'zustand/middleware';

// Web: backed by localStorage
export const settingsStorage = createJSONStorage(() => localStorage);
