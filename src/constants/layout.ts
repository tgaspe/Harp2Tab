import { Platform, type ViewStyle } from 'react-native';

// Max content width per screen "class" on web — mobile ignores this entirely.
export const WEB_CONTENT_WIDTH = {
  narrow:   480, // paywall, onboarding — focused single-CTA flows
  compact:  560, // index — segmented control + fixed-size KeyGrid + CTA
  standard: 720, // recording, edit, export — list/table-preserving single column
  wide:     960, // settings — multi-column card grid
  // profile — a two-pane account page pays for its width twice over: a nav column, then a
  // prose column inside every section. At `wide` the controls end up in ~440px with the
  // rest of a desktop display left empty, which is what makes a web page read as a phone
  // screen with margins. Capped rather than fluid so a 27" display doesn't stretch a
  // field row into a horizon.
  full:     1280,
} as const;

export function webMaxWidth(px: number): ViewStyle {
  return Platform.OS === 'web'
    ? { maxWidth: px, width: '100%', alignSelf: 'center' }
    : {};
}

export const WEB_SCREEN_PADDING_TOP    = 20;
export const WEB_SCREEN_PADDING_BOTTOM = 20;
