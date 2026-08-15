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

  // Snapshot the current state onto the undo stack without changing state.
  // Side effects live here, outside any setState updater, so React's Strict
  // Mode double-invoking an updater (dev only) can't double-push a snapshot.
  const pushHistory = useCallback(() => {
    undoStack.current.push(state);
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = [];
    syncFlags();
  }, [state, syncFlags]);

  // Call this instead of setState directly whenever a mutation should be
  // undoable. Pushes the CURRENT state onto the undo stack before applying
  // the update, and clears the redo stack (standard editor behavior — a
  // fresh edit invalidates the old redo branch).
  const setState = useCallback(
    (updater: T | ((prev: T) => T)) => {
      pushHistory();
      setStateInternal(updater);
    },
    [pushHistory]
  );

  // Update state WITHOUT touching the undo stack. Use for continuous
  // gestures (drag-move) where every intermediate frame would otherwise
  // burn a history slot; pair with pushHistory() once at gesture start so
  // undo still restores the pre-gesture pose in a single step.
  const setStateLive = useCallback((updater: T | ((prev: T) => T)) => {
    setStateInternal(updater);
  }, []);

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

  return { state, setState, setStateLive, pushHistory, undo, redo, canUndo, canRedo };
}
