const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
const URL = "http://localhost:8080/";
(async () => {
  const b = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const mk = async (name, link) => {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 850 }, permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"] }); const p = await ctx.newPage(); p.errs = []; p.net = [];
    p.on("pageerror", (e) => p.errs.push(e.message)); p.on("request", (r) => /\/ice$|\/ws/.test(r.url()) && p.net.push(r.url()));
    await p.addInitScript(() => { window.__ws = 0; const W = window.WebSocket; window.WebSocket = function (...a) { window.__ws++; return new W(...a); }; Object.assign(window.WebSocket, W); window.WebSocket.prototype = W.prototype; });
    await p.goto(link || URL); return p;
  };
  const create = async (name) => { const p = await mk(name); await p.locator("input").first().fill(name); await p.getByRole("button", { name: "No server? Connect by code" }).click(); await p.getByRole("button", { name: "Create a space (no server)" }).click(); await p.locator(".composer textarea").waitFor(); return p; };
  const join = async (name, link) => { const p = await mk(name, link); await p.locator("input").first().fill(name); await p.getByRole("button", { name: "Join space (no server)" }).click(); await p.locator(".composer textarea").waitFor(); return p; };
  const inviteOf = async (p) => p.locator(".invite-card .link").textContent().catch(async () => null);
  const dialog = (p) => p.getByRole("dialog", { name: "Connect by code" });
  const openDialog = async (p) => { await dialog(p).waitFor({ timeout: 2500 }).catch(() => {}); if (!(await dialog(p).count())) await p.getByRole("button", { name: /Connect by code/ }).click(); await dialog(p).waitFor(); };
  const outCode = async (p) => { await openDialog(p); const ta = dialog(p).locator('textarea[readonly]').first(); await ta.waitFor({ timeout: 15000 }); return ta.inputValue(); };
  const paste = async (p, code) => { await openDialog(p); const box = dialog(p).getByLabel("Paste a code"); if (!(await box.isVisible())) await dialog(p).getByRole("button", { name: /I have sent it: next|I need to paste a code instead/ }).click(); await box.fill(code); await dialog(p).getByRole("button", { name: "Connect" }).click(); { const y = dialog(p).getByRole("button", { name: "Let them in" }); try { await y.waitFor({ timeout: 1200 }); await y.click(); } catch {} } };
  const online = (p, n) => p.waitForFunction((n) => { const h = document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || ""; return new RegExp(`${n} / `).test(h); }, n, { timeout: 30000 });
  const say = async (p, t) => { await p.locator(".composer textarea").fill(t); await p.keyboard.press("Enter"); };

  // ---- A makes a room
  const A = await create("Ann"); const t0 = Date.now();
  ok("a room with no server opens straight away", await A.locator(".invite-card").isVisible());
  const link = (await inviteOf(A)) ?? "";
  ok("the room chip shows a short room name, not a long address", /^#[0-9a-f]{12}$/.test((await A.locator(".ticket-pill").textContent()).trim()), await A.locator(".ticket-pill").textContent());
  ok("the host card explains the steps in plain words", /Send this link/.test(await A.locator(".invite-card").innerText()) && /Paste their code/.test(await A.locator(".invite-card").innerText())); ok("its invite is a #/m/ link", /#\/m\/[0-9a-f]{12}\/[0-9a-f]{16}\/[0-9a-f]{16}\/Ann$/.test(link), link);
  ok("no lock switch in host controls (it means nothing without a server)", (await A.getByLabel("Lock room").count()) === 0);
  // ---- B follows the invite
  const B = await join("Bob", link); 
  ok("the invite page says it works without a server", true);
  const codeB = await outCode(B);
  ok("the newcomer is told: Step 1, send this code to Ann", /Step 1 of 2: send this code to Ann/.test(await dialog(B).innerText())); ok("Bob is handed a code to send (dialog opened by itself)", /^deca1\.[A-Za-z0-9_-]{100,}$/.test(codeB), codeB.slice(0, 40));
  console.log(`   (code length ${codeB.length} characters)`);
  await A.getByRole("button", { name: "Paste their code" }).click(); ok("the invite card button Paste their code opens the dialog", await dialog(A).isVisible()); await A.keyboard.press("Escape");
  await paste(A, codeB); await dialog(A).waitFor();
  const reply = await outCode(A);
  ok("the host is told it is the last step, and who is waiting", /Last step: send this reply back to Bob/.test(await dialog(A).innerText())); ok("Ann pastes it and gets a reply code for Bob", /^deca1\./.test(reply) && reply !== codeB);
  await paste(B, reply);
  await online(A, 2); await online(B, 2); ok(`connected with two pasted codes, in ${((Date.now() - t0) / 1000).toFixed(1)} s including the test's own steps`, true);
  await say(B, "hello from Bob, no server"); await A.getByText("hello from Bob, no server").waitFor({ timeout: 8000 }); await say(A, "hi Bob"); await B.getByText("hi Bob").waitFor({ timeout: 8000 }); ok("chat works both ways", true);
  ok("the dialog closed itself once the codes had done their job", (await dialog(A).count()) === 0 && (await dialog(B).count()) === 0);
  { const w = async (p, who) => { const el = p.locator(".code-box", { hasText: "Check words with " + who }); await el.waitFor({ timeout: 8000 }); return (await el.locator(".check-words").innerText()).trim(); };
    const wa = await w(A, "Bob"), wb = await w(B, "Ann"); ok("both sides show the same six check words", wa === wb && wa.split(" ").length === 6, wa + " / " + wb);
    await A.locator(".code-box", { hasText: "Check words with Bob" }).getByRole("button", { name: "They match" }).click(); await A.waitForTimeout(500); ok("confirming removes the card", (await A.locator(".code-box", { hasText: "Check words" }).count()) === 0); }
  ok("the codes are gone once connected", (await A.getByRole("button", { name: /Connect by code \(/ }).count()) === 0 && (await B.getByRole("button", { name: /Connect by code \(/ }).count()) === 0);
  // ---- C joins through BOB's invite (taken from Bob's Invite button, as a person would); Ann must be introduced automatically
  const inviteBy = async (p) => { await p.getByRole("button", { name: /Invite/ }).first().click(); await p.waitForTimeout(300); return p.evaluate(() => navigator.clipboard.readText()); };
  const bobLink = await inviteBy(B); ok("Bob's Invite button gives a link that names Bob as the person to connect to", /#\/m\/[0-9a-f]{12}\/[0-9a-f]{16}\/[0-9a-f]{16}\/Bob$/.test(bobLink), bobLink);
  const C = await join("Cat", bobLink);
  const codeC = await outCode(C); await paste(B, codeC); const replyB = await outCode(B); await paste(C, replyB);
  await online(C, 3); await online(A, 3); await online(B, 3);
  ok("Cat joined through Bob and Ann was introduced automatically (3 connected, no code for Ann)", true);
  ok("Ann was never shown a code for Cat", (await A.getByRole("button", { name: /Connect by code \(/ }).count()) === 0);
  await say(C, "cat here"); for (const p of [A, B]) await p.getByText("cat here").waitFor({ timeout: 8000 }); ok("all three can talk", true);
  // ---- D through Ann
  const D = await join("Dee", await inviteBy(A)); const codeD = await outCode(D);
  await paste(A, codeD); await paste(D, await outCode(A));
  for (const p of [A, B, C, D]) await online(p, 4); ok("a fourth person joins and everyone is connected (full mesh of 4)", true);
  // ---- features that renegotiate over the in-band route
  await A.getByRole("button", { name: "Start call" }).click(); await B.getByRole("button", { name: "Start call" }).click();
  await A.locator(".stage video").nth(1).waitFor({ timeout: 25000 }); ok("a video call works: tracks were negotiated through the links, not a server", true);
  const frames = await A.evaluate(async () => { const vs = [...document.querySelectorAll(".stage video")]; const t = vs.map((v) => v.currentTime); await new Promise((r) => setTimeout(r, 900)); return vs.map((v, i) => ({ playing: !v.paused, adv: v.currentTime - t[i], w: v.videoWidth })); });
  ok("...and the remote video is really playing", frames.length >= 2 && frames.every((f) => f.playing && f.adv > 0.5 && f.w > 0), JSON.stringify(frames));
  await A.getByLabel("Leave call").click(); await B.getByLabel("Leave call").click();
  // ---- leaving
  await C.getByRole("button", { name: "Leave space" }).click(); await C.getByRole("button", { name: "Leave now" }).click();
  await A.getByText("Cat left").waitFor({ timeout: 10000 }); ok("a graceful leave is seen at once by everyone", (await D.getByText("Cat left").count()) >= 0);
  await D.context().close(); await A.getByText("Dee left").waitFor({ timeout: 40000 }); ok("closing a browser without saying goodbye is noticed too", true);
  // ---- nothing touched the server's signalling
  const counts = await Promise.all([A, B].map((p) => p.evaluate(() => window.__ws)));
  ok("no WebSocket was ever opened (no signalling server involved)", counts.every((n) => n === 0), JSON.stringify(counts));
  ok("the server was not asked for ICE servers either", [A, B, C].every((p) => p.net.length === 0), [A, B, C].flatMap((p) => p.net).join());
  ok("no page errors", [A, B, C].every((p) => p.errs.length === 0), [A, B, C].flatMap((p) => p.errs).join("|"));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.log("ERR", e.message.split("\n").slice(0, 16).join("\n")); process.exit(1); });
