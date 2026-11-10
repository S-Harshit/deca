// Read chat in your own language. Uses the browser's built-in, on-device translator (Chrome's Translator and Language Detector),
// so nothing is sent to a server: the sender's message stays signed in its original language and this is only how it is shown to you.
type Detector = { detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]> };
type Translator = { translate(text: string): Promise<string> };
type Opts = { sourceLanguage: string; targetLanguage: string };
const g = globalThis as unknown as {
  Translator?: { availability(o: Opts): Promise<string>; create(o: Opts): Promise<Translator> };
  LanguageDetector?: { create(): Promise<Detector> };
};

export const canTranslate = () => !!g.Translator && !!g.LanguageDetector;

export const LANGS = ["en", "es", "fr", "de", "pt", "it", "nl", "ru", "uk", "pl", "tr", "ar", "he", "hi", "bn", "ta", "th", "vi", "id", "zh", "ja", "ko"];
export const langName = (code: string) => {
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
};

export type Result = { kind: "same" } | { kind: "done"; text: string; from: string } | { kind: "needs-click" } | { kind: "unavailable" };

let detector: Promise<Detector> | null = null;
const translators = new Map<string, Promise<Translator>>();
const cache = new Map<string, Result>();

/** Worth translating: has letters, and is not just a link. */
const translatable = (t: string) => /\p{L}{2}/u.test(t) && !/^\s*https?:\/\/\S+\s*$/.test(t);

/**
 * `gesture`: true when called from a click. The browser only downloads a language pack after a click,
 * so without one a not-yet-downloaded language reports "needs-click" instead of starting a download nobody asked for.
 */
export async function translate(text: string, to: string, gesture = false): Promise<Result> {
  if (!canTranslate() || !translatable(text)) return { kind: "same" };
  const key = `${to}\n${text}`;
  const hit = cache.get(key);
  if (hit && hit.kind !== "needs-click") return hit;
  const finish = (r: Result) => {
    if (cache.size > 500) cache.delete(cache.keys().next().value as string);
    cache.set(key, r);
    return r;
  };
  try {
    detector ??= g.LanguageDetector!.create();
    const [top] = await (await detector).detect(text);
    if (!top || top.detectedLanguage === "und" || top.confidence < 0.5) return finish({ kind: "same" });
    const from = top.detectedLanguage;
    if (from.split("-")[0] === to) return finish({ kind: "same" });
    const o = { sourceLanguage: from, targetLanguage: to };
    const have = await g.Translator!.availability(o);
    if (have === "unavailable") return finish({ kind: "unavailable" });
    if (have !== "available" && !gesture) return { kind: "needs-click" };
    const pair = `${from}>${to}`;
    if (!translators.has(pair)) translators.set(pair, g.Translator!.create(o));
    const out = await (await translators.get(pair)!).translate(text);
    return finish({ kind: "done", text: out, from });
  } catch {
    return { kind: "unavailable" };
  }
}
