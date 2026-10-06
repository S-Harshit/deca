const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch({ });
  const p = await (await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true })).newPage();
  await p.goto("http://localhost:8080/");
  const over = () => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok("landing: no sideways scroll", (await over()) <= 0, String(await over()));
  await p.evaluate(() => { const v = JSON.parse(localStorage.getItem("deca.prefs") || "{}"); v.home = "classic"; localStorage.setItem("deca.prefs", JSON.stringify(v)); }); await p.reload();
  ok("classic landing: single column, no sideways scroll", (await over()) <= 0 && (await p.evaluate(() => getComputedStyle(document.querySelector(".landing-inner")).gridTemplateColumns.split(" ").length)) === 1);
  await p.evaluate(() => localStorage.removeItem("deca.prefs")); await p.reload();
  await p.locator("input").first().fill("Ann"); await p.getByRole("button", { name: /create/i }).first().click(); await p.locator(".composer textarea").waitFor();
  ok("room: no sideways scroll", (await over()) <= 0, String(await over()));
  const hb = await p.evaluate(() => { const e = document.querySelector(".horn-btn"); const r = e && e.getBoundingClientRect(); return r && { bg: getComputedStyle(e).backgroundColor, w: r.width, h: r.height }; });
  ok("wake-up button is red and sized on a phone (inside the menu)", !!hb && hb.bg === "rgb(217, 45, 32)" && hb.w > 40 && hb.h > 20, JSON.stringify(hb));
  const comp = await p.evaluate(() => { const t = document.querySelector(".composer textarea").getBoundingClientRect(); return { right: t.right, w: innerWidth }; });
  ok("composer fits the width", comp.right <= comp.w + 1, JSON.stringify(comp));
  console.log(`\n${pass} passed, ${fail} failed`); await b.close();
})();
