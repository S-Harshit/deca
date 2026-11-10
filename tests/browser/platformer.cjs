// Pixel Hop: three levels, every coin can be touched by a jump from the ground below it, and each level can be finished (the built-in autopilot).
const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 900, height: 600 } })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://localhost:8080/games/platformer/index.html?bot=1"); await p.waitForFunction(() => window.__pixelHop);
  ok("there are three levels", (await p.evaluate(() => __pixelHop.levels)) === 3);
  for (let lv = 0; lv < 3; lv++) {
    const r = await p.evaluate(() => {
      const H = __pixelHop, g = H.grid, T = 16, ROWS = 12, GROUND = 10; let worst = 0, high = 0;
      for (const k of H.coins) {
        const col = Math.floor((k.x + 4) / T); let top = GROUND * T;
        for (let r2 = Math.max(0, Math.floor(k.y / T)); r2 < ROWS; r2++) if (g[r2][col] === 1) { top = r2 * T; break; }
        const up = top - k.y; worst = Math.max(worst, up); if (up > 56) high++; // a full hop reaches about 45 px, plus the coin's own height
      }
      return { n: H.coins.length, worst, high, cols: H.cols };
    });
    ok(`level ${lv + 1}: ${r.n} coins, none higher above the ground than a hop can reach (worst ${Math.round(r.worst)} px)`, r.n > 20 && r.high === 0, JSON.stringify(r));
    const geo = await p.evaluate(() => {
      const H = __pixelHop, g = H.grid, T = 16; let bricks = 0, blocks = 0, overlap = 0;
      for (const row of g) for (const v of row) { if (v === 2) bricks++; if (v === 3) blocks++; }
      for (const k of H.coins) for (let r = Math.floor(k.y / T); r <= Math.floor((k.y + 11) / T); r++) for (let q = Math.floor(k.x / T); q <= Math.floor((k.x + 7) / T); q++) if (g[r]?.[q] >= 1 && g[r][q] <= 4) overlap++;
      return { bricks, blocks, overlap, items: [...H.items.values()] };
    });
    ok(`level ${lv + 1}: no floating brick layer, no coin sits inside a block or the ground`, geo.bricks === 0 && geo.overlap === 0, JSON.stringify(geo));
    ok(`level ${lv + 1}: every ? block holds a power-up, not a coin`, geo.blocks > 0 && geo.items.length === geo.blocks && geo.items.every((i) => ["shield", "boots", "heart"].includes(i)), JSON.stringify(geo));
    if (lv < 2) await p.evaluate(() => __pixelHop.nextLevel());
  }
  // what the power-ups do, by hitting real blocks
  const power = await p.evaluate(() => {
    const H = __pixelHop; const out = {}; const g = H.grid;
    const find = (kind) => { for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) if (g[r][c] === 3 && H.items.get(r * g[0].length + c) === kind) return [c, r]; return null; };
    for (const kind of ["shield", "boots", "heart"]) { const at = find(kind); out[kind] = !!at; }
    const sh = find("shield"); if (sh) { H.bump(sh[0], sh[1]); const lives0 = H.lives; H.p.inv = 0; H.hurt(); out.shieldAbsorbed = H.p.shield === false && H.lives === lives0; H.p.inv = 0; H.hurt(); out.thenHurts = H.lives === lives0 - 1; }
    const bo = find("boots"); if (bo) { H.bump(bo[0], bo[1]); out.boots = H.p.boots > 0; }
    const he = find("heart"); if (he) { const l = H.lives; H.bump(he[0], he[1]); out.heart = H.lives === Math.min(5, l + 1); }
    return out;
  });
  ok("blocks hold shields, high jumps and extra lives across the levels", power.shield && power.boots && power.heart, JSON.stringify(power));
  ok("a shield takes one hit, then the next one hurts", power.shieldAbsorbed && power.thenHurts, JSON.stringify(power));
  ok("a high-jump block gives the boots, a heart block a life", power.boots && power.heart, JSON.stringify(power));
  await p.evaluate(() => { __pixelHop.step(1); });
  await p.keyboard.press("r"); // back to level 1
  ok("restart goes back to level 1", (await p.evaluate(() => __pixelHop.level)) === 0);
  // the autopilot plays all three levels to the end
  let state = "play", steps = 0; const seen = new Set();
  while (state !== "win" && steps < 90000) { state = await p.evaluate(() => { __pixelHop.step(600); return [__pixelHop.state, __pixelHop.level].join(); }).then((v) => { const [s2, l] = v.split(","); seen.add(+l); return s2; }); steps += 600; if (state === "over") break; }
  ok("the autopilot finishes all three levels", state === "win" && seen.has(0) && seen.has(1) && seen.has(2), `${state} after ${steps} frames, levels ${[...seen]}`);
  // touch pad: shown on a touch screen only, and holding a button plays the game
  const t = await (await b.newContext({ viewport: { width: 400, height: 700 } })).newPage(); t.on("pageerror", (e) => errs.push(e.message));
  await t.goto("http://localhost:8080/games/platformer/index.html"); await t.waitForFunction(() => window.__pixelHop);
  ok("no pad without a touch screen", !(await t.locator("#pad").isVisible()));
  await t.goto("http://localhost:8080/games/platformer/index.html?touch=1"); await t.waitForFunction(() => window.__pixelHop);
  ok("the pad shows on a touch screen", await t.locator("#pad").isVisible());
  const x0 = await t.evaluate(() => __pixelHop.p.x);
  const right = (await t.getByLabel("Move right").boundingBox());
  await t.mouse.move(right.x + 30, right.y + 30); await t.mouse.down(); await t.evaluate(() => __pixelHop.step(60));
  const x1 = await t.evaluate(() => __pixelHop.p.x);
  await t.mouse.up(); await t.evaluate(() => __pixelHop.step(60));
  const x2 = await t.evaluate(() => __pixelHop.p.x);
  ok("holding right runs the fox right", x1 > x0 + 20, `${x0} -> ${x1}`);
  const rest = await t.evaluate(() => { __pixelHop.step(120); return __pixelHop.p.x; });
  ok("letting go stops it", Math.abs(rest - x2) < 3, `${x2} -> ${rest}`);
  const jump = await t.getByLabel("Jump").boundingBox();
  await t.mouse.move(jump.x + 30, jump.y + 30); await t.mouse.down(); await t.evaluate(() => __pixelHop.step(8));
  ok("jump lifts the fox", await t.evaluate(() => __pixelHop.p.vy < 0 || !__pixelHop.p.on)); await t.mouse.up();
  ok("no page errors", errs.length === 0, errs.join());
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
