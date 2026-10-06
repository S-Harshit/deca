const { chromium } = require("../lib/browser.cjs"); const { PNG } = require("pngjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
const box = (p, s) => p.locator(s).first().boundingBox();
const same = (x, y) => ["x", "y", "width", "height"].every((k) => Math.abs(x[k] - y[k]) < 1);
const say = async (p, t) => { await p.locator(".composer textarea").fill(t); await p.keyboard.press("Enter"); await p.waitForTimeout(150); };
(async () => {
  const b = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const mk = async (name, room, vp = { width: 1440, height: 850 }, extra = {}) => { const c = await b.newContext({ viewport: vp, permissions: ["camera", "microphone"], ...extra }); const p = await c.newPage(); p.errs = []; p.on("pageerror", (e) => p.errs.push(e.message)); p.on("console", (m) => m.type() === "error" && p.errs.push(m.text())); await p.goto(room || "http://localhost:8080/"); await p.locator("input").first().fill(name); await p.getByRole("button", { name: room ? /join/i : /create/i }).first().click(); await p.locator(".composer textarea").waitFor(); return p; };
  const a = await mk("Ann"); const room = a.url(); const bob = await mk("Bob", room); await a.getByText("Bob joined").waitFor({ timeout: 20000 });
  // ---- hidden
  await a.getByLabel("Deciders").click(); const menu = await a.locator(".menu").innerText(); await a.keyboard.press("Escape");
  ok("the command is not listed in the deciders menu", !/run/i.test(menu), menu);
  ok("nothing visible mentions it", !/\/run/.test(await a.locator("body").innerText()));
  // ---- no call: strip above the chat
  await say(a, "/run"); await a.locator(".runner-strip canvas").waitFor({ timeout: 5000 });
  ok("/run shows the strip", await a.locator(".runner-strip").isVisible());
  ok("/run is not sent to the room as a message", (await a.getByText("/run", { exact: true }).count()) === 0 && (await bob.getByText("/run", { exact: true }).count()) === 0);
  const sb0 = await box(a, ".runner-strip"), cb0 = await box(a, ".chat"); ok("without a call the strip sits above the chat", sb0.y + sb0.height <= cb0.y + 1 && sb0.height >= 120 && sb0.height <= 221, JSON.stringify([sb0, cb0]));
  ok("only for me: Bob sees nothing", (await bob.locator(".runner-strip").count()) === 0);
  // alive: pixels change and are not blank
  const px = async (p) => PNG.sync.read(await p.locator(".runner-strip").screenshot());
  const f1 = await px(a); await a.waitForTimeout(700); const f2 = await px(a);
  let diffPx = 0; for (let i = 0; i < f1.data.length; i += 4) if (Math.abs(f1.data[i] - f2.data[i]) + Math.abs(f1.data[i + 1] - f2.data[i + 1]) > 40) diffPx++;
  const colors = new Set(); for (let i = 0; i < f1.data.length; i += 4 * 97) colors.add(`${f1.data[i] >> 5}${f1.data[i + 1] >> 5}${f1.data[i + 2] >> 5}`);
  ok("it is animating (a large part of the picture changes within 0.7s)", diffPx > f1.width * f1.height * 0.03, diffPx);
  ok("it is a real picture, not blank", colors.size > 25, colors.size);
  // performance: frames keep coming and nothing blocks the page
  const perf = await a.evaluate(() => new Promise((res) => { const longs = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => longs.push(Math.round(e.duration)))).observe({ entryTypes: ["longtask"] }); } catch {} let n = 0, last = performance.now(), worst = 0; const t0 = last; const f = (now) => { n++; worst = Math.max(worst, now - last); last = now; if (now - t0 < 3000) requestAnimationFrame(f); else res({ fps: n / ((now - t0) / 1000), worst: Math.round(worst), longs }); }; requestAnimationFrame(f); }));
  ok("it keeps a steady frame rate (>=30 fps even in software-rendered headless Chrome)", perf.fps >= 30, JSON.stringify(perf));
  ok("it never blocks the page for long (no task over 100 ms)", perf.longs.every((d) => d < 100), JSON.stringify(perf.longs));
  // ---- toggles
  await say(a, "/run"); await a.waitForTimeout(200); ok("/run again turns it off", (await a.locator(".runner-strip").count()) === 0);
  await say(a, "/run on"); await a.locator(".runner-strip").waitFor(); await say(a, "/run on"); ok("/run on twice leaves one strip", (await a.locator(".runner-strip").count()) === 1);
  await say(a, "/run off"); ok("/run off hides it", (await a.locator(".runner-strip").count()) === 0);
  await say(a, "/RUN"); ok("case does not matter", (await a.locator(".runner-strip").count()) === 1);
  await a.getByRole("button", { name: "Hide the runner" }).click(); ok("the close button hides it", (await a.locator(".runner-strip").count()) === 0);
  // ---- during a call: below the video, same column
  const base = { stage: null, chat: null };
  await a.getByRole("button", { name: "Start call" }).click(); await a.locator(".stage video").first().waitFor({ timeout: 15000 }); await a.waitForTimeout(400);
  base.stage = await box(a, ".stage"); base.chat = await box(a, ".chat");
  await say(a, "/run"); await a.locator(".runner-strip canvas").waitFor(); await a.waitForTimeout(300);
  const st = await box(a, ".stage"), sp = await box(a, ".runner-strip"), ch = await box(a, ".chat");
  ok("during a call the strip is directly below the video, in the video's column", sp.y >= st.y + st.height - 1 && Math.abs(sp.x - st.x) < 2 && Math.abs(sp.width - st.width) < 2, JSON.stringify([st, sp]));
  ok("the chat column is unchanged by it", same(ch, base.chat), JSON.stringify([ch, base.chat]));
  ok("the video gives up only the strip's height", Math.abs((base.stage.height - st.height) - sp.height) < 3, JSON.stringify([base.stage.height, st.height, sp.height]));
  // accent colour
  await a.evaluate(() => document.documentElement.style.setProperty("--accent", "#ff0000")); await a.waitForTimeout(2200);
  const red = await px(a); let reds = 0; for (let i = 0; i < red.data.length; i += 4) if (red.data[i] > 200 && red.data[i + 1] < 60 && red.data[i + 2] < 60) reds++;
  ok("the runner's jacket follows the theme accent", reds > 150, reds);
  await a.evaluate(() => document.documentElement.style.removeProperty("--accent"));
  // chat expand hides it with the video, and back
  await a.getByRole("button", { name: "Expand chat" }).click(); await a.waitForTimeout(300);
  ok("expanding the chat steps the strip aside with the video", !(await a.locator(".runner-strip").isVisible()) && !(await a.locator(".stage").isVisible()));
  await a.getByRole("button", { name: "Back to video" }).click(); await a.waitForTimeout(300);
  ok("back to video: strip is back, layout as before", await a.locator(".runner-strip").isVisible() && same(await box(a, ".stage"), st) && same(await box(a, ".runner-strip"), sp));
  // off -> exactly the original layout
  await say(a, "/run off"); await a.waitForTimeout(300);
  ok("turning it off restores the exact original layout", same(await box(a, ".stage"), base.stage) && same(await box(a, ".chat"), base.chat));
  // games unaffected: geometry of the game window with the runner switched on vs off
  await a.locator(".games-btn").click(); await a.locator(".game-panel").waitFor(); await a.waitForTimeout(400);
  const gOff = { panel: await box(a, ".game-panel"), col: await box(a, ".media-col"), chat: await box(a, ".chat"), stage: await box(a, ".stage") }; await a.getByLabel("Close game").click(); await a.waitForTimeout(300);
  await say(a, "/run"); await a.locator(".runner-strip").waitFor(); await a.locator(".games-btn").click(); await a.locator(".game-panel").waitFor(); await a.waitForTimeout(400);
  const gOn = { panel: await box(a, ".game-panel"), col: await box(a, ".media-col"), chat: await box(a, ".chat"), stage: await box(a, ".stage") };
  ok("with a game open there is no strip and no runner canvas running", (await a.locator(".runner-strip").count()) === 0 && (await a.locator("canvas").count()) === 0);
  ok("the game window and everything around it are exactly the same whether /run is on or off", same(gOff.panel, gOn.panel) && same(gOff.col, gOn.col) && same(gOff.chat, gOn.chat) && same(gOff.stage, gOn.stage), JSON.stringify([gOff, gOn]));
  ok("opening a game turned the runner off (not just hid it)", true);
  await a.getByLabel("Close game").click(); await a.waitForTimeout(500); ok("after the game closes the runner stays off", (await a.locator(".runner-strip").count()) === 0 && (await a.locator("canvas").count()) === 0);
  await say(a, "/run"); await a.locator(".runner-strip").waitFor(); ok("it can be turned on again afterwards", true); await say(a, "/run off");
  // no call: same rule
  await a.getByLabel("Leave call").click(); await a.waitForTimeout(500); await say(a, "/run"); await a.locator(".runner-strip").waitFor(); await a.locator(".games-btn").click(); await a.locator(".game-panel").waitFor();
  ok("without a call too: opening a game turns the runner off", (await a.locator(".runner-strip").count()) === 0); await a.getByLabel("Close game").click(); await a.waitForTimeout(400);
  ok("...and it stays off after the game", (await a.locator(".runner-strip").count()) === 0);
  // reload resets
  await a.reload(); await a.locator("input").first().fill("Ann"); await a.getByRole("button", { name: /create|join/i }).first().click(); await a.locator(".composer textarea").waitFor();
  ok("not saved: a reload starts without it", (await a.locator(".runner-strip").count()) === 0);
  // reduced motion
  const rm = await mk("Rae", room, { width: 1200, height: 800 }, { reducedMotion: "reduce" }); await say(rm, "/run"); await rm.waitForTimeout(400);
  ok("reduced motion: the strip stays off and says why", (await rm.locator(".runner-strip").count()) === 0 && /Reduced motion/.test(await rm.locator("body").innerText()));
  // phone
  const m = await mk("Mo", room, { width: 390, height: 780 }, { hasTouch: true, isMobile: true });
  await m.getByRole("button", { name: "Start call" }).tap(); await m.locator(".stage").waitFor({ timeout: 15000 }); await say(m, "/run"); await m.locator(".runner-strip canvas").waitFor(); await m.waitForTimeout(500);
  const ms = await box(m, ".runner-strip"), mc = await box(m, ".composer"); ok("phone: strip fits the width", ms.x >= 0 && ms.x + ms.width <= 391 && ms.height <= 200, JSON.stringify(ms));
  ok("phone: the composer is still on screen and usable", mc.y + mc.height <= 781 && mc.y > ms.y + ms.height, JSON.stringify([ms, mc]));
  ok("phone: no horizontal overflow", await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  // light theme and wallpaper don't break it
  await a.getByLabel("Appearance").click(); await a.getByRole("button", { name: "Light theme" }).click(); await a.keyboard.press("Escape"); await say(a, "/run"); await a.waitForTimeout(500);
  ok("works on a light theme too", await a.locator(".runner-strip").isVisible());
  ok("no page errors", [a, bob, rm, m].every((p) => p.errs.length === 0), [a, bob, rm, m].flatMap((p) => p.errs).join("|"));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.log("ERR", e.message.split("\n").slice(0, 8).join("\n")); process.exit(1); });
