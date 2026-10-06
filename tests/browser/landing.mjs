import { chromium } from "../lib/browser.mjs";
import assert from "node:assert";
const BASE = "http://localhost:8080/";
const browser = await chromium.launch({ });
const A = "dQw4w9WgXcQ", B = "9bZkp7q19f0", C = "kJQP7kiw5Fk";
const mk = async (name, hash = "") => {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  page.on("pageerror", (e) => console.log("[" + name + "] pageerror", e.stack));
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(() => {
    // a scripted YouTube player: deterministic, records what the app asks of it
    window.YT = { PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }, Player: class {
      constructor(el, o) { this.ev = o.events; this.vid = null; this.st = -1; this.t = 0; (window.__yt ||= []).push(this);
        const f = document.createElement("iframe"); f.src = "about:blank"; el.replaceWith(f); this.f = f; setTimeout(() => o.events.onReady({ target: this }), 10); }
      emit() { setTimeout(() => this.ev.onStateChange({ data: this.st }), 30); }
      loadVideoById(a) { this.vid = a.videoId; this.t = a.startSeconds || 0; this.st = 1; this.since = Date.now(); this.emit(); }
      cueVideoById(a) { this.vid = a.videoId; this.t = a.startSeconds || 0; this.st = 5; this.emit(); }
      playVideo() { if (this.st !== 1) { this.st = 1; this.since = Date.now(); } this.emit(); } pauseVideo() { this.t = this.getCurrentTime(); this.st = 2; this.emit(); } seekTo(t) { this.t = t; this.since = Date.now(); }
      getCurrentTime() { return this.st === 1 ? this.t + (Date.now() - (this.since || Date.now())) / 1000 : this.t; } getDuration() { return 200; } getPlayerState() { return this.st; }
      setVolume() {} mute() {} unMute() {} destroy() { this.f.remove(); }
      end() { this.st = 0; this.ev.onStateChange({ data: 0 }); } } };
  });
  await page.goto(BASE + hash);
  await page.getByPlaceholder("display name").fill(name);
  return page;
};
const until = (p, fn, arg, label, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms }).catch(() => { throw new Error("timeout: " + label); });
const vid = (p) => p.evaluate(() => window.__yt?.[0]?.vid ?? null);
const add = async (p, id) => { await p.getByLabel("YouTube link").fill("https://youtu.be/" + id); await p.getByRole("button", { name: "Add to queue" }).click(); };

// ---- landing identity ----
{
  const l = await mk("Zed");
  assert.equal(await l.locator(".logo-mark circle").count(), 10, "ten-dot logo");
  assert.ok(await l.getByText("ROOM TICKET").isVisible(), "ticket");
  console.log("OK landing: ten-dot logo + ticket");
}

const a = await mk("Ann"); await a.getByText("Create a space").click();
await a.getByText("Ann joined").waitFor();
const hash = new URL(a.url()).hash;
const b = await mk("Bob", hash); await b.getByText(/Join space/).click();
const c = await mk("Cat", hash); await c.getByText(/Join space/).click();
for (const p of [a, b, c]) { await p.getByText("Cat joined").waitFor(); }
await a.getByPlaceholder("Write a message…").fill("hi all"); await a.keyboard.press("Enter");
await b.locator(".line .what", { hasText: "hi all" }).waitFor();
assert.equal(await b.locator(".line .who").first().innerText(), "Ann", "IRC-style feed shows the sender");
assert.equal(await a.locator(".stack .avatar").count(), 3, "presence stack");
console.log("OK 3 peers; feed + presence stack render");

// ---- bad input ----
await a.getByLabel("YouTube link").fill("https://vimeo.com/123");
await a.getByRole("button", { name: "Add to queue" }).click();
await a.getByText("doesn't look like a YouTube link").waitFor();
console.log("OK rejects non-YouTube links with a message");

// ---- play: everyone's player loads the same video ----
await add(a, A);
for (const p of [a, b, c]) await until(p, (id) => window.__yt?.[0]?.vid === id && window.__yt[0].st === 1, A, "player loads " + A);
for (const p of [a, b, c]) await p.locator(".np-title").waitFor();
const title = await a.locator(".np-title").innerText();
assert.ok(title.length > 0);
console.log("OK add link -> all three players load it and play (title: " + title.slice(0, 40) + ")");

// ---- visualiser actually draws while playing ----
await a.waitForTimeout(800);
const drawn = await a.locator("canvas.viz").first().evaluate((cv) => { const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
assert.ok(drawn > 50, "visualiser drew pixels: " + drawn);
console.log("OK visualiser draws while playing (" + drawn + " px)");

// ---- pause from a non-host member propagates ----
await b.getByLabel("Pause for everyone").first().click();
for (const p of [a, c]) await until(p, () => window.__yt[0].st === 2, null, "pause propagates");
await a.getByLabel("Play for everyone").first().waitFor();
await a.waitForTimeout(1500);
const settled = await a.locator("canvas.viz").first().evaluate((cv) => { const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
assert.ok(settled < drawn, "bars settle when paused (" + settled + " < " + drawn + ")");
await c.getByLabel("Play for everyone").first().click();
for (const p of [a, b]) await until(p, () => window.__yt[0].st === 1, null, "resume propagates");
console.log("OK pause/resume syncs from any member; bars settle when paused");

// ---- pausing/playing INSIDE the video is a request for everyone, never silently undone ----
const y = (p) => p.evaluate(() => window.__yt.at(-1).st);
const flapSpy = (p) => p.evaluate(() => { window.__states = []; const pl = window.__yt.at(-1); const o = pl.ev.onStateChange; pl.ev.onStateChange = (e) => { window.__states.push(e.data); return o(e); }; });
await flapSpy(b);
await b.waitForTimeout(3200); // well past the "just loaded" settling window
await b.evaluate(() => { window.__states = []; const p = window.__yt.at(-1); p.pauseVideo(); }); // as if Bob clicked the video (recording starts now)
for (const p of [a, b, c]) await until(p, () => window.__yt.at(-1).st === 2, null, "pause inside the video paused it for everyone", 6000);
await a.getByLabel("Play for everyone").first().waitFor({ timeout: 5000 });
await b.waitForTimeout(2500);
assert.equal(await y(b), 2, "and it STAYED paused: nothing fought Bob's pause");
assert.deepEqual((await b.evaluate(() => window.__states)).filter((x) => x === 1), [], "Bob's player never flipped back to playing");
await c.waitForTimeout(1100);
await c.evaluate(() => window.__yt.at(-1).playVideo()); // Cat presses play inside the video
for (const p of [a, b, c]) await until(p, () => window.__yt.at(-1).st === 1, null, "play inside the video resumed everyone", 6000);
await a.getByLabel("Pause for everyone").first().waitFor({ timeout: 5000 });
console.log("OK a click inside the video acts like the button: pauses/plays for everyone and stays that way (no fighting)");

// ---- queue + late joiner ----
await add(b, B);
await a.locator(".queue li").first().waitFor();
const d = await mk("Dan", hash); await d.getByText(/Join space/).click();
await until(d, (id) => window.__yt?.[0]?.vid === id, A, "late joiner loads current track");
await d.locator(".queue li").first().waitFor();
console.log("OK queue syncs; late joiner gets current track + queue");

// ---- next track ----
await a.getByLabel("Next track").click();
for (const p of [a, b, c, d]) await until(p, (id) => window.__yt[0].vid === id, B, "next -> " + B);
assert.equal(await a.locator(".queue li").count(), 0);
console.log("OK next track advances everyone, queue drains");

// ---- end of track: every peer advances locally and identically, nothing sent ----
await add(a, C);
await a.locator(".queue li").first().waitFor();
await Promise.all([a, b, c, d].map((p) => p.evaluate(() => window.__yt[0].end())));
for (const p of [a, b, c, d]) await until(p, (id) => window.__yt[0].vid === id && window.__yt[0].st === 1, C, "auto-advance -> " + C);
await Promise.all([a, b, c, d].map((p) => p.evaluate(() => window.__yt[0].end())));
await a.getByText("Nothing playing").waitFor();
await d.getByText("Nothing playing").waitFor();
console.log("OK track end: all peers auto-advance to the same next track, then empty state");

// ---- permissions ----
await add(a, A);
await until(b, (id) => window.__yt?.at(-1)?.vid === id, A, "replay");
await a.getByLabel("Members can control music").uncheck();
await b.getByPlaceholder("Music controls are off").waitFor({ timeout: 10000 });
assert.ok(await b.getByLabel("Pause for everyone").first().isDisabled());
await b.waitForTimeout(3200);
await b.evaluate(() => window.__yt.at(-1).pauseVideo()); // Bob (no longer allowed) clicks the video anyway
await b.getByText("Music controls are off for members").waitFor({ timeout: 5000 });
await until(b, () => window.__yt.at(-1).st === 1, null, "without permission the player is put back", 6000);
assert.equal(await y(a), 1, "and nobody else was affected");
console.log("OK host can switch music control off for members");

// ---- listening toggle is local ----
await c.getByLabel("Stop listening on this device").click();
await c.getByText("Not listening on this device").waitFor();
assert.equal(await a.evaluate(() => window.__yt.at(-1).st), 1, "others keep playing");
console.log("OK 'stop listening' is per-device and leaves everyone else playing");
await browser.close();
