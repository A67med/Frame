import { useCallback, useState } from "react";
import type { Draft } from "../studio-types";
import { updateDraftHistory, stepDraftHistory, type DraftHistory } from "../draft-history";

type Updater = Draft | ((prev: Draft) => Draft);

export function useDraftHistory(initial: () => Draft) {
  const [state, setState] = useState<DraftHistory>(() => ({
    draft: initial(),
    past: [],
    future: [],
    lastPushAt: 0,
    group: null,
  }));
  const setDraft = useCallback((updater: Updater, group: string | null = null) => {
    const now = Date.now();
    setState((s) =>
      updateDraftHistory(s, typeof updater === "function" ? updater(s.draft) : updater, now, group),
    );
  }, []);
  const undo = useCallback(() => setState((s) => stepDraftHistory(s, "undo")), []);
  const redo = useCallback(() => setState((s) => stepDraftHistory(s, "redo")), []);
  return {
    draft: state.draft,
    setDraft,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
