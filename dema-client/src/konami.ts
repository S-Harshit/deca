// The classic cheat code (up up down down left right left right B A) opens the hidden leaderboard.
// Ignored while typing in a field, so arrow keys and letters in the chat box never trigger it by accident.
const CODE = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a"];

export function onKonami(fn: () => void) {
  let seen: string[] = [];
  const key = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) {
      seen = [];
      return;
    }
    seen = [...seen, e.key.toLowerCase()].slice(-CODE.length);
    if (seen.length === CODE.length && seen.every((k, i) => k === CODE[i])) {
      seen = [];
      fn();
    }
  };
  window.addEventListener("keydown", key);
  return () => window.removeEventListener("keydown", key);
}
