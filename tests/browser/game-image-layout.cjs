// A picture shared while a game is open must not take over the chat; the "/" list shows exactly one highlighted row.
const { chromium } = require("../lib/browser.cjs"); const { PNG } = require("pngjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch();
  const png = new PNG({ width: 1600, height: 2400 }); for (let i = 0; i < png.data.length; i += 4) { png.data[i] = (i / 4) % 255; png.data[i + 1] = 80; png.data[i + 2] = 160; png.data[i + 3] = 255; } const buf = PNG.sync.write(png);
  for (const [w, h] of [[1500, 900], [1100, 800], [900, 700]]) {
    const A = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
    await A.goto("http://localhost:8080/"); await A.locator("input").first().fill("Ann"); await A.getByRole("button", { name: /create/i }).first().click(); await A.locator(".composer textarea").waitFor();
    await A.getByRole("button", { name: /game/i }).first().click().catch(() => {}); const gameOpen = (await A.locator("iframe").count()) > 0;
    await A.locator('input[aria-label="Attach files"]').setInputFiles({ name: "big.png", mimeType: "image/png", buffer: buf }); await A.waitForTimeout(1200);
    const r = await A.evaluate(() => { const q = (s) => document.querySelector(s)?.getBoundingClientRect(); const img = q(".image img"), tl = q(".timeline"), chat = q(".chat"); return { img: img && [Math.round(img.width), Math.round(img.height)], tl: tl && Math.round(tl.height), chat: chat && Math.round(chat.height), sw: document.documentElement.scrollWidth - innerWidth, sh: document.documentElement.scrollHeight - innerHeight, vh: innerHeight }; });
    ok(`${w}x${h}${gameOpen ? " with a game open" : ""}: a tall picture stays a thumbnail (at most a third of the screen high)`, r.img && r.img[1] <= r.vh * 0.34, JSON.stringify(r));
    ok(`${w}x${h}: the page does not overflow`, r.sw <= 0 && r.sh <= 0, JSON.stringify(r));
    ok(`${w}x${h}: the chat keeps a usable height`, r.chat >= r.vh * 0.35, JSON.stringify(r));
    await A.context().close();
  }
  // the "/" list: one highlighted row, and the pointer resting on another row does not light a second one
  const C = await (await b.newContext({ viewport: { width: 1300, height: 850 } })).newPage();
  await C.goto("http://localhost:8080/"); await C.locator("input").first().fill("Cy"); await C.getByRole("button", { name: /create/i }).first().click(); await C.locator(".composer textarea").waitFor();
  await C.locator(".composer textarea").fill("/"); const list = C.getByRole("listbox", { name: "Commands" }); await list.waitFor();
  const box = await list.getByRole("option").nth(4).boundingBox();
  await C.locator(".composer textarea").fill(""); await C.mouse.move(box.x + 40, box.y + 10); await C.waitForTimeout(150); // the pointer rests where the fifth row will appear
  await C.locator(".composer textarea").fill("/"); await list.waitFor(); await C.waitForTimeout(250);
  await C.locator(".composer textarea").press("ArrowDown"); await C.waitForTimeout(250);
  const state = await list.getByRole("option").evaluateAll((els) => els.map((e) => ({ sel: e.getAttribute("aria-selected"), bg: getComputedStyle(e).backgroundColor })));
  const marked = state.filter((s) => s.sel === "true").length, lit = state.filter((s) => s.bg !== "rgba(0, 0, 0, 0)" && s.bg !== "transparent").length;
  ok("the arrow key moves the one highlight (the resting pointer does not steal it)", marked === 1 && state[1].sel === "true", JSON.stringify(state));
  ok("and only the chosen row is lit, not the one under the pointer", lit === 1, JSON.stringify(state));
  await C.mouse.move(box.x + 60, box.y + 12, { steps: 4 }); await C.waitForTimeout(200);
  ok("a real mouse move onto a row chooses it", (await list.getByRole("option").nth(4).getAttribute("aria-selected")) === "true");
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
