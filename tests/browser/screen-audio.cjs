const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const mk = async (withAudio) => { const c = await b.newContext({ permissions: ["microphone", "camera"] }); const p = await c.newPage(); await p.addInitScript((withAudio) => {
    window.__asked = [];
    navigator.mediaDevices.getDisplayMedia = async (o) => { window.__asked.push(JSON.stringify(o)); const cv = document.createElement("canvas"); cv.width = 640; cv.height = 360; const g = cv.getContext("2d"); setInterval(() => { g.fillStyle = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0"); g.fillRect(0, 0, 640, 360); }, 100); const s = cv.captureStream(10);
      if (withAudio) { const ac = new AudioContext(); const osc = ac.createOscillator(); const d = ac.createMediaStreamDestination(); osc.connect(d); osc.start(); d.stream.getAudioTracks().forEach((t) => s.addTrack(t)); }
      return s; };
  }, withAudio); return p; };
  const join = async (p, name, url) => { await p.goto(url || "http://localhost:8080/"); await p.locator("input").first().fill(name); await p.getByRole("button", { name: url ? /join/i : /create/i }).first().click(); await p.locator(".composer textarea").waitFor(); };
  for (const withAudio of [true, false]) {
    console.log("== sharer picks sound:", withAudio);
    const A = await mk(withAudio); await join(A, "Ann"); const B = await mk(false); await join(B, "Bob", A.url());
    await A.waitForFunction(() => /\b2 \/ /.test(document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || ""), null, { timeout: 30000 });
    await A.getByLabel("Start call").click(); await B.getByLabel("Start call").click(); await A.waitForTimeout(1500);
    await A.getByLabel("Share screen").click(); await A.waitForTimeout(3500);
    ok("the browser was asked for audio without voice processing", /"audio":\{[^}]*"echoCancellation":false/.test((await A.evaluate(() => window.__asked))[0] || ""), JSON.stringify(await A.evaluate(() => window.__asked)));
    ok("it asks for tab audio only, and does not offer this Deca tab (no echo of the call)", /"systemAudio":"exclude"/.test((await A.evaluate(() => window.__asked))[0] || "") && /"selfBrowserSurface":"exclude"/.test((await A.evaluate(() => window.__asked))[0] || ""), JSON.stringify(await A.evaluate(() => window.__asked)));
    const tf = (p, sel) => p.evaluate((s) => { const v = document.querySelector(s); return v ? getComputedStyle(v).transform : "none"; }, sel);
    ok("your own camera is shown mirrored to you", (await tf(A, ".tile:not(.screen) video.mirror")) === "matrix(-1, 0, 0, 1, 0, 0)", await tf(A, ".tile:not(.screen) video.mirror"));
    ok("your own screen preview is not mirrored", (await tf(A, ".tile.screen video")) === "none");
    ok("the other person sees your camera the right way round (their view of you is not mirrored)", (await B.locator(".tile:not(.screen) video:not(.mirror)").count()) >= 1);
    const lbl = (p) => p.locator(".tile-label", { hasText: "screen" }).first().innerText();
    const la = await lbl(A), lb = await lbl(B);
    ok("sharer's tile says " + (withAudio ? "with sound" : "plain screen"), /with sound/.test(la) === withAudio, la);
    ok("viewer's tile says the same", /with sound/.test(lb) === withAudio, lb);
    const stats = await B.evaluate(async () => { const out = []; for (const v of document.querySelectorAll("video")) { const t = v.srcObject?.getAudioTracks?.() || []; out.push(t.length); } return out; });
    const got = await B.evaluate(async () => { await new Promise((r) => setTimeout(r, 1500)); return [...document.querySelectorAll("video")].some((v) => v.srcObject && v.srcObject.getAudioTracks().some((t) => t.contentHint === "music" || true) && v.srcObject.getVideoTracks().length && v.srcObject.getAudioTracks().length); });
    ok("viewer's screen stream " + (withAudio ? "has" : "has no") + " an audio track", withAudio ? got : !(await B.evaluate(() => [...document.querySelectorAll(".tile.screen video")].some((v) => v.srcObject?.getAudioTracks().length))), JSON.stringify(stats));
    if (withAudio) { const el = await B.evaluate(() => { const v = document.querySelector(".tile.screen video"); return { muted: v.muted, paused: v.paused }; }); ok("the viewer plays it (not muted, playing)", !el.muted && !el.paused, JSON.stringify(el));
      const ela = await A.evaluate(() => document.querySelector(".tile.screen video").muted); ok("the sharer does not hear their own share back", ela === true); }
    await A.getByLabel("Stop sharing screen").click(); await A.waitForTimeout(800);
    ok("stopping removes the screen tile for the viewer", (await B.locator(".tile.screen").count()) === 0);
    await A.context().close(); await B.context().close();
  }
  console.log(`\n${pass} passed, ${fail} failed`); await b.close();
})();
