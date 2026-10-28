import { useSyncExternalStore } from "react";

/** Whether the "files shared as links" dialog is showing: a tiny store so the composer menu can open it. */
let open = false;
const subs = new Set<() => void>();
export const setDropsDialog = (v: boolean) => {
  if (open === v) return;
  open = v;
  subs.forEach((f) => f());
};
export const useDropsDialog = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => open,
  );
