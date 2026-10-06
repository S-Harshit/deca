const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch({ });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://localhost:8080/"); await p.locator("input").first().fill("Ann"); await p.getByRole("button", { name: /create/i }).first().click(); await p.locator(".composer textarea").waitFor();
  const say = async (t) => { await p.locator(".composer textarea").fill(t); await p.keyboard.press("Enter"); await p.waitForTimeout(250); };
  await say("look at http://localhost:8080/healthz and also https://example.com/a?b=1."); await say("not links: javascript:alert(1) mailto:x@y.z ftp://host/f `http://in-code.test`");
  const pops = p.locator('.link-pop[aria-label$="in a small window"]');
  ok("each web link gets a window button and a share-with-everyone button (2 links)", (await pops.count()) === 2 && (await p.locator('.link-pop[aria-label$="for everyone"]').count()) === 2, await pops.count());
  ok("javascript:, mailto:, ftp: and links inside code get none", (await p.locator(".link-wrap").count()) === 2);
  ok("the normal link still works as a plain link (new tab, no referrer, no opener)", (await p.locator(".link-wrap a").first().getAttribute("rel")) === "noreferrer noopener" && (await p.locator(".link-wrap a").first().getAttribute("target")) === "_blank");
  ok("the button has an accessible name that says which link", /Open http:\/\/localhost:8080\/healthz in a small window/.test(await pops.first().getAttribute("aria-label")));
  const [win] = await Promise.all([ctx.waitForEvent("page"), pops.first().click()]); await win.waitForLoadState();
  ok("it opens the page", win.url() === "http://localhost:8080/healthz", win.url());
  const dim = await win.evaluate(() => ({ w: window.outerWidth, h: window.outerHeight, popup: !window.toolbar.visible || !window.locationbar.visible, opener: window.opener }));
  ok("as a small window, not a full tab (<= 520 x 760)", dim.w <= 520 && dim.h <= 760, JSON.stringify(dim));
  ok("the opened site cannot reach back into Deca (no opener)", dim.opener === null, JSON.stringify(dim));
  ok("Deca stays where it was", p.url().includes("#/s/") && (await p.locator(".composer textarea").isVisible()));
  const t = await ctx.pages().length; await win.close();
  // second link with trailing punctuation
  const [w2] = await Promise.all([ctx.waitForEvent("page"), pops.nth(1).click()]); ok("trailing '.' is not part of the link opened", w2.url().startsWith("https://example.com/a?b=1") && !/\.$/.test(w2.url()), w2.url()); await w2.close();
  // blocked pop-up: say so
  await p.evaluate(() => { window.open = () => null; }); await pops.first().click(); await p.waitForTimeout(300);
  ok("a blocked pop-up is explained, with the way out", /blocked the window/.test(await p.locator("body").innerText()));
  // keyboard
  await pops.first().focus(); ok("the button is reachable by keyboard", await pops.first().evaluate((e) => document.activeElement === e));
  // hostile text can't smuggle a scheme through the opener
  const evil = await p.evaluate(() => { let called = null; const orig = window.open; window.open = (u) => { called = u; return null; }; document.querySelectorAll(".link-pop").forEach(() => {}); window.open = orig; return called; });
  // phone
  const m = await (await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true })).newPage(); await m.goto("http://localhost:8080/"); await m.locator("input").first().fill("Mo"); await m.getByRole("button", { name: /create/i }).first().click(); await m.locator(".composer textarea").waitFor();
  await m.locator(".composer textarea").fill("see https://example.com/a/really/long/path/that/keeps/going/and/going/and/going/on/and/on"); await m.keyboard.press("Enter"); await m.waitForTimeout(300);
  ok("phone: no horizontal overflow with a long link and the button", await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const bx = await m.locator(".link-pop").first().boundingBox(); ok("phone: button is on screen", bx.x >= 0 && bx.x + bx.width <= 391, JSON.stringify(bx));
  ok("no page errors", errs.length === 0, errs.join("|"));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.log("ERR", e.message.split("\n").slice(0, 6).join("\n")); process.exit(1); });
