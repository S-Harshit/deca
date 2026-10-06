import { chromium } from "../lib/browser.mjs";
import assert from "node:assert";
import { createRequire } from "node:module";
const { person } = createRequire(import.meta.url)("../lib/identities.cjs");
const BASE = "http://localhost:8080/";
const browser = await chromium.launch({ });
const WHO = ["Ann", "Cat", "dhh", "Eve"];
const ID = Object.fromEntries(WHO.map((n) => [n, person(n).id]));
const STORED = Object.fromEntries(WHO.map((n) => [n, person(n).stored]));
const mk = async (name, hash = "", block = []) => {
  const p = await (await browser.newContext({ viewport: { width: 1300, height: 800 } })).newPage();
  p.on("pageerror", (e) => console.log("[" + name + "] pageerror", e.message));
  await p.addInitScript(([stored, block]) => {
    sessionStorage.setItem("deca.identity", stored);
    // these two people can never negotiate with each other: drop their signaling to one another
    const send = WebSocket.prototype.send; WebSocket.prototype.send = function (d) { try { const m = JSON.parse(d); if (m.type === "signal" && block.includes(m.to)) return; } catch {} return send.call(this, d); };
    window.__evSends = 0; const cs = RTCDataChannel.prototype.send; RTCDataChannel.prototype.send = function (d) { if (typeof d === "string" && d.startsWith('{"t":"ev"')) window.__evSends++; return cs.call(this, d); };
    window.YT = { PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }, Player: class { constructor(el, o) { this.ev = o.events; this.st = -1; (window.__yt ||= []).push(this); const f = document.createElement("iframe"); el.replaceWith(f); this.f = f; setTimeout(() => o.events.onReady({}), 10); } emit() { setTimeout(() => this.ev.onStateChange({ data: this.st }), 30); } loadVideoById(a) { this.vid = a.videoId; this.st = 1; this.emit(); } cueVideoById(a) { this.vid = a.videoId; this.st = 5; this.emit(); } playVideo() { this.st = 1; this.emit(); } pauseVideo() { this.st = 2; this.emit(); } seekTo() {} getCurrentTime() { return 0; } getDuration() { return 200; } getPlayerState() { return this.st; } setVolume() {} mute() {} unMute() {} destroy() { this.f.remove(); } } };
  }, [STORED[name], block.map((n) => ID[n])]);
  await p.goto(BASE + hash); await p.getByPlaceholder("display name").fill(name); return p;
};
const say = async (p, m) => { await p.getByPlaceholder("Write a message…").fill(m); await p.keyboard.press("Enter"); };
const count = (p, text) => p.locator(".line .what", { hasText: text }).count();

// ================= healthy room: a normal mesh must not forward anything =================
{
  const a = await mk("Ann"); await a.getByText("Create a space").click(); await a.getByText("Ann joined").waitFor(); const hash = new URL(a.url()).hash;
  const c = await mk("Cat", hash); await c.getByText(/Join space/).click(); const d = await mk("dhh", hash); await d.getByText(/Join space/).click();
  for (const p of [a, c, d]) await p.getByText("dhh joined").waitFor();
  await a.waitForFunction(() => document.querySelectorAll(".members li").length >= 3 && [...document.querySelectorAll(".members li .small")].filter((e) => /peer-to-peer/.test(e.textContent)).length >= 2, null, { timeout: 15000 });
  await a.waitForTimeout(2500);
  const before = await Promise.all([a, c, d].map((p) => p.evaluate(() => window.__evSends)));
  for (let i = 0; i < 5; i++) await say(a, "healthy " + i);
  for (const p of [c, d]) await p.getByText("healthy 4").waitFor();
  await a.waitForTimeout(500);
  const after = await Promise.all([a, c, d].map((p) => p.evaluate(() => window.__evSends)));
  const sent = after.map((x, i) => x - before[i]);
  assert.deepEqual(sent, [10, 0, 0], "5 messages x 2 direct peers = 10 sends, and nobody forwards: " + sent);
  console.log("OK healthy room: no extra forwarding (sends per person: " + sent + ")");
  for (const p of [a, c, d]) await p.context().close();
}

// ================= Ann and dhh can never connect directly; Cat reaches both =================
const a = await mk("Ann", "", ["dhh"]); await a.getByText("Create a space").click(); await a.getByText("Ann joined").waitFor(); const hash = new URL(a.url()).hash;
const c = await mk("Cat", hash); await c.getByText(/Join space/).click();
const d = await mk("dhh", hash, ["Ann"]); await d.getByText(/Join space/).click();
for (const p of [a, c, d]) await p.getByText("dhh joined").waitFor({ timeout: 20000 });  // dhh's join reaches Ann with no direct link between them
await a.getByText("chat via Cat").waitFor({ timeout: 20000 }); await d.getByText("chat via Cat").waitFor({ timeout: 20000 });
assert.equal(await a.getByRole("button", { name: "Retry" }).count(), 0, "no error state while chat is flowing");
console.log("OK Ann and dhh cannot connect directly, yet both see each other online: 'chat via Cat'");

await say(a, "hi from Ann"); await d.getByText("hi from Ann").waitFor({ timeout: 8000 });
await say(d, "hi from dhh"); await a.getByText("hi from dhh").waitFor({ timeout: 8000 });
await a.waitForTimeout(1200);
for (const p of [a, c, d]) { assert.equal(await count(p, "hi from Ann"), 1, "no duplicates"); assert.equal(await count(p, "hi from dhh"), 1, "no duplicates"); }
console.log("OK chat crosses both ways through Cat, exactly once on every screen");

await a.getByRole("button", { name: "Deciders" }).click(); await a.getByRole("menuitem", { name: /Flip a coin/ }).click();
await d.locator('.coin-row[data-result="heads"], .coin-row[data-result="tails"]').first().waitFor({ timeout: 8000 });
const flips = async (p) => p.locator('.coin-row[data-result="heads"], .coin-row[data-result="tails"]').evaluateAll((e) => e.map((x) => x.dataset.result));
assert.deepEqual(await flips(a), await flips(d)); await say(a, "/rps"); await d.locator(".rps-row").first().waitFor({ timeout: 8000 }); await d.waitForTimeout(1300);
await say(d, "/rps"); await a.waitForFunction(() => document.querySelectorAll(".rps-result").length === 1, null, { timeout: 8000 });
await d.waitForFunction(() => document.querySelectorAll(".rps-result").length === 1, null, { timeout: 8000 });
console.log("OK coin flip and rock-paper-scissors work across the relay (Ann's throw answered by dhh)");

await a.getByLabel("YouTube link").fill("https://youtu.be/dQw4w9WgXcQ"); await a.getByRole("button", { name: "Add to queue" }).click();
await d.waitForFunction(() => window.__yt?.at(-1)?.vid === "dQw4w9WgXcQ" && window.__yt.at(-1).st === 1, null, { timeout: 15000 });
await d.getByLabel("Pause for everyone").first().click();
await a.waitForFunction(() => window.__yt?.at(-1)?.st === 2, null, { timeout: 8000 });
console.log("OK music: Ann's track reaches dhh, and dhh's pause reaches Ann, through Cat");

const e = await mk("Eve", hash); await e.getByText(/Join space/).click();
await e.getByText("hi from dhh").waitFor({ timeout: 15000 }); await e.getByText("hi from Ann").waitFor();
console.log("OK a late joiner sees the whole history, including messages that crossed the relay");
await browser.close();
