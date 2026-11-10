// Chat translation: with a reading language set, other people's lines get a translation under the original; your own lines and
// lines already in your language do not. The browser's translator is faked (headless Chrome has none), so this checks our wiring.
const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
const fake = () => {
  window.LanguageDetector = { create: async () => ({ detect: async (t) => [{ detectedLanguage: /hola/i.test(t) ? "es" : "en", confidence: 0.95 }] }) };
  window.Translator = { availability: async () => "available", create: async (o) => ({ translate: async (t) => `[${o.sourceLanguage}>${o.targetLanguage}] ${t}` }) };
};
(async () => {
  const b = await chromium.launch();
  const mk = async (prefs) => {
    const c = await b.newContext({ viewport: { width: 1300, height: 900 } });
    await c.addInitScript(fake);
    if (prefs) await c.addInitScript((p) => localStorage.setItem("deca.prefs", p), JSON.stringify(prefs));
    const p = await c.newPage(); p.on("pageerror", (e) => console.log("pageerror", e.message)); return p;
  };
  const A = await mk(null); await A.goto("http://localhost:8080/"); await A.locator("input").first().fill("Ann");
  await A.getByRole("button", { name: /create/i }).first().click(); await A.locator(".composer textarea").waitFor();
  const B = await mk({ theme: "graphite", translateTo: "en" }); await B.goto(A.url()); await B.locator("input").first().fill("Ben");
  await B.getByRole("button", { name: /join/i }).first().click(); await B.locator(".composer textarea").waitFor();
  const say = async (p, t) => { await p.locator(".composer textarea").fill(t); await p.keyboard.press("Enter"); };
  await say(A, "hola amigos"); await say(A, "see you soon");
  await B.locator(".xl").first().waitFor({ timeout: 15000 });
  ok("a Spanish line is translated for Ben", /^\[es>en\] hola amigos/.test(await B.locator(".xl").first().innerText()));
  await B.getByText("see you soon").waitFor();
  await B.waitForTimeout(500);
  ok("a line already in English is not repeated", (await B.locator(".xl").count()) === 1);
  await say(B, "hola otra vez"); await A.getByText("hola otra vez").waitFor(); await B.waitForTimeout(500);
  ok("your own line is not translated", (await B.locator(".xl").count()) === 1);
  ok("Ann (no reading language) sees no translations", (await A.locator(".xl").count()) === 0);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
