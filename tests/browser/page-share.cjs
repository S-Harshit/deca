const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch({ });
  const mk = async (name, room, vp = { width: 1280, height: 800 }, extra = {}) => { const ctx = await b.newContext({ viewport: vp, ...extra }); const p = await ctx.newPage(); p.ctx = ctx; p.errs = []; p.on("pageerror", (e) => p.errs.push(e.message)); await p.goto(room || "http://localhost:8080/"); await p.locator("input").first().fill(name); await p.getByRole("button", { name: room ? /join/i : /create/i }).first().click(); await p.locator(".composer textarea").waitFor(); return p; };
  const say = async (p, t) => { await p.locator(".composer textarea").fill(t); await p.keyboard.press("Enter"); await p.waitForTimeout(250); };
  const A = await mk("Ann"); const room = A.url(); const B = await mk("Bob", room); const C = await mk("Cat", room);
  for (const p of [A, B, C]) { await p.getByText("Bob joined").waitFor({ timeout: 20000 }); await p.getByText("Cat joined").waitFor({ timeout: 20000 }); }
  const bar = (p) => p.locator(".shared-page");
  ok("no bar before anything is shared", (await bar(B).count()) === 0);
  await say(A, "check this listing http://localhost:8080/healthz please");
  await B.getByRole("button", { name: /for everyone/ }).first().waitFor({ timeout: 8000 });
  ok("every link has an 'open for everyone' button, for every member (not only the sender)", (await B.getByRole("button", { name: /for everyone/ }).count()) === 1);
  // --- Bob shares Ann's link
  await B.getByRole("button", { name: /for everyone/ }).first().click();
  for (const p of [A, B, C]) await bar(p).waitFor({ timeout: 8000 });
  ok("everyone in the room gets the bar", true);
  ok("it names who shared and the site, in plain words", /Bob opened a page for everyone: localhost/.test(await bar(A).innerText()) && /Bob opened a page for everyone: localhost/.test(await bar(C).innerText()), await bar(C).innerText());
  ok("the sharer sees 'You'", /^You opened a page for everyone/.test((await bar(B).innerText()).trim()), await bar(B).innerText());
  ok("the timeline records it as a line too", (await C.locator(".sys", { hasText: "opened a page for everyone: localhost" }).count()) === 1);
  ok("NOTHING opened by itself on anyone's computer (no extra windows)", [A, B, C].every((p) => p.ctx.pages().length === 1), [A, B, C].map((p) => p.ctx.pages().length).join());
  // --- Cat opens it: a real small window, only her bar goes
  const [win] = await Promise.all([C.ctx.waitForEvent("page"), bar(C).getByRole("button", { name: "Open" }).click()]); await win.waitForLoadState();
  ok("Open gives that person a small window with the page", win.url() === "http://localhost:8080/healthz", win.url());
  ok("the window cannot reach back into Deca", (await win.evaluate(() => window.opener)) === null);
  ok("her bar closes; Ann's and Bob's stay (each person decides)", (await bar(C).count()) === 0 && (await bar(A).count()) === 1 && (await bar(B).count()) === 1);
  await win.close();
  // --- dismiss is personal
  await bar(A).getByRole("button", { name: "Dismiss" }).click(); ok("Dismiss hides it for that person only", (await bar(A).count()) === 0 && (await bar(B).count()) === 1);
  // --- late joiner still sees the page of the moment
  const D = await mk("Dee", room); await bar(D).waitFor({ timeout: 15000 }); ok("someone who joins afterwards sees what the room is looking at", /Bob opened a page for everyone: localhost/.test(await bar(D).innerText()));
  // --- a newer share replaces the older and re-appears for those who dismissed
  await say(C, "and this http://localhost:8080/games.json"); await C.getByRole("button", { name: /games\.json for everyone/ }).click();
  await A.waitForFunction(() => /Cat opened/.test(document.querySelector(".shared-page")?.textContent || ""), null, { timeout: 8000 });
  ok("a newer shared page replaces the old one, for everyone, including people who dismissed the first", /Cat opened a page for everyone/.test(await bar(A).innerText()) && /Cat opened/.test(await bar(B).innerText()) && /Cat opened/.test(await bar(D).innerText()));
  ok("only one bar at a time", (await A.locator(".shared-page").count()) === 1);
  // --- rate limit: two quick shares from one person -> one goes, one is told to wait
  await say(A, "x http://localhost:8080/a y http://localhost:8080/b"); const btns = A.getByRole("button", { name: /for everyone/ });
  const n0 = await A.locator(".sys", { hasText: "opened a page for everyone" }).count();
  await A.getByRole("button", { name: /\/a for everyone/ }).click(); await A.getByRole("button", { name: /\/b for everyone/ }).click(); await A.waitForTimeout(600);
  ok("a second share within 3 seconds is refused politely", /Wait a moment/.test(await A.locator("body").innerText()), "");
  ok("...and only one reached the room", (await A.locator(".sys", { hasText: "opened a page for everyone" }).count()) === n0 + 1, `${n0} -> ${await A.locator(".sys", { hasText: "opened a page for everyone" }).count()}`);
  void btns;
  // --- disguised address: can't be shared, no event
  await A.waitForTimeout(3200); await say(A, "pay here https://www.amazon.com@evil.example/login now");
  const before = await B.locator(".sys", { hasText: "opened a page for everyone" }).count();
  await A.getByRole("button", { name: /evil\.example\/login for everyone/ }).click(); await A.waitForTimeout(500);
  ok("a link with a disguised login (user@host) refuses to be shared", /not a web address I can share/.test(await A.locator("body").innerText()) && (await B.locator(".sys", { hasText: "opened a page for everyone" }).count()) === before);
  // --- look-alike letters are flagged
  await A.waitForTimeout(2800); await say(A, "https://аmazon.com/deal"); await A.getByRole("button", { name: /deal for everyone/ }).click();
  await B.waitForFunction(() => /International|international/.test(document.querySelector(".shared-page")?.textContent || ""), null, { timeout: 8000 });
  ok("a look-alike address (Cyrillic letter) is shown as punycode with a warning", /xn--/.test(await bar(B).innerText()) && /look-alike international letters/.test(await bar(B).innerText()), await bar(B).innerText());
  // --- chat off: members cannot share, host can
  await A.getByLabel("Members can chat").uncheck(); await B.waitForTimeout(800);
  const c0 = await C.locator(".sys", { hasText: "opened a page for everyone" }).count();
  await B.getByRole("button", { name: /for everyone/ }).first().click(); await B.waitForTimeout(500);
  ok("with chat off a member's share is refused and explained", /turned chat off/.test(await B.locator("body").innerText()) && (await C.locator(".sys", { hasText: "opened a page for everyone" }).count()) === c0);
  await A.getByLabel("Members can chat").check();
  // --- layout
  const bb = await bar(B).boundingBox(); ok("the bar fits inside the chat column", bb.x >= 0 && bb.x + bb.width <= 1281, JSON.stringify(bb));
  const M = await mk("Mo", room, { width: 390, height: 780 }, { hasTouch: true, isMobile: true }); await bar(M).waitFor({ timeout: 15000 });
  const mb = await bar(M).boundingBox(); ok("phone: bar fits the screen and doesn't overflow", mb.x >= 0 && mb.x + mb.width <= 391 && (await M.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)), JSON.stringify(mb));
  ok("no page errors", [A, B, C, D, M].every((p) => p.errs.length === 0), [A, B, C, D, M].flatMap((p) => p.errs).join("|"));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.log("ERR", e.message.split("\n").slice(0, 8).join("\n")); process.exit(1); });
