// Clicking the seek bar must not rubber-band: after the click the bar stays near where it was put while the player catches up.
// Needs the internet (a real YouTube player).
const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const p = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  await p.goto("http://localhost:8080/"); await p.locator("input").first().fill("Ann");
  await p.getByRole("button", { name: /create/i }).first().click(); await p.locator(".composer textarea").waitFor();
  await p.getByLabel("YouTube link").fill("https://www.youtube.com/watch?v=9bZkp7q19f0"); await p.getByLabel("Add to queue").click();
  await p.locator(".np-title").waitFor({ timeout: 40000 });
  const seek = p.locator(".music input.seek");
  await p.waitForFunction(() => Number(document.querySelector(".music input.seek")?.max) > 100, null, { timeout: 30000 });
  await p.waitForTimeout(3000);
  const max = Number(await seek.getAttribute("max"));
  const box = await seek.boundingBox();
  await p.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2);
  const target = Number(await seek.inputValue());
  ok("the click moved the bar well forward", target > max * 0.5, `${target}/${max}`);
  const seen = [];
  for (let i = 0; i < 40; i++) { seen.push(Number(await seek.inputValue())); await p.waitForTimeout(50); }
  ok("the bar never jumps back while the seek settles", Math.min(...seen) >= target - 3, seen.join(","));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
