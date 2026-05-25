import { darkTheme, lightTheme } from '@/theme';
import { useSettingsStore } from '@/store/useSettingsStore';

export function useTheme() {
  const themeOverride = useSettingsStore((s) => s.themeOverride);
  return themeOverride === 'dark' ? darkTheme : lightTheme;
}
