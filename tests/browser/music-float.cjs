const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1300, height: 900 }, permissions: ["camera", "microphone"] }); return c.newPage(); };
  const A = await mk(); await A.goto("http://localhost:8080/"); await A.locator("input").first().fill("Ann"); await A.getByRole("button", { name: /create/i }).first().click(); await A.locator(".composer textarea").waitFor();
  const B = await mk(); await B.goto(A.url()); await B.locator("input").first().fill("Bob"); await B.getByRole("button", { name: /join/i }).first().click(); await B.locator(".composer textarea").waitFor();
  await A.waitForFunction(() => /\b2 \/ /.test(document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || ""), null, { timeout: 30000 });
  await A.getByLabel("Start call").click(); await B.getByLabel("Start call").click(); await A.waitForTimeout(2500);
  await A.getByLabel("YouTube link").fill("https://youtu.be/jNQXAC9IVRw"); await A.getByLabel("Add to queue").click(); await A.locator(".np-title").waitFor({ timeout: 15000 });
  await A.getByLabel("Pop out the player").click(); await A.waitForTimeout(500);
  const box = async () => A.locator(".panel.music.float").boundingBox();
  let bb = await box(); ok("the player is popped out", !!bb);
  // drag it over the video stage
  const stage = await A.locator(".stage").boundingBox(); ok("a call stage is on screen", !!stage);
  const head = A.locator(".panel.music.float h3"); const hb = await head.boundingBox();
  await A.mouse.move(hb.x + 40, hb.y + 10); await A.mouse.down(); await A.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2, { steps: 8 }); await A.mouse.up(); await A.waitForTimeout(300);
  bb = await box();
  const cx = bb.x + bb.width / 2, cy = bb.y + 60;
  const top = await A.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.closest(".music") ? "music" : e.closest(".tile") ? "video tile" : e.tagName + "." + e.className) : "none"; }, [cx, cy]);
  ok("over the video, the player is on top of the video tiles", top === "music", top);
  const overChat = await A.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e?.closest(".music") ? "music" : "other"; }, [bb.x + 20, bb.y + 20]);
  ok("and its header is clickable (top-left corner)", overChat === "music");
  console.log(`\n${pass} passed, ${fail} failed`); await b.close();
})();
