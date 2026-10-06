const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch({ });
  // home screen
  for (const [w, h] of [[1200, 800], [390, 780], [320, 640]]) for (const home of ["simple", "classic"]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage();
    await p.addInitScript((home) => localStorage.setItem("deca.prefs", JSON.stringify({ theme: "graphite", home })), home);
    await p.goto("http://localhost:8080/");
    const card = p.locator(".card.ticket"); await card.waitFor();
    ok(`${home} home @${w}: ticket header + barcode present`, (await card.locator(".ticket-head").count()) === 1 && (await card.locator(".barcode").count()) === 1);
    ok(`${home} home @${w}: dashed ticket border`, await card.evaluate((e) => getComputedStyle(e).borderStyle === "dashed"));
    ok(`${home} home @${w}: dotted backdrop`, await p.locator(".landing").evaluate((e) => getComputedStyle(e).backgroundImage.includes("radial-gradient")));
    ok(`${home} home @${w}: no horizontal overflow`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const bb = await card.boundingBox(); ok(`${home} home @${w}: card on screen`, bb.x >= 0 && bb.x + bb.width <= w + 0.5, JSON.stringify(bb));
    if (home === "simple") { await p.locator("input").first().fill("Zed"); ok(`simple home @${w}: can create a space`, await p.getByRole("button", { name: "Create a space" }).isEnabled()); }
    await ctx.close();
  }
  // invite link on simple
  { const p = await (await b.newContext()).newPage(); await p.goto("http://localhost:8080/#/s/abcdef123456");
    ok("simple invite shows INVITATION ticket", (await p.locator(".ticket-head").first().textContent()).includes("INVITATION") && (await p.getByRole("button", { name: "Join space" }).count()) === 1); }
  // now-playing pill vs corner setting
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } }); const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://localhost:8080/"); await p.locator("input").first().fill("T"); await p.getByRole("button", { name: /create/i }).first().click(); await p.locator(".composer textarea").waitFor();
  await p.getByLabel("YouTube link").fill("https://youtu.be/jNQXAC9IVRw"); await p.getByLabel("Add to queue").click(); await p.locator(".now-playing").waitFor({ timeout: 15000 });
  for (const r of [4, 8, 18]) {
    await p.evaluate((r) => document.documentElement.style.setProperty("--radius", r + "px"), r);
    const m = await p.evaluate(() => { const pill = document.querySelector(".now-playing"), btn = pill.querySelector(".icon-btn"); const a = pill.getBoundingClientRect(), c = btn.getBoundingClientRect(); const pr = parseFloat(getComputedStyle(pill).borderTopLeftRadius), br = parseFloat(getComputedStyle(btn).borderTopLeftRadius); return { inside: c.left >= a.left && c.right <= a.right && c.top >= a.top && c.bottom <= a.bottom, pr, br, h: a.height }; });
    ok(`pill @radius ${r}: button fully inside`, m.inside, JSON.stringify(m));
    ok(`pill @radius ${r}: pill corners at least as round as button`, m.pr >= Math.min(m.br, m.h / 2) - 0.5, JSON.stringify(m));
    // corner pixels: button corner must not be outside the pill's rounded corner -> check the button's corner point lies inside the pill's rounded shape
    const corner = await p.evaluate(() => { const pill = document.querySelector(".now-playing"), btn = pill.querySelector(".icon-btn"); const a = pill.getBoundingClientRect(), c = btn.getBoundingClientRect(); const R = Math.min(parseFloat(getComputedStyle(pill).borderTopRightRadius), a.height / 2); const bR = Math.min(parseFloat(getComputedStyle(btn).borderTopRightRadius), c.height / 2); const cx = a.right - R, cy = a.top + R; const px = c.right - bR + bR * Math.SQRT1_2, py = c.top + bR - bR * Math.SQRT1_2; return Math.hypot(px - cx, py - cy) <= R + 0.5 || px <= cx || py >= cy; });
    ok(`pill @radius ${r}: button's rounded corner clears the pill's corner`, corner);
  }
  ok("no page errors", errs.length === 0, errs.join("|"));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.log("ERR", e.message.split("\n")[0]); process.exit(1); });
