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
  /** `'destructive'` tints the pill red, matching the destructive rows in
   *  `ActionSheetModal`. It changes appearance only — an action that deletes something
   *  still has to ask for confirmation itself. */
  variant?: 'default' | 'destructive';
}

interface HeaderActionState {
  actions: HeaderAction[];
  /** Pathname of the screen these belong to; `TopBar` renders them only there. */
  route:   string | null;
  setHeaderActions:   (route: string, actions: HeaderAction[]) => void;
  clearHeaderActions: () => void;
  /** Clear, but only if `route` still owns the slot — see below. */
  clearHeaderActionsFor: (route: string) => void;
}

export const useHeaderActionStore = create<HeaderActionState>()((set, get) => ({
  actions: [],
  route:   null,
  setHeaderActions:   (route, actions) => set({ route, actions }),
  clearHeaderActions: () => set({ route: null, actions: [] }),

  /**
   * The safe cleanup for a `useFocusEffect`, and what a screen should use instead of the
   * unconditional clear.
   *
   * Two screens that navigate to each other both register actions, and React Navigation
   * gives no ordering guarantee between the old screen's blur and the new screen's focus.
   * An unconditional clear running second wipes the incoming screen's buttons and leaves
   * the header empty until something re-renders. Checking ownership first makes the order
   * irrelevant: a screen can only ever clear its own actions.
   */
  clearHeaderActionsFor: (route) => {
    if (get().route === route) set({ route: null, actions: [] });
  },
}));

/** Stable reference, so a route with no actions doesn't re-render TopBar every store tick. */
const EMPTY: HeaderAction[] = [];

/** Only what the given route owns — see the `route` note above. */
export function selectHeaderActions(pathname: string) {
  return (s: HeaderActionState) => (s.route === pathname ? s.actions : EMPTY);
}
