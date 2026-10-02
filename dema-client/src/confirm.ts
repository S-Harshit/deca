import type { ReactNode } from "react";

export type Ask = {
  title: string;
  lines?: ReactNode[];
  confirm: string;
  cancel?: string;
  danger?: boolean;
};

type Pending = Ask & { resolve: (ok: boolean) => void };

let current: Pending | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const subscribeConfirm = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
export const getConfirm = () => current;

/** An in-app replacement for window.confirm: resolves true on confirm, false on cancel/Esc/backdrop. */
export function ask(options: Ask): Promise<boolean> {
  return new Promise((resolve) => {
    current?.resolve(false);
    current = { ...options, resolve };
    emit();
  });
}

export function answer(ok: boolean) {
  const c = current;
  current = null;
  emit();
  c?.resolve(ok);
}
