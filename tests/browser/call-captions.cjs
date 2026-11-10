// Live call captions: with captions on, what one person says (speech recognition is faked here) appears under their picture for the
// others, translated into a listener's reading language when they chose one. Recognition only runs while the mic is open.
const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
const fakeSpeech = () => {
  window.__rec = null; window.__starts = 0;
  const Fake = class { start() { window.__rec = this; window.__starts++; } stop() { if (window.__rec === this) window.__rec = null; } };
  for (const k of ["SpeechRecognition", "webkitSpeechRecognition"]) Object.defineProperty(window, k, { value: Fake, configurable: true, writable: true });
};
const fakeTranslate = () => {
  window.LanguageDetector = { create: async () => ({ detect: async (t) => [{ detectedLanguage: /hola/i.test(t) ? "es" : "en", confidence: 0.95 }] }) };
  window.Translator = { availability: async () => "available", create: async (o) => ({ translate: async (t) => `[${o.sourceLanguage}>${o.targetLanguage}] ${t}` }) };
};
(async () => {
  const b = await chromium.launch({ realDefaults: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const mk = async (prefs, ...inits) => {
    const c = await b.newContext({ viewport: { width: 1250, height: 800 }, permissions: ["camera", "microphone"] });
    for (const f of inits) await c.addInitScript(f);
    await c.addInitScript((p) => localStorage.setItem("deca.prefs", p), JSON.stringify({ theme: "graphite", ...prefs }));
    const p = await c.newPage(); p.on("pageerror", (e) => console.log("pageerror", e.message)); return p;
  };
  const A = await mk({ captions: true }, fakeSpeech); await A.goto("http://localhost:8080/"); await A.locator("input").first().fill("Ann");
  await A.getByRole("button", { name: /create/i }).first().click(); await A.locator(".composer textarea").waitFor();
  const B = await mk({ translateTo: "en" }, fakeTranslate); await B.goto(A.url()); await B.locator("input").first().fill("Ben");
  await B.getByRole("button", { name: /join/i }).first().click(); await B.locator(".composer textarea").waitFor();
  await A.waitForFunction(() => /\b2 \/ /.test(document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || ""), null, { timeout: 30000 });
  ok("no recognition before a call", (await A.evaluate(() => window.__starts)) === 0);
  await A.getByLabel("Start call").click(); await B.getByLabel("Start call").click();
  await A.waitForFunction(() => window.__rec, null, { timeout: 10000 });
  ok("recognition starts with the call", true);
  await A.waitForFunction(() => document.querySelectorAll(".tile").length >= 2, null, { timeout: 15000 });
  await B.waitForFunction(() => document.querySelectorAll(".tile").length >= 2, null, { timeout: 15000 });
  const say = (t) => A.evaluate((t) => window.__rec.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: t } }] }), t);
  await say("hola amigos");
  await B.locator(".tile-caption").waitFor({ timeout: 10000 });
  const cap = await B.locator(".tile-caption").first().innerText();
  ok("Ben sees it translated, with the original below", /\[es>en\] hola amigos/.test(cap) && /hola amigos/.test(await B.locator(".tile-caption small").innerText()), cap);
  ok("Ann sees her own words untranslated", (await A.locator(".tile-caption").first().innerText()).trim() === "hola amigos");
  await A.getByRole("button", { name: "Mute microphone" }).click();
  await A.waitForFunction(() => !window.__rec, null, { timeout: 5000 });
  ok("muting the mic stops recognition", true);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
