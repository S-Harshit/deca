const { chromium } = require("../lib/browser.cjs"); const { PNG } = require("pngjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch({ });
  const p = await (await b.newContext({ viewport: { width: 1200, height: 800 } })).newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://localhost:8080/");
  const open = async () => { if (!(await p.getByRole("dialog", { name: /Appearance/ }).count())) await p.getByLabel("Appearance").click(); };
  const pick = async (f) => { await open(); await p.locator('input[aria-label="Choose a wallpaper"]').setInputFiles(f); await p.waitForTimeout(900); };
  const img = () => p.evaluate(() => document.documentElement.style.getPropertyValue("--wall-img"));
  const avg = async (clip) => { const png = PNG.sync.read(await p.screenshot({ clip })); let r = 0, g = 0, bl = 0, n = png.width * png.height; for (let i = 0; i < png.data.length; i += 4) { r += png.data[i]; g += png.data[i + 1]; bl += png.data[i + 2]; } return { r: r / n, g: g / n, b: bl / n }; };
  await open(); await p.locator('input[aria-label="Choose a wallpaper"]').setInputFiles("wall/blue.png"); await p.waitForFunction(() => document.documentElement.style.getPropertyValue("--wall-img").startsWith("url("));
  await p.getByLabel("Wallpaper dimming").fill("0"); await p.waitForTimeout(300);
  await p.keyboard.press("Escape"); await p.mouse.click(40, 700); await p.waitForTimeout(300);
  const url1 = await img(); const c1 = await avg({ x: 20, y: 300, width: 200, height: 200 });
  ok("blue picture: background is blue", c1.b > c1.r + 40, JSON.stringify(c1));
  // change to red while one is already there
  await pick("wall/red.png"); await p.keyboard.press("Escape"); await p.mouse.click(40, 700); await p.waitForTimeout(300);
  const url2 = await img(); const c2 = await avg({ x: 20, y: 300, width: 200, height: 200 });
  ok("the background image reference changed", url2 !== url1 && url2.startsWith("url("), `${url1} -> ${url2}`);
  ok("red picture: background is now red (not still blue)", c2.r > c2.b + 40, JSON.stringify(c2));
  // and again, and back, and inside a room
  await pick("wall/blue.png"); await p.keyboard.press("Escape"); await p.mouse.click(40, 700); await p.waitForTimeout(300);
  const c3 = await avg({ x: 20, y: 300, width: 200, height: 200 }); ok("blue again", c3.b > c3.r + 40, JSON.stringify(c3));
  await p.locator("input").first().fill("Wally"); await p.getByRole("button", { name: /create/i }).first().click(); await p.locator(".composer textarea").waitFor();
  const room = () => avg({ x: 900, y: 120, width: 250, height: 200 });
  const r1 = await room(); ok("in a room: blue background", r1.b > r1.r + 20, JSON.stringify(r1));
  await pick("wall/red.png"); await p.keyboard.press("Escape"); await p.mouse.click(700, 600); await p.waitForTimeout(300);
  const r2 = await room(); ok("in a room: changing the picture changes the background", r2.r > r2.b + 20, JSON.stringify(r2));
  // reload keeps the latest picture, not the first
  await p.reload(); await p.waitForFunction(() => document.documentElement.style.getPropertyValue("--wall-img").startsWith("url(")); await p.waitForTimeout(500);
  await p.locator("input").first().fill("Wally"); await p.getByRole("button", { name: /create|join/i }).first().click(); await p.locator(".composer textarea").waitFor();
  const r3 = await room(); ok("after a reload the latest picture is shown", r3.r > r3.b + 20, JSON.stringify(r3));
  ok("no page errors", errs.length === 0, errs.join("|"));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.log("ERR", e.message.split("\n").slice(0, 5).join("\n")); process.exit(1); });
