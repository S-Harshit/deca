const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  for (const [label, ctxOpts] of [["desktop (real fullscreen)", { viewport: { width: 1300, height: 900 } }], ["phone (page-filling overlay)", { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true }]]) {
    console.log("==", label);
    const p = await (await b.newContext(ctxOpts)).newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto("http://localhost:8080/"); await p.locator("input").first().fill("Ann"); await p.getByRole("button", { name: /create/i }).first().click(); await p.locator(".composer textarea").waitFor();
    if (ctxOpts.isMobile) { await p.getByRole("button", { name: "Members", exact: true }).click(); }
    await p.getByLabel("YouTube link").fill("https://youtu.be/jNQXAC9IVRw"); await p.getByLabel("Add to queue").click(); await p.locator(".np-title").waitFor({ timeout: 15000 });
    await p.getByLabel("Maximise player").click(); await p.waitForTimeout(500);
    ok("the player is maximised", (await p.locator(".panel.music.max").count()) === 1);
    await p.getByLabel("Next track").click();            // the song ends with nothing queued
    await p.waitForTimeout(1200);
    ok("when the song ends the big view closes by itself", (await p.locator(".panel.music.max").count()) === 0);
    ok("browser fullscreen is left", (await p.evaluate(() => document.fullscreenElement === null)));
    if (ctxOpts.isMobile) await p.locator(".scrim").click({ position: { x: 385, y: 400 } }); ok("the page controls (composer) are reachable again", await p.locator(".composer textarea").isVisible());
    ok("no page errors", errs.length === 0, errs.join());
    await p.context().close();
  }
  console.log(`\n${pass} passed, ${fail} failed`); await b.close();
})();
