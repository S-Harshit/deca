// The "Zinc" (shadcn-style) theme: picked from the Appearance panel, flat surfaces, near-black primary, no layout damage on phone or desktop.
const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const p = await (await b.newContext({ viewport: { width: 1300, height: 850 }, permissions: ["camera", "microphone"] })).newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://localhost:8080/"); await p.locator("input").first().fill("Ann"); await p.getByRole("button", { name: /create/i }).first().click(); await p.locator(".composer textarea").waitFor();
  await p.getByLabel("Appearance").click(); await p.getByRole("button", { name: "Zinc" }).click(); await p.waitForTimeout(300);
  ok("picking Zinc sets the theme", (await p.evaluate(() => document.documentElement.dataset.theme)) === "shadcn");
  const css = (sel, prop) => p.evaluate(([s, pr]) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[pr] : null; }, [sel, prop]);
  ok("page is white, text near-black", (await css("body", "backgroundColor")) === "rgb(255, 255, 255)" && (await css("body", "color")) === "rgb(9, 9, 11)" || (await css(".app", "color")) === "rgb(9, 9, 11)");
  ok("panels have a soft shadow, not the offset sticker shadow", !/ 4px 4px 0px/.test(await css(".panel", "boxShadow") ?? "") && (await css(".panel", "boxShadow")) !== "none");
  ok("the chat has no dot grid", (await css(".chat", "backgroundImage")) === "none");
  ok("primary button is the near-black zinc", await p.evaluate(() => { const e = document.querySelector("button.primary, .icon-btn.primary-ish") ; return !e || getComputedStyle(e).backgroundColor === "rgb(24, 24, 27)"; }));
  ok("the header is not damaged (top bar fits, nothing overflows sideways)", (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
  const bb = (loc) => p.locator(loc).first().boundingBox();
  const horn = await p.locator(".horn-btn").first();
  ok("the wake-up button is still red and visible (it once went white)", (await horn.count()) === 1 && (await horn.evaluate((e) => getComputedStyle(e).backgroundColor)) === "rgb(217, 45, 32)" && (await horn.isVisible()));
  const yt = await bb('input[aria-label="YouTube link"]'), add = await bb('button[aria-label="Add to queue"]');
  ok("the YouTube box and its button are the same height", !!yt && !!add && Math.abs(yt.height - add.height) < 1.5, JSON.stringify([yt?.height, add?.height]));
  const inv = await bb(".invite-card input, .invite-card code"), cp = await bb(".invite-card button");
  ok("the invite link and its Copy button are the same height", !!inv && !!cp && Math.abs(inv.height - cp.height) < 1.5, JSON.stringify([inv?.height, cp?.height]));
  const comp = await bb(".composer textarea"), send = await bb(".composer .icon-btn:last-of-type");
  ok("the chat box and Send line up (within a few pixels)", !!comp && !!send && Math.abs(comp.height - send.height) < 6, JSON.stringify([comp?.height, send?.height]));
  // a call: tiles and the call timer still lay out
  await p.getByLabel("Start call").click(); await p.waitForTimeout(2000);
  const tile = await p.locator(".tile").first().boundingBox(); ok("a call tile shows with a sensible size", !!tile && tile.width > 150 && tile.height > 80, JSON.stringify(tile));
  ok("the tile label is not rotated", (await css(".tile-label", "transform")) === "none");
  await p.screenshot({ path: "zinc-room.png" });
  // reload keeps it
  await p.reload(); await p.locator("input").first().fill("Ann"); await p.waitForTimeout(300);
  ok("the choice survives a reload", (await p.evaluate(() => document.documentElement.dataset.theme)) === "shadcn");
  await p.screenshot({ path: "zinc-home.png" });
  // phone
  const m = await (await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true })).newPage();
  await m.addInitScript(() => { const v = JSON.parse(localStorage.getItem("deca.prefs") || "{}"); v.theme = "shadcn"; localStorage.setItem("deca.prefs", JSON.stringify(v)); });
  await m.goto("http://localhost:8080/"); await m.locator("input").first().fill("Mo"); await m.getByRole("button", { name: /create/i }).first().click(); await m.locator(".composer textarea").waitFor();
  await m.getByRole("button", { name: "Members", exact: true }).click();
  ok("phone: the dim layer behind the drawer is still dim (not white)", await m.evaluate(() => { const e = document.querySelector(".scrim"); return !!e && /rgba\(0, 0, 0, 0\.5/.test(getComputedStyle(e).backgroundColor); }));
  await m.locator(".scrim").click({ position: { x: 385, y: 400 } });
  ok("phone: no sideways scroll", (await m.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
  await m.screenshot({ path: "zinc-phone.png" });
  ok("no page errors", errs.length === 0, errs.join());
  console.log(`\n${pass} passed, ${fail} failed`); await b.close();
})();
