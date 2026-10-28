// Music stays together: two listeners (and one who arrives late) hear the same second, after the start, after a track change and after a pause.
// Needs the internet (a real YouTube player). The tolerance is the clock's own resolution plus a margin.
const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1300, height: 900 } }); const p = await c.newPage(); p.on("pageerror", (e) => console.log("pageerror", e.message)); return p; };
  const join = async (p, name, url) => { await p.goto(url); await p.locator("input").first().fill(name); await p.getByRole("button", { name: url === "http://localhost:8080/" ? /create/i : /join/i }).first().click(); await p.locator(".composer textarea").waitFor(); };
  const A = await mk(); await join(A, "Ann", "http://localhost:8080/");
  const B = await mk(); await join(B, "Ben", A.url());
  await A.waitForFunction(() => /\b2 \/ /.test(document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || ""), null, { timeout: 30000 });
  const secs = async (p) => { const t = await p.locator(".music .clock").first().innerText().catch(() => "0:00"); const [m, s] = t.split(":").map(Number); return m * 60 + s; };
  const together = async (ps, label, tol = 2) => { const v = await Promise.all(ps.map(secs)); const spread = Math.max(...v) - Math.min(...v); ok(`${label}: within ${tol} s of each other`, spread <= tol, v.join(" / ")); return v; };
  // a long-ish video, then a second one queued behind it
  await A.getByLabel("YouTube link").fill("https://www.youtube.com/watch?v=jNQXAC9IVRw https://www.youtube.com/watch?v=9bZkp7q19f0"); await A.getByLabel("Add to queue").click();
  await A.locator(".np-title").waitFor({ timeout: 40000 });
  await B.locator(".np-title").waitFor({ timeout: 20000 });
  await A.waitForTimeout(7000);
  const v1 = await together([A, B], "after the start");
  ok("it is really playing (the clock moved)", v1[0] >= 3, v1.join());
  // a listener who arrives late is brought to the same second quickly
  const C = await mk(); await join(C, "Cy", A.url());
  await C.locator(".np-title").waitFor({ timeout: 20000 });
  await C.waitForTimeout(5000);
  await together([A, B, C], "a late arrival, five seconds after joining");
  // pause and resume
  await A.getByRole("button", { name: /^Pause/ }).first().click(); await A.waitForTimeout(2500);
  const pa = await secs(A), pb = await secs(B), pc = await secs(C);
  ok("pausing pauses everyone at the same moment", Math.max(pa, pb, pc) - Math.min(pa, pb, pc) <= 2, [pa, pb, pc].join());
  await A.waitForTimeout(3000);
  ok("and the clocks stay still while paused", (await secs(A)) === pa && (await secs(B)) === pb);
  await A.getByRole("button", { name: /^Play/ }).first().click(); await A.waitForTimeout(5000);
  await together([A, B, C], "after resuming");
  // next track: everyone moves on and starts together
  await A.getByLabel("Next track").click(); await A.waitForTimeout(7000);
  const t = await together([A, B, C], "after a track change");
  ok("the new track really started for all of them", t.every((x) => x >= 2), t.join());
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
