// Web-only HTML shell (Expo Router picks this up for the static web output). It exists
// for one reason: scrollbars.
//
// `showsHorizontalScrollIndicator`/`showsVerticalScrollIndicator` on a ScrollView are
// honored by react-native-web, but macOS renders *overlay* scrollbars by default — the OS
// fades them out whenever you aren't actively scrolling, and no amount of RN props
// overrides that. Declaring an explicit `::-webkit-scrollbar` width is what opts a
// scroll container out of overlay behavior and into a persistent, classic scrollbar, so
// the piano roll's horizontal scroll (and the grid's vertical one) always advertise that
// there's more content off-screen.
//
// Styled to match the app's zinc surfaces rather than the browser default, and split by
// prefers-color-scheme since this file is static and can't read the runtime theme.
import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

const scrollbarCss = `
:root { color-scheme: light dark; }

/* Firefox */
* { scrollbar-width: thin; scrollbar-color: rgba(0,0,0,0.28) transparent; }

/* WebKit/Blink — an explicit size is what disables macOS overlay auto-hiding. */
::-webkit-scrollbar { width: 11px; height: 11px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-corner { background: transparent; }
::-webkit-scrollbar-thumb {
  background-color: rgba(0,0,0,0.28);
  border-radius: 6px;
  /* Transparent border + background-clip insets the thumb so it reads as a slim pill
     inside the track rather than filling the full gutter edge to edge. */
  border: 3px solid transparent;
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover { background-color: rgba(0,0,0,0.45); }

@media (prefers-color-scheme: dark) {
  * { scrollbar-color: rgba(255,255,255,0.24) transparent; }
  ::-webkit-scrollbar-thumb { background-color: rgba(255,255,255,0.24); }
  ::-webkit-scrollbar-thumb:hover { background-color: rgba(255,255,255,0.4); }
}
`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        {/* Expo's own reset — keeps body scroll behavior sane. Must stay before our CSS. */}
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: scrollbarCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
