import { create } from 'zustand';

/**
 * A slot the current screen can put one action into for the global `TopBar` to render.
 *
 * `TopBar` lives in the root layout, outside every screen's tree, so it can't reach a
 * screen's handlers directly. The editor already solves the same problem for its
 * List/Piano-Roll toggle by parking `viewMode` in the shared store; this is the general
 * form of that, for a screen that wants a button in the app header rather than its own
 * row of chrome.
 *
 * Deliberately a single slot, not a list: the header has room for one screen action next
 * to the gear, and a queue would just be a way to overflow it silently.
 */
export interface HeaderAction {
  /** Ionicons name. */
  icon:    string;
  label:   string;
  onPress: () => void;
  disabled?: boolean;
}

interface HeaderActionState {
  action: HeaderAction | null;
  setHeaderAction:   (action: HeaderAction | null) => void;
  clearHeaderAction: () => void;
}

export const useHeaderActionStore = create<HeaderActionState>()((set) => ({
  action: null,
  setHeaderAction:   (action) => set({ action }),
  clearHeaderAction: () => set({ action: null }),
}));

export const selectHeaderAction = (s: HeaderActionState) => s.action;
