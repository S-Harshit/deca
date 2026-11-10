// Live captions in a call. Each browser transcribes only its own microphone with the browser's speech recognition and sends the
// finished sentences to the others as small unsigned `cap` messages (validated in space.ts). Chrome's recognition may send the audio to
// Google to be turned into text, so this is off until the person turns it on.
import { useEffect, useState } from "react";

type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};
const w = globalThis as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
const Ctor = () => w.SpeechRecognition ?? w.webkitSpeechRecognition;

export const speechSupported = () => !!Ctor();

/** Transcribe this device's microphone until the returned stop function is called. It restarts itself when the browser ends a session. */
export function startRecognition(onText: (text: string) => void) {
  const R = Ctor();
  if (!R) return () => {};
  let on = true;
  let rec: Rec | null = null;
  const run = () => {
    if (!on) return;
    rec = new R();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText(e.results[i][0].transcript);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") on = false; // permission refused: do not keep asking
    };
    rec.onend = () => on && setTimeout(run, 300); // the browser ends a session after a pause in speech
    try {
      rec.start();
    } catch {
      // already starting
    }
  };
  run();
  return () => {
    on = false;
    if (rec) rec.onend = null;
    try {
      rec?.stop();
    } catch {
      // already stopped
    }
  };
}

/** The latest sentence per person, kept for a few seconds. Live only: it is never saved or replayed. */
const SHOW_MS = 7000;
const lines = new Map<string, { text: string; at: number }>();
const subs = new Set<() => void>();
const poke = () => subs.forEach((f) => f());

export function pushCaption(peerId: string, text: string) {
  lines.set(peerId, { text, at: Date.now() });
  poke();
  setTimeout(() => {
    if (lines.get(peerId)?.text === text && Date.now() - lines.get(peerId)!.at >= SHOW_MS - 50) {
      lines.delete(peerId);
      poke();
    }
  }, SHOW_MS);
}

export function useCaption(peerId: string) {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return lines.get(peerId)?.text ?? "";
}
