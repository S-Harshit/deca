const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch({ });
  const track = () => { window.__seen = []; const t0 = performance.now(); const probes = { host: () => !!document.querySelector('[aria-label="Host controls"]'), importBtn: () => [...document.querySelectorAll("button")].some((x) => x.textContent.trim() === "Import"), alone: () => !!document.querySelector(".invite-card"), hostBadge: () => [...document.querySelectorAll(".members .badge")].some((x) => /host/i.test(x.textContent)), count: () => (document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || "").replace(/\s+/g, " ").trim(), exportBtn: () => [...document.querySelectorAll("button")].some((x) => x.textContent.trim() === "Export") }; const last = {}; const tick = () => { for (const [k, f] of Object.entries(probes)) { const v = f(); if (last[k] !== v) { last[k] = v; window.__seen.push([Math.round(performance.now() - t0), k, v]); } } }; new MutationObserver(tick).observe(document, { childList: true, subtree: true, characterData: true }); };
  const mk = async (name, room, watch) => { const c = await b.newContext({ viewport: { width: 1200, height: 800 } }); const p = await c.newPage(); if (watch) await p.addInitScript(track); await p.goto(room || "http://localhost:8080/"); await p.locator("input").first().fill(name); await p.getByRole("button", { name: room ? /join/i : /create/i }).first().click(); return p; };
  const seen = async (p) => (await p.evaluate(() => window.__seen)).map(([t, k, v]) => ({ t, k, v }));
  const flips = (log, k, value) => log.filter((e) => e.k === k && e.v === value).length;
  for (const others of [1, 2, 4]) {
    const host = await mk("Host"); await host.locator(".composer textarea").waitFor(); const room = host.url();
    for (let i = 0; i < others - 1; i++) { const x = await mk("X" + i, room); await x.locator(".composer textarea").waitFor(); }
    const j = await mk("Joiner", room, true); await j.locator(".composer textarea").waitFor(); await j.getByText(new RegExp(`${others + 1} / \\d+`)).first().waitFor({ timeout: 15000 }); await j.waitForTimeout(800);
    const log = await seen(j);
    ok(`joining a room of ${others + 1}: never flashes "only one here"`, flips(log, "alone", true) === 0, JSON.stringify(log.filter((e) => e.k === "alone")));
    ok(`...never shows the host panel or Import`, flips(log, "host", true) === 0 && flips(log, "importBtn", true) === 0);
    ok(`...never shows a member count of 0 or 1 (waits, then the real number)`, !log.some((e) => e.k === "count" && /MEMBERS (0|1)\b/.test(e.v)), JSON.stringify(log.filter((e) => e.k === "count").map((e) => e.v)));
    ok(`...no Export button until it knows the room`, log.filter((e) => e.k === "exportBtn" && e.v).every((e) => log.some((c) => c.k === "count" && /MEMBERS \d/.test(c.v) && c.t <= e.t)));
    ok(`...the count settles on the real number`, new RegExp(`MEMBERS ${others + 1}\\b`).test(await j.locator(".members").locator("xpath=ancestor::section").locator("h3").innerText().then((t) => t.replace(/\s+/g, " "))));
  }
  // a creator still sees the host UI and the invite card, promptly
  const c = await mk("Creator", null, true); await c.locator(".composer textarea").waitFor(); await c.waitForTimeout(800); const cl = await seen(c);
  ok("a creator gets the host panel and the invite card", flips(cl, "host", true) === 1 && flips(cl, "alone", true) === 1, JSON.stringify(cl));
  ok("...and they appear together, once, without flicker", flips(cl, "host", false) <= 1 && flips(cl, "alone", false) <= 1);
  ok("...showing 1 person, never 0", !cl.some((e) => e.k === "count" && /MEMBERS 0\b/.test(e.v)), JSON.stringify(cl.filter((e) => e.k === "count").map((e) => e.v)));
  // everyone leaves but one: the card appears honestly (settled room, really alone)
  const host2 = await mk("H2"); await host2.locator(".composer textarea").waitFor(); const r2 = host2.url(); const g = await mk("G", r2); await g.locator(".composer textarea").waitFor(); await host2.getByText("G joined").waitFor({ timeout: 15000 });
  ok("with company: no invite card", (await host2.locator(".invite-card").count()) === 0);
  await g.getByRole("button", { name: "Leave space" }).click(); await g.getByRole("button", { name: "Leave now" }).click(); await host2.getByText("G left").waitFor({ timeout: 15000 });
  ok("when everyone else has really left, the card shows", (await host2.locator(".invite-card").count()) === 1);
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.log("ERR", e.message.split("\n").slice(0, 6).join("\n")); process.exit(1); });
