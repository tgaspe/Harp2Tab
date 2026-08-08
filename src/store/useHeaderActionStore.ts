import { create } from 'zustand';

/**
 * Actions the current screen can put into the global `TopBar`.
 *
 * `TopBar` lives in the root layout, outside every screen's tree, so it can't reach a
 * screen's handlers directly. The editor already solves the same problem for its
 * List/Piano-Roll toggle by parking `viewMode` in the shared store; this is the general
 * form of that, for a screen that wants buttons in the app header rather than its own
 * row of chrome.
 *
 * Actions render left-to-right in array order.
 *
 * `route` is what stops an action outliving the screen that set it. Screens are pushed,
 * not replaced, so a screen that navigates onward stays mounted and its cleanup never
 * runs — which is exactly how the Studio's Export button ended up rendering on the tab
 * editor and on Settings. Registering the owning route means `TopBar` can ignore
 * anything that isn't the current screen's, whether or not cleanup happened.
 */
export interface HeaderAction {
  /** Stable per-action key, for React's list reconciliation. */
  key:     string;
  /** Ionicons name. */
  icon:    string;
  label:   string;
  onPress: () => void;
  disabled?: boolean;
}

interface HeaderActionState {
  actions: HeaderAction[];
  /** Pathname of the screen these belong to; `TopBar` renders them only there. */
  route:   string | null;
  setHeaderActions:   (route: string, actions: HeaderAction[]) => void;
  clearHeaderActions: () => void;
}

export const useHeaderActionStore = create<HeaderActionState>()((set) => ({
  actions: [],
  route:   null,
  setHeaderActions:   (route, actions) => set({ route, actions }),
  clearHeaderActions: () => set({ route: null, actions: [] }),
}));

/** Stable reference, so a route with no actions doesn't re-render TopBar every store tick. */
const EMPTY: HeaderAction[] = [];

/** Only what the given route owns — see the `route` note above. */
export function selectHeaderActions(pathname: string) {
  return (s: HeaderActionState) => (s.route === pathname ? s.actions : EMPTY);
}
