import { Platform, type ViewStyle } from 'react-native';

// Max content width per screen "class" on web — mobile ignores this entirely.
export const WEB_CONTENT_WIDTH = {
  narrow:   480, // paywall, onboarding — focused single-CTA flows
  compact:  560, // index — segmented control + fixed-size KeyGrid + CTA
  standard: 720, // recording, edit, export — list/table-preserving single column
  wide:     960, // settings — multi-column card grid
} as const;

export function webMaxWidth(px: number): ViewStyle {
  return Platform.OS === 'web'
    ? { maxWidth: px, width: '100%', alignSelf: 'center' }
    : {};
}

export const WEB_SCREEN_PADDING_TOP    = 20;
export const WEB_SCREEN_PADDING_BOTTOM = 20;
