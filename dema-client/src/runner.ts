import { useSyncExternalStore } from "react";

/** The hidden `/run` strip is on or off for this tab only: nothing is saved and nobody else sees it. */
let on = false;
const subs = new Set<() => void>();
export const runnerOn = () => on;
export function setRunner(v: boolean) {
  if (on === v) return;
  on = v;
  subs.forEach((f) => f());
}
export const useRunner = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    runnerOn,
  );
