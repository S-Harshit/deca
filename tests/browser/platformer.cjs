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
    if (lv < 2) await p.evaluate(() => __pixelHop.nextLevel());
  }
  await p.evaluate(() => { __pixelHop.step(1); });
  await p.keyboard.press("r"); // back to level 1
  ok("restart goes back to level 1", (await p.evaluate(() => __pixelHop.level)) === 0);
  // the autopilot plays all three levels to the end
  let state = "play", steps = 0; const seen = new Set();
  while (state !== "win" && steps < 90000) { state = await p.evaluate(() => { __pixelHop.step(600); return [__pixelHop.state, __pixelHop.level].join(); }).then((v) => { const [s2, l] = v.split(","); seen.add(+l); return s2; }); steps += 600; if (state === "over") break; }
  ok("the autopilot finishes all three levels", state === "win" && seen.has(0) && seen.has(1) && seen.has(2), `${state} after ${steps} frames, levels ${[...seen]}`);
  ok("no page errors", errs.length === 0, errs.join());
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
