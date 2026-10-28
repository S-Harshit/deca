import { useSyncExternalStore } from "react";

/** Whether the "open on your phone" QR dialog is showing: a tiny store so the invite card and the top bar can both open it. */
let open = false;
const subs = new Set<() => void>();
export const setQrDialog = (v: boolean) => {
  if (open === v) return;
  open = v;
  subs.forEach((f) => f());
};
export const useQrDialog = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => open,
  );
