// Generic undo/redo history stack for rig state. Same pattern as the
// backend's push_history: snapshot state before every mutation, pop to undo.
// Kept generic (not bone/binding-specific) so it can be reused for any
// serializable piece of state.

import { useState, useCallback, useRef } from 'react';

const MAX_HISTORY = 50;

export function useHistoryState<T>(initial: T) {
  const [state, setStateInternal] = useState<T>(initial);
  const undoStack = useRef<T[]>([]);
  const redoStack = useRef<T[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const syncFlags = useCallback(() => {
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  }, []);

  // Call this instead of setState directly whenever a mutation should be
  // undoable. Pushes the CURRENT state onto the undo stack before applying
  // the update, and clears the redo stack (standard editor behavior — a
  // fresh edit invalidates the old redo branch).
  const setState = useCallback(
    (updater: T | ((prev: T) => T)) => {
      setStateInternal((prev) => {
        undoStack.current.push(prev);
        if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
        redoStack.current = [];
        syncFlags();
        return typeof updater === 'function' ? (updater as (prev: T) => T)(prev) : updater;
      });
    },
    [syncFlags]
  );

  const undo = useCallback(() => {
    setStateInternal((prev) => {
      const prevState = undoStack.current.pop();
      if (prevState === undefined) return prev;
      redoStack.current.push(prev);
      syncFlags();
      return prevState;
    });
  }, [syncFlags]);

  const redo = useCallback(() => {
    setStateInternal((prev) => {
      const nextState = redoStack.current.pop();
      if (nextState === undefined) return prev;
      undoStack.current.push(prev);
      syncFlags();
      return nextState;
    });
  }, [syncFlags]);

  return { state, setState, undo, redo, canUndo, canRedo };
}
