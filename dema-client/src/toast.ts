import { useSyncExternalStore } from "react";

export type Toast = { id: number; text: string; kind: "info" | "error" };

let toasts: Toast[] = [];
let nextId = 1;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function notify(text: string, kind: Toast["kind"] = "info") {
  const id = nextId++;
  toasts = [...toasts, { id, text, kind }].slice(-4);
  emit();
  setTimeout(() => dismiss(id), kind === "error" ? 6000 : 3000);
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => toasts,
  );
}
