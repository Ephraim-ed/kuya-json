import { useCallback, useState } from "react";

let nextKey = 0;

/**
 * The text of one editor pane's document.
 *
 * Undo/redo is not kept here: the pane's CodeMirror editor owns the document's
 * only undo stack (see JsonEditor) — a second stack here fought with it. `key`
 * identifies the loaded document: `reset` (loading another workspace) gives it
 * a new key so the editor starts a fresh undo history; `set` (typing, tool
 * output) keeps it, so those changes are undoable.
 */
export function useHistory(initial: string) {
  const [doc, setDoc] = useState(() => ({ value: initial, key: ++nextKey }));

  const set = useCallback((value: string) => {
    setDoc((d) => (d.value === value ? d : { ...d, value }));
  }, []);

  const reset = useCallback((value: string) => {
    const key = ++nextKey;
    setDoc({ value, key });
  }, []);

  return { value: doc.value, key: doc.key, set, reset };
}
