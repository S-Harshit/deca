import { useSyncExternalStore } from "react";

/** Whether the (hidden) leaderboard is open: opened with the Konami code (konami.ts). */
let open = false;
const subs = new Set<() => void>();
export const setScoresDialog = (v: boolean) => {
  if (open === v) return;
  open = v;
  subs.forEach((f) => f());
};
export const useScoresDialog = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => open,
  );
