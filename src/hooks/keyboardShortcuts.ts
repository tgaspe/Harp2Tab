import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Platform } from 'react-native';

/**
 * Screen-level web keyboard shortcuts, and the guard they share.
 *
 * Every shortcut here binds on **focus**, not on mount, for the reason spelled out in
 * `useUndoRedoShortcuts`: screens are pushed rather than replaced, so a screen left behind
 * is still mounted with its effects alive, and a mount-scoped `window` listener would keep
 * answering keys meant for whatever the user is actually looking at.
 */

/** Shared by the shortcuts that must not fire while the user is typing. */
export function isTextInput(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/**
 * Ctrl/Cmd+S to save what's open — the tab session in the editor, the project in the Studio.
 *
 * Deliberately *not* guarded by `isTextInput`, unlike undo/redo. That guard exists to leave a
 * field's own native behaviour alone, and a text field has no native Cmd+S to protect; a save
 * shortcut that quietly did nothing because the caret happened to be in the title box would be
 * the more confusing failure, and typing a name is exactly when someone reaches for it.
 *
 * `preventDefault` runs before any of that, and unconditionally — the browser's "Save Page As"
 * dialog opening over the editor is the one outcome this must never produce, including when
 * the screen's own handler decides there is nothing to save.
 *
 * The handler is read through a ref so a screen can pass a plain function without
 * re-registering the listener on every render.
 */
export function useSaveShortcut(onSave: () => void) {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'web') return;

    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || (e.key !== 's' && e.key !== 'S')) return;
      e.preventDefault();
      onSaveRef.current();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []));
}
