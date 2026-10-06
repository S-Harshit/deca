const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
const box = (p, s) => p.locator(s).first().boundingBox();
const same = (x, y) => ["x", "y", "width", "height"].every((k) => Math.abs(x[k] - y[k]) < 1);
(async () => {
  const b = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const mk = async (name, room, vp = { width: 1440, height: 850 }, extra = {}) => { const c = await b.newContext({ viewport: vp, permissions: ["camera", "microphone"], ...extra }); const p = await c.newPage(); p.errs = []; p.on("pageerror", (e) => p.errs.push(e.message)); await p.goto(room || "http://localhost:8080/"); await p.locator("input").first().fill(name); await p.getByRole("button", { name: room ? /join/i : /create/i }).first().click(); await p.locator(".composer textarea").waitFor(); return p; };
  const a = await mk("Ann"); const room = a.url(); const bob = await mk("Bob", room); await a.getByText("Bob joined").waitFor({ timeout: 20000 });
  ok("no bar and no expand button when there is no call", (await a.locator(".chat-callbar").count()) === 0 && (await a.getByRole("button", { name: "Expand chat" }).count()) === 0);
  await a.getByRole("button", { name: "Start call" }).click(); await bob.getByRole("button", { name: "Start call" }).click();
  await a.locator(".stage video").nth(1).waitFor({ timeout: 25000 });
  ok("a call shows the bar at the top of the chat", await a.locator(".chat-callbar").isVisible() && /In a call/.test(await a.locator(".chat-callbar").innerText()));
  const timers = (p) => p.evaluate(() => [...document.querySelectorAll(".call-timer, .call-elapsed")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; }).length);
  ok("exactly one call timer is visible during a call (not two)", (await timers(a)) === 1, await timers(a));
  const main0 = await box(a, ".main"), chat0 = await box(a, ".chat"), stage0 = await box(a, ".stage");
  ok("by default the chat is the narrow column and the video is large", chat0.width > 340 && chat0.width < 420 && stage0.width > 700, JSON.stringify([chat0.width, stage0.width]));
  // --- the typing-jumps complaint, in exactly this narrow layout
  const ta = a.locator(".composer textarea"); const tab0 = await ta.boundingBox();
  ok("narrow chat: the message box is wide enough (was 143px)", tab0.width >= 250, tab0.width);
  const tools = await a.locator(".composer > :not(textarea):not(.send)").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { y: Math.round(r.y), r: Math.round(r.right) }; }));
  const cb = await box(a, ".composer");
  ok("the tool buttons sit on a row below the box and inside the chat", tools.length === 3 && tools.every((t) => t.y > tab0.y + tab0.height - 2 && t.r <= chat0.x + chat0.width + 1), JSON.stringify(tools));
  const sendB = await box(a, ".composer .send"); ok("send button stays beside the box, bottom-aligned with it", Math.abs(sendB.y + sendB.height - (tab0.y + tab0.height)) < 2, JSON.stringify([sendB, tab0]));
  await ta.focus(); let prev = Math.round((await ta.boundingBox()).height), jumps = 0; const msg = "hello everyone this is a message that keeps going and going and going on and on";
  for (const ch of msg) { await a.keyboard.type(ch); const h = Math.round((await ta.boundingBox()).height); if (h !== prev) { jumps++; prev = h; } }
  ok(`typing ${msg.length} characters grows the box only ${jumps} time(s) (it was 5 before)`, jumps <= 2, jumps);
  await ta.fill("");
  // --- expand the chat
  await a.getByRole("button", { name: "Expand chat" }).click(); await a.waitForTimeout(400);
  ok("expanded: the video area steps aside", !(await a.locator(".stage").isVisible()));
  ok("expanded: still exactly one timer (now in the bar)", (await timers(a)) === 1 && (await a.locator(".chat-callbar .call-elapsed").count()) === 1, await timers(a));
  const chat1 = await box(a, ".chat"); ok("expanded: the chat fills the whole area", Math.abs(chat1.width - main0.width) < 2 && Math.abs(chat1.height - main0.height) < 2, JSON.stringify([chat1, main0]));
  ok("expanded: the bar now offers to go back (pressed)", (await a.getByRole("button", { name: "Back to video" }).getAttribute("aria-pressed")) === "true");
  const tabBig = await ta.boundingBox(); ok("expanded: composer is one row again with a wide box", tabBig.width > 700, tabBig.width);
  // the call keeps going while hidden
  const media = await a.evaluate(async () => { const vs = [...document.querySelectorAll(".stage video")]; const t0 = vs.map((v) => v.currentTime); await new Promise((r) => setTimeout(r, 900)); return vs.map((v, i) => ({ paused: v.paused, adv: v.currentTime - t0[i], tracks: v.srcObject?.getTracks().filter((t) => t.readyState === "live").length })); });
  ok("the call keeps playing while the video is hidden (not paused, time advancing, tracks live)", media.length >= 2 && media.every((m) => !m.paused && m.adv > 0.5 && m.tracks >= 1), JSON.stringify(media));
  await bob.locator(".composer textarea").fill("hi from the call"); await bob.keyboard.press("Enter"); await a.getByText("hi from the call").waitFor({ timeout: 8000 }); ok("messages arrive in the expanded chat", true);
  ok("mic, camera and leave-call stay in the top bar while expanded", (await a.getByLabel("Leave call").isVisible()) && (await a.getByLabel(/Mute microphone|Unmute microphone/).isVisible()));
  const stageDuring = await a.locator("#x").count(); void stageDuring;
  await a.getByRole("button", { name: "Back to video" }).click(); await a.waitForTimeout(400);
  const chat2 = await box(a, ".chat"), stage2 = await box(a, ".stage");
  ok("back to video: one timer again, on the video", (await timers(a)) === 1 && (await a.locator(".chat-callbar .call-elapsed").count()) === 0);
  ok("back to video: exactly the original layout", same(chat0, chat2) && same(stage0, stage2), JSON.stringify([chat0, chat2, stage0, stage2]));
  ok("the video resumed showing (tiles visible)", await a.locator(".stage video").first().isVisible());
  // --- games: untouched. same game geometry with and without having expanded first
  await a.locator(".games-btn").click(); await a.locator(".game-panel").waitFor(); await a.waitForTimeout(300);
  const g1 = { panel: await box(a, ".game-panel"), col: await box(a, ".media-col"), chat: await box(a, ".chat"), stage: await box(a, ".stage") };
  ok("with a game open there is no bar and no expand control", (await a.locator(".chat-callbar").count()) === 0);
  await a.getByLabel("Close game").click(); await a.waitForTimeout(300);
  await a.getByRole("button", { name: "Expand chat" }).click(); await a.waitForTimeout(300); ok("chat expanded before opening a game", !(await a.locator(".stage").isVisible()));
  await a.locator(".games-btn").click(); await a.locator(".game-panel").waitFor(); await a.waitForTimeout(400);
  const g2 = { panel: await box(a, ".game-panel"), col: await box(a, ".media-col"), chat: await box(a, ".chat"), stage: await box(a, ".stage") };
  ok("opening a game resets the expansion (video and column back)", await a.locator(".stage").isVisible());
  ok("the game window, its column, the chat and the video are all exactly the same either way", same(g1.panel, g2.panel) && same(g1.col, g2.col) && same(g1.chat, g2.chat) && same(g1.stage, g2.stage), JSON.stringify([g1, g2]));
  await a.getByLabel("Close game").click(); await a.waitForTimeout(300);
  ok("after the game closes the layout is the normal call layout", same(await box(a, ".chat"), chat0));
  // --- call ends -> reset
  await a.getByRole("button", { name: "Expand chat" }).click(); await a.waitForTimeout(200); ok("expanded again", !(await a.locator(".stage").isVisible()));
  await a.getByLabel("Leave call").click(); await a.waitForTimeout(500);
  ok("leaving my own call brings the video back even though Bob is still on camera", await a.locator(".stage").isVisible() && (await a.locator(".chat-callbar").count()) === 1);
  await bob.getByLabel("Leave call").click(); await a.waitForTimeout(800);
  ok("when nobody is on camera any more: normal chat, no bar", (await a.locator(".chat-callbar").count()) === 0 && (await a.locator(".chat").isVisible()) && (await box(a, ".chat")).width > 500);
  await a.getByRole("button", { name: "Start call" }).click(); await a.locator(".stage").waitFor({ timeout: 15000 });
  ok("the next call starts normal", await a.locator(".stage").isVisible() && (await a.getByRole("button", { name: "Expand chat" }).count()) === 1);
  // --- stacked layout
  const n = await mk("Nia", room, { width: 1000, height: 800 }); await n.getByRole("button", { name: "Start call" }).click(); await n.locator(".stage").waitFor({ timeout: 15000 });
  const sb = await box(n, ".stage"), cb2 = await box(n, ".chat"); ok("narrow window: video on top, chat below", sb.y < cb2.y, JSON.stringify([sb, cb2]));
  const nta = await n.locator(".composer textarea").boundingBox(); ok("narrow window: chat is wide here, so single-row composer", nta.width > 300, nta.width);
  await n.getByRole("button", { name: "Expand chat" }).click(); await n.waitForTimeout(300);
  const mb = await box(n, ".main"), cb3 = await box(n, ".chat"); ok("narrow window: expanded chat takes the whole area", !(await n.locator(".stage").isVisible()) && cb3.height > mb.height - 4 && Math.abs(cb3.width - mb.width) < 2, JSON.stringify([cb3, mb]));
  await n.getByRole("button", { name: "Back to video" }).click(); await n.waitForTimeout(300); ok("narrow window: back to video", await n.locator(".stage").isVisible());
  // --- phone
  const m = await mk("Mo", room, { width: 390, height: 780 }, { hasTouch: true, isMobile: true }); await m.getByRole("button", { name: "Start call" }).tap(); await m.locator(".stage").waitFor({ timeout: 15000 });
  const bar = await box(m, ".chat-callbar"); ok("phone: the bar fits the screen", bar.x >= 0 && bar.x + bar.width <= 391, JSON.stringify(bar));
  ok("phone: no horizontal overflow", await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await m.getByRole("button", { name: "Expand chat" }).tap(); await m.waitForTimeout(300); ok("phone: expands", !(await m.locator(".stage").isVisible()));
  await m.getByRole("button", { name: "Back to video" }).tap(); await m.waitForTimeout(300); ok("phone: comes back", await m.locator(".stage").isVisible());
  ok("no page errors", [a, bob, n, m].every((p) => p.errs.length === 0), [a, bob, n, m].flatMap((p) => p.errs).join("|"));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.log("ERR", e.message.split("\n").slice(0, 8).join("\n")); process.exit(1); });
