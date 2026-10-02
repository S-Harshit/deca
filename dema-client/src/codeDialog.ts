import { useSyncExternalStore } from "react";

/** Whether the "Connect by code" dialog is open: a tiny store so the invite card and the Members panel can both open it. */
let open = false;
const subs = new Set<() => void>();
export const setCodeDialog = (v: boolean) => {
  if (open === v) return;
  open = v;
  subs.forEach((f) => f());
};
export const useCodeDialog = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => open,
  );
