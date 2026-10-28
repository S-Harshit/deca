// Pixel Hop together: two people in a room both open the game and are one team: they see each other, share coins, can stand on each other,
// the level clears only when both are at the flag, and nothing a stranger sends can break the game.
const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch();
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1300, height: 900 } }); const p = await c.newPage(); p.on("pageerror", (e) => console.log("pageerror", e.message)); return p; };
  const A = await mk(); await A.goto("http://localhost:8080/"); await A.locator("input").first().fill("Ann"); await A.getByRole("button", { name: /create/i }).first().click(); await A.locator(".composer textarea").waitFor();
  const B = await mk(); await B.goto(A.url()); await B.locator("input").first().fill("Ben"); await B.getByRole("button", { name: /join/i }).first().click(); await B.locator(".composer textarea").waitFor();
  await A.waitForFunction(() => /\b2 \/ /.test(document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || ""), null, { timeout: 30000 });
  const open = async (p) => { await p.getByRole("button", { name: /game/i }).first().click(); await p.locator("iframe").waitFor(); const sel = p.locator(".game-bar select"); if (await sel.count()) await sel.selectOption("platformer"); await p.waitForTimeout(900); return p.frames().find((x) => /games\/platformer/.test(x.url())); };
  const fa = await open(A), fb = await open(B);
  // the game loop pauses in a window that is not focused (as these headless ones are), so the test turns the crank itself
  const run = async (n = 8, rounds = 3) => { for (let r = 0; r < rounds; r++) { await Promise.all([fa.evaluate((k) => __pixelHop.step(k), n), fb.evaluate((k) => __pixelHop.step(k), n)]); await A.waitForTimeout(120); } };
  await run();
  const names = (f) => f.evaluate(() => __pixelHop.mates.map((m) => m.name).join());
  ok("each sees the other as a teammate, by name", (await names(fa)) === "Ben" && (await names(fb)) === "Ann", (await names(fa)) + " / " + (await names(fb)));

  // a coin taken by one is gone for both
  const coinsLeft = (f) => f.evaluate(() => __pixelHop.coinsLeft);
  const before = await coinsLeft(fb);
  await fa.evaluate(() => { const k = __pixelHop.coins[0]; __pixelHop.teleport(k.x - 2, k.y - 2); });
  await run(8, 4);
  ok("a coin Ann takes disappears for Ben too", (await coinsLeft(fb)) === before - 1 && (await coinsLeft(fa)) === before - 1, `${await coinsLeft(fa)} / ${await coinsLeft(fb)} from ${before}`);

  // standing on a teammate: B drops onto A from above and stays up
  await fa.evaluate(() => { __pixelHop.teleport(300, 120); });
  await run(8, 3);
  const aPos = await fa.evaluate(() => ({ x: __pixelHop.p.x, y: __pixelHop.p.y }));
  await fb.evaluate((a) => { __pixelHop.teleport(a.x + 1, a.y - 60); }, aPos);
  await run(10, 6);
  const bY = await fb.evaluate(() => __pixelHop.p.y), aY2 = await fa.evaluate(() => __pixelHop.p.y);
  ok("a player can land on a teammate's head instead of falling past", bY <= aY2 - 10, `B at ${bY}, A at ${aY2}`);

  // the flag: A gets there first and waits; the level clears for both only when B arrives
  const flag = await fa.evaluate(() => (__pixelHop.cols - 9) * 16);
  await fa.evaluate((x) => __pixelHop.teleport(x, 140), flag);
  await run(8, 3);
  ok("the first to the flag waits for the other", (await fa.evaluate(() => __pixelHop.state)) === "wait" && (await fa.evaluate(() => __pixelHop.level)) === 0);
  await fb.evaluate((x) => __pixelHop.teleport(x, 140), flag);
  await run(8, 4); await run(60, 5);
  ok("when both are there the next level starts for both, by itself", (await fa.evaluate(() => __pixelHop.level)) === 1 && (await fb.evaluate(() => __pixelHop.level)) === 1, `${await fa.evaluate(() => __pixelHop.level)} / ${await fb.evaluate(() => __pixelHop.level)}`);

  // hostile input from another player is clamped or dropped
  const hostile = await fa.evaluate(() => {
    const msgs = [{ k: "p", x: 1e12, y: -1e12, lv: 0, f: 5, d: 1, o: 1 }, { k: "p", x: "x", y: 1, lv: 0 }, { k: "p", x: 5, y: 5, lv: 99 }, { k: "c", i: 999999, lv: 1 }, { k: "c", i: -1, lv: 1 }, "junk", null, { k: "p", x: 5, y: 5, lv: 1, __proto__: { polluted: 1 } }];
    for (const m of msgs) postMessage({ deca: "net", from: "evil", name: "<img onerror=1>".repeat(30), data: m }, location.origin);
    return true;
  });
  await run(8, 3);
  const evil = await fa.evaluate(() => __pixelHop.mates.find((m) => m.id === "evil"));
  ok("hostile messages cannot break it: positions are clamped, names cut short, bad ones dropped", hostile && (!evil || (evil.x <= 270 * 16 && evil.y >= -200 && evil.y <= 392 && evil.name.length <= 16)) && (await fa.evaluate(() => __pixelHop.state)) !== undefined, JSON.stringify(evil));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
