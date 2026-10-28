import { useSyncExternalStore } from "react";

export type ToolTab = "docs" | "polls" | "board";
type State = { tab: ToolTab | null; focus: string | null; search: boolean };

/** Which room tool is open (and which item in it), and whether search is open over it: a tiny store so the sidebar panel, the top bar and Ctrl+K can all open the same dialog. */
let state: State = { tab: null, focus: null, search: false };
const subs = new Set<() => void>();
export const openTool = (tab: ToolTab | null, focus: string | null = null) => {
  state = { ...state, tab, focus };
  subs.forEach((f) => f());
};
/** Search is its own state, so opening it leaves the workspace where it is and closing it returns to exactly that. */
export const openSearch = (on = true) => {
  state = { ...state, search: on };
  subs.forEach((f) => f());
};
export const useTool = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
