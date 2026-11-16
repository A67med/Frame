import type { Draft } from "./studio-types";

export type DraftHistory = {
  draft: Draft;
  past: Draft[];
  future: Draft[];
  lastPushAt: number;
  group: string | null;
};

export function updateDraftHistory(
  state: DraftHistory,
  draft: Draft,
  now: number,
  group: string | null,
): DraftHistory {
  if (draft === state.draft) return state;
  const coalesce =
    group !== null &&
    group === state.group &&
    state.past.length > 0 &&
    now - state.lastPushAt < 450;
  return {
    draft,
    past: coalesce ? state.past : [...state.past, state.draft].slice(-120),
    future: [],
    lastPushAt: now,
    group,
  };
}

export function stepDraftHistory(state: DraftHistory, direction: "undo" | "redo"): DraftHistory {
  const source = direction === "undo" ? state.past : state.future;
  if (!source.length) return state;
  return {
    draft: source[source.length - 1],
    past: direction === "undo" ? state.past.slice(0, -1) : [...state.past, state.draft],
    future: direction === "undo" ? [...state.future, state.draft] : state.future.slice(0, -1),
    lastPushAt: 0,
    group: null,
  };
}
