/**
 * Page-wide file drag-and-drop: is a file being dragged over the window, and what was
 * dropped.
 *
 * Listens on `window` rather than exposing props for a `View` to spread. React Native Web
 * does not forward `onDragOver`/`onDrop` to the underlying DOM node, and even if it did, a
 * drop target that only covers the laid-out content would miss the margins — a drop over
 * the page's empty right-hand gutter would fall through to the browser, which navigates the
 * tab to the file and loses whatever was unsaved.
 *
 * Three details make it not flicker and not break:
 *
 *  - **A depth counter.** `dragenter`/`dragleave` fire for every element the cursor crosses,
 *    so a leave-on-child would extinguish the overlay while the file is still over the page.
 *    Counting enters against leaves is the standard fix.
 *  - **A `Files` check.** The library already has drag-to-reorder; dragging a card, a text
 *    selection or a link inside the page must not arm a file-import overlay. Only a drag
 *    whose `dataTransfer.types` includes `'Files'` counts.
 *  - **`preventDefault` on both `dragover` and `drop`.** Missing either one lets the browser
 *    keep its default "open this file" behaviour, which navigates away from the app.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface FileDropOptions {
  onFiles: (files: File[]) => void;
  /** Off by default nowhere — this exists so a screen can stand down while a modal owns the
   *  page, without unmounting the hook and losing the counter. */
  enabled?: boolean;
}

function carriesFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  // A DOMStringList in older browsers, an array in current ones — `includes` exists on both.
  return Array.prototype.includes.call(types, 'Files');
}

export function useFileDrop({ onFiles, enabled = true }: FileDropOptions): { dragging: boolean } {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  // Held in a ref so an inline arrow at the call site doesn't tear down and re-attach every
  // listener on each render — which would zero the depth counter mid-drag.
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  const reset = useCallback(() => {
    depth.current = 0;
    setDragging(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      reset();
      return;
    }

    function handleEnter(event: DragEvent) {
      if (!carriesFiles(event)) return;
      depth.current += 1;
      setDragging(true);
    }

    function handleOver(event: DragEvent) {
      if (!carriesFiles(event)) return;
      // Without this the drop event never fires at all.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    }

    function handleLeave(event: DragEvent) {
      if (!carriesFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    }

    function handleDrop(event: DragEvent) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      reset();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) onFilesRef.current(files);
    }

    window.addEventListener('dragenter', handleEnter);
    window.addEventListener('dragover',  handleOver);
    window.addEventListener('dragleave', handleLeave);
    window.addEventListener('drop',      handleDrop);
    // A drag that ends outside the window (dropped on the desktop, or cancelled with Escape)
    // sends no leave that balances the enter, so the overlay would stick. Both of these are
    // belt-and-braces on top of the counter.
    window.addEventListener('dragend', reset);
    window.addEventListener('blur',    reset);

    return () => {
      window.removeEventListener('dragenter', handleEnter);
      window.removeEventListener('dragover',  handleOver);
      window.removeEventListener('dragleave', handleLeave);
      window.removeEventListener('drop',      handleDrop);
      window.removeEventListener('dragend', reset);
      window.removeEventListener('blur',    reset);
    };
  }, [enabled, reset]);

  return { dragging };
}
