import { useSyncExternalStore } from "react";

export type ToolTab = "search" | "docs" | "polls" | "board";
type State = { tab: ToolTab | null; focus: string | null };

/** Which room tool is open (and which item in it): a tiny store so the sidebar panel, the top bar and Ctrl+K can all open the same dialog. */
let state: State = { tab: null, focus: null };
const subs = new Set<() => void>();
export const openTool = (tab: ToolTab | null, focus: string | null = null) => {
  state = { tab, focus };
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
