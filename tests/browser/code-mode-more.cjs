const { chromium } = require("../lib/browser.cjs"); const crypto = require("crypto"); const fs = require("fs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
const URL = "http://localhost:8080/";
(async () => {
  const b = await chromium.launch({ });
  const mk = async (link, vp = { width: 1300, height: 850 }, extra = {}) => { const ctx = await b.newContext({ viewport: vp, permissions: ["clipboard-read", "clipboard-write"], ...extra }); const p = await ctx.newPage(); p.errs = []; p.on("pageerror", (e) => p.errs.push(e.message)); await p.addInitScript(() => { window.__pcs = []; const R = window.RTCPeerConnection; window.RTCPeerConnection = function (...a) { const pc = new R(...a); window.__pcs.push(pc); return pc; }; window.RTCPeerConnection.prototype = R.prototype; }); await p.goto(link || URL); return p; };
  const create = async (name) => { const p = await mk(); await p.locator("input").first().fill(name); await p.getByRole("button", { name: "No server? Connect by code" }).click(); await p.getByRole("button", { name: "Create a space (no server)" }).click(); await p.locator(".composer textarea").waitFor(); return p; };
  const join = async (name, link, vp, extra) => { const p = await mk(link, vp, extra); await p.locator("input").first().fill(name); await p.getByRole("button", { name: "Join space (no server)" }).click(); await p.locator(".composer textarea").waitFor(); return p; };
  const dialog = (p) => p.getByRole("dialog", { name: "Connect by code" });
  const openDialog = async (p) => { await dialog(p).waitFor({ timeout: 2500 }).catch(() => {}); if (!(await dialog(p).count())) await p.getByRole("button", { name: /Connect by code/ }).click(); await dialog(p).waitFor(); };
  const outCode = async (p) => { await openDialog(p); const ta = dialog(p).locator("textarea[readonly]").first(); await ta.waitFor({ timeout: 15000 }); return ta.inputValue(); };
  const paste = async (p, code) => { await openDialog(p); const box = dialog(p).getByLabel("Paste a code"); if (!(await box.isVisible())) await dialog(p).getByRole("button", { name: /I have sent it: next|I need to paste a code instead/ }).click(); await box.fill(code); await dialog(p).getByRole("button", { name: "Connect" }).click(); { const y = dialog(p).getByRole("button", { name: "Let them in" }); try { await y.waitFor({ timeout: 1200 }); await y.click(); } catch {} } };
  const online = (p, n) => p.waitForFunction((n) => (document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || "").includes(`${n} / `), n, { timeout: 30000 });
  const say = async (p, t) => { await p.locator(".composer textarea").fill(t); await p.keyboard.press("Enter"); };
  const link = async (p) => `${URL}${await p.evaluate(() => location.hash)}`;
  const connect = async (host, guest) => { const c1 = await outCode(guest); await paste(host, c1); const c2 = await outCode(host); await paste(guest, c2); };

  const A = await create("Ann"); const B = await join("Bob", await link(A)); await connect(A, B); await online(A, 2); await online(B, 2);
  ok("connected", true);
  // ---- a normal room is unaffected
  { const N = await mk(); await N.locator("input").first().fill("Norm"); await N.getByRole("button", { name: "Create a space" }).click(); await N.locator(".composer textarea").waitFor(); await N.getByLabel("Lock room").waitFor({ timeout: 8000 });
    ok("a normal room has no code button and still has its lock switch", (await N.getByRole("button", { name: /Connect by code/ }).count()) === 0 && (await N.getByLabel("Lock room").count()) === 1);
    ok("...and uses the server as before", (await N.evaluate(() => location.hash)).startsWith("#/s/")); await N.context().close(); }
  // ---- bad codes in the dialog
  await openDialog(A); await dialog(A).getByLabel("Paste a code").fill("this is not a code"); await dialog(A).getByRole("button", { name: "Connect" }).click();
  ok("garbage gets a plain message, nothing happens", /does not look like a Deca code/.test(await dialog(A).getByRole("alert").innerText())); await A.keyboard.press("Escape");
  // ---- file over a code-made connection
  await A.locator('.composer input[type=file]').setInputFiles("b1m.bin"); await B.getByRole("button", { name: /Get|Download/ }).first().waitFor({ timeout: 10000 }); await B.getByRole("button", { name: /Get|Download/ }).first().click();
  await B.waitForFunction(() => !!document.querySelector("a[download]"), null, { timeout: 30000 }); ok("a 1 MB file transfers over a connection made by codes", true);
  // ---- the link drops (browser keeps running, connection torn down)
  await B.evaluate(() => window.__pcs.forEach((pc) => pc.close()));
  await B.waitForFunction(() => (document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || "").includes("1 / ") || /connect|waiting|network/i.test(document.querySelector(".members")?.innerText || ""), null, { timeout: 15000 }); 
  ok("when the link drops, Bob's page shows Ann with a Reconnect button", (await B.locator(".members").getByRole("button", { name: "Reconnect" }).count()) >= 1);
  ok("and does NOT keep generating new codes by itself (nothing popped up)", (await dialog(B).count()) === 0 && (await dialog(A).count()) === 0);
  const retry = B.locator(".members").getByRole("button", { name: "Reconnect" }); await retry.first().click({ timeout: 10000 });
  await dialog(B).waitFor({ timeout: 10000 }); ok("pressing Reconnect makes one fresh code (dialog opens by itself)", true);
  const t0 = Date.now(); await connect(A, B); await online(A, 2); await online(B, 2);
  ok(`reconnected with one more exchange (${((Date.now() - t0) / 1000).toFixed(1)} s)`, true);
  await say(B, "back again"); await A.getByText("back again").waitFor({ timeout: 8000 }); ok("and chat works again", true);
  // ---- a refresh: the address still holds the invite that was followed
  const hash = await B.evaluate(() => location.hash); ok("Bob's address keeps the invite he followed (Ann's), not his own", hash.includes(`/m/`) && (await A.evaluate(() => location.hash)).split("/")[3] === hash.split("/")[3] && hash.split("/")[3] === (await A.evaluate(() => location.hash)).split("/")[3]);
  await B.reload(); await B.locator("input").first().fill("Bob"); ok("after a refresh the page offers to join the same room again", (await B.getByRole("button", { name: "Join space (no server)" }).count()) === 1);
  await B.getByRole("button", { name: "Join space (no server)" }).click(); await B.locator(".composer textarea").waitFor(); await connect(A, B); await online(A, 2); await online(B, 2);
  ok("a refreshed person comes back with another exchange", true);
  // ---- phone
  const C = await join("Cat", await link(A), { width: 390, height: 780 }, { hasTouch: true, isMobile: true });
  await dialog(C).waitFor({ timeout: 15000 }); const bx = await dialog(C).boundingBox(); ok("phone: the code dialog fits the screen", bx.x >= 0 && bx.x + bx.width <= 391 && bx.y >= 0 && bx.y + bx.height <= 781, JSON.stringify(bx));
  const codeC = await outCode(C); ok("phone: the code is shown whole and selectable", codeC.startsWith("deca1."));
  await dialog(C).getByRole("button", { name: "Copy code" }).tap(); await C.waitForTimeout(300); const clip = await C.evaluate(() => navigator.clipboard.readText().catch(() => "")); ok("phone: Copy code puts the whole code on the clipboard", clip === codeC);
  await paste(A, clip); await paste(C, await outCode(A)); await online(C, 3); await online(A, 3); ok("a person on a phone joins; all three connected (Bob was introduced automatically)", true);
  ok("phone: no horizontal overflow", await C.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  ok("no page errors", [A, B, C].every((p) => p.errs.length === 0), [A, B, C].flatMap((p) => p.errs).join("|"));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.log("ERR", e.message.split("\n").slice(0, 14).join("\n")); process.exit(1); });
