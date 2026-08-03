import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Undo/redo, in two parts: a contract both editors expose, and a generic stack for the one
 * that doesn't already have somewhere to keep it.
 *
 * The *storage* deliberately isn't unified. The tab editor's history lives in `useAppStore`
 * beside the notes it snapshots, because the list view undoes the same edits the roll does,
 * and because a snapshot there carries key/type/bpm as well. A project's history can't live
 * in `useMidiProjectsStore` for the opposite reason: that store is a *library* holding every
 * project, and `saveProject` is what MIDI import itself calls — history there would make
 * Ctrl+Z able to un-import a file.
 *
 * What is unified is everything above the storage: the shape (`EditHistory`), the keyboard
 * bindings, and therefore any future change to either.
 */
export interface EditHistory {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/** Bounded for hygiene; a snapshot is an array of references, so the depth is generous
 *  rather than costly. Matches `useAppStore`'s own MAX_HISTORY. */
const MAX_HISTORY = 50;

/**
 * Screen-local undo/redo over a value the caller stores elsewhere.
 *
 * `read` returns the current value at the moment of the call (not a render-time snapshot,
 * which would be stale by the time an undo runs), and `write` puts one back. `onRestore`
 * fires after a jump for state that can't survive it — in the Studio, a note's id is its
 * index in the track's array, so any selection has to be dropped.
 */
export function useEditHistory<T>(
  read: () => T | null,
  write: (value: T) => void,
  onRestore?: () => void,
): EditHistory & { record: () => void; reset: () => void } {
  const [history, setHistory] = useState<T[]>([]);
  const [future,  setFuture]  = useState<T[]>([]);

  /** Call *before* applying an edit — it snapshots the current value as the state to
   *  return to. A fresh edit invalidates whatever was available to redo. */
  const record = useCallback(() => {
    const current = read();
    if (current === null) return;
    setHistory((h) => [...h, current].slice(-MAX_HISTORY));
    setFuture([]);
  }, [read]);

  /** Both directions are the same move between opposite stacks, so they share one body. */
  const step = useCallback((direction: 'undo' | 'redo') => {
    const current = read();
    if (current === null) return;
    const [from, setFrom, setTo] = direction === 'undo'
      ? ([history, setHistory, setFuture] as const)
      : ([future,  setFuture,  setHistory] as const);
    const target = from[from.length - 1];
    if (target === undefined) return;
    setFrom((s) => s.slice(0, -1));
    setTo((s) => [...s, current].slice(-MAX_HISTORY));
    onRestore?.();
    write(target);
  }, [read, write, history, future, onRestore]);

  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);
  const reset = useCallback(() => { setHistory([]); setFuture([]); }, []);

  return { undo, redo, canUndo: history.length > 0, canRedo: future.length > 0, record, reset };
}

/**
 * Ctrl/Cmd+Z to undo, Shift+Ctrl/Cmd+Z or Ctrl/Cmd+Y to redo.
 *
 * Screen-level rather than scoped to the piano roll, since undo/redo apply to the tab
 * editor's list view too. Skips text inputs so the browser's native field-undo still works
 * in the rename/tempo fields instead of being hijacked by the document's history.
 */
export function useUndoRedoShortcuts({ undo, redo }: Pick<EditHistory, 'undo' | 'redo'>) {
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    function isTextInput(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || isTextInput(e.target)) return;
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        // Shift+Cmd+Z is the redo gesture on macOS, where Ctrl+Y isn't one at all.
        if (e.shiftKey) redo(); else undo();
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        redo();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);
}
