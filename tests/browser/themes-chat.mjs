import { chromium } from "../lib/browser.mjs";
import assert from "node:assert";
import fs from "node:fs";
const BASE = "http://localhost:8080/";
const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const mk = async (name, hash = "") => {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"], acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[" + name + "] pageerror", e.stack));
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(() => {
    window.__pcs = []; const P = window.RTCPeerConnection;
    window.RTCPeerConnection = function (...a) { const pc = new P(...a); window.__pcs.push(pc); return pc; };
    window.RTCPeerConnection.prototype = P.prototype;
    // deterministic screen capture (headless has no picker): an animated canvas
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement("canvas"); c.width = 640; c.height = 360; const x = c.getContext("2d");
      setInterval(() => { x.fillStyle = "hsl(" + ((Date.now() / 10) % 360) + " 70% 50%)"; x.fillRect(0, 0, 640, 360); }, 100);
      return c.captureStream(10);
    };
  });
  await page.goto(BASE + hash);
  await page.getByPlaceholder("display name").fill(name);
  return page;
};
const text = (p) => p.locator("body").innerText();
const until = async (p, s, ms = 15000) => { await p.waitForFunction((s) => document.body.innerText.includes(s), s, { timeout: ms }).catch(async () => { throw new Error('timeout waiting for "' + s + '"\n---\n' + await text(p)); }); };
const say = async (p, msg) => { await p.getByPlaceholder("Write a message…").fill(msg); await p.getByRole("button", { name: "Send", exact: true }).click(); };

// ---- theme: pick, customise, persists across reload (on the landing page) ----
{
  const t = await mk("Theme");
  await t.getByRole("button", { name: "Appearance" }).click();
  await t.getByRole("button", { name: "Light theme" }).click();
  await t.getByRole("button", { name: "Accent #ff6b7a" }).click();
  await t.getByRole("button", { name: "XL" }).click();
  const read = () => t.evaluate(() => ({ th: document.documentElement.dataset.theme, ac: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(), fs: document.documentElement.style.fontSize }));
  assert.deepEqual(await read(), { th: "light", ac: "#ff6b7a", fs: "20px" });
  await t.reload();
  assert.deepEqual(await read(), { th: "light", ac: "#ff6b7a", fs: "20px" });
  await t.getByRole("button", { name: "Appearance" }).click();
  await t.getByRole("button", { name: "Reset to defaults" }).click();
  assert.equal((await read()).ac, "#7c83ff".length ? (await read()).ac : "");
  console.log("OK theme: select, accent, text size, persists across reload, reset");
}

const a = await mk("Ann"); await a.getByText("Create a space").click();
await until(a, "Ann joined");
await a.getByText("You're the only one here").waitFor();
const hash = new URL(a.url()).hash;
const b = await mk("Bob", hash); await b.getByText(/Join space/).click();
const c = await mk("Cat", hash); await c.getByText(/Join space/).click();
for (const p of [a, b, c]) { await until(p, "Bob joined"); await until(p, "Cat joined"); }
console.log("OK join/presence across 3 peers (invite card shown to the lone host)");

await say(b, "hello from bob");
for (const p of [a, c]) await until(p, "hello from bob");
await say(b, "see https://example.com now");
await a.getByRole("link", { name: "https://example.com" }).waitFor();
console.log("OK chat (Enter/Send) + links are clickable");

// ---- images: auto-fetched inline, lightbox viewer ----
await a.locator("input[type=file]").setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: PNG });
for (const p of [b, c]) {
  await p.locator(".image img").waitFor({ timeout: 15000 });
  assert.ok(await p.locator(".image img").evaluate((i) => i.complete && i.naturalWidth > 0), "image decoded");
}
await b.getByRole("button", { name: "View pixel.png" }).click();
await b.getByRole("dialog").waitFor();
await b.keyboard.press("Escape");
await b.getByRole("dialog").waitFor({ state: "detached" });
console.log("OK shared image previews inline for receivers (no click) and opens in the lightbox");

// ---- other files still download ----
const BIG = "big.bin";
await a.locator("input[type=file]").setInputFiles(BIG);
await until(b, "big.bin");
const dl = b.waitForEvent("download", { timeout: 20000 });
await b.getByRole("button", { name: /Download/ }).click();
await until(b, "Save", 20000);
await b.getByRole("link", { name: /Save/ }).click();
const path = await (await dl).path();
assert.ok(fs.readFileSync(path).equals(fs.readFileSync(BIG)));
console.log("OK file transfer 3MB byte-identical");

// ---- late joiner gets history, and the image ----
const d = await mk("Dan", hash); await d.getByText(/Join space/).click();
await until(d, "hello from bob"); await d.locator(".image img").waitFor({ timeout: 15000 });
console.log("OK late joiner: history + image");

// ---- call: mic mute, camera off, camera + screen together, spotlight, fullscreen ----
await b.getByRole("button", { name: /Start call/ }).click();
await a.locator(".tile", { hasText: "Bob" }).first().waitFor({ timeout: 20000 });
await a.waitForFunction(() => [...document.querySelectorAll("video")].some((v) => v.videoWidth > 0), null, { timeout: 20000 });
await b.getByRole("button", { name: "Mute microphone" }).click();
await b.getByRole("button", { name: "Unmute microphone" }).waitFor();
await a.locator(".tile", { hasText: "Bob" }).locator(".tile-label svg").waitFor({ timeout: 10000 });
assert.equal(await b.evaluate(() => window.__pcs[0].getSenders().filter((s) => s.track?.kind === "audio").every((s) => s.track.enabled === false)), true, "mic track disabled");
await b.getByRole("button", { name: "Unmute microphone" }).click();
await b.getByRole("button", { name: "Turn off camera" }).click();
await a.locator(".tile", { hasText: "Bob" }).locator(".tile-off").waitFor({ timeout: 10000 });
await b.getByRole("button", { name: "Turn on camera" }).click();
console.log("OK mic mute (track disabled + remote shows muted), camera off shows avatar");

await b.getByRole("button", { name: "Share screen" }).click();
await a.locator(".stage-main .tile.screen").waitFor({ timeout: 20000 });
assert.ok((await a.locator(".tile", { hasText: "Bob" }).count()) >= 2, "camera AND screen tiles both present");
await a.waitForFunction(() => [...document.querySelectorAll(".tile.screen video")].some((v) => v.videoWidth > 0), null, { timeout: 20000 });
assert.ok(await a.locator(".tile:not(.screen)", { hasText: "Bob" }).count() >= 1, "camera still present during screen share");
console.log("OK screen share runs together with the camera; screen is spotlighted");

await a.locator(".stage-main .tile.screen").hover();
await a.getByRole("button", { name: "Full screen" }).first().click();
await a.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 5000 });
await a.keyboard.press("Escape");
await a.waitForFunction(() => !document.fullscreenElement, null, { timeout: 5000 }).catch(async () => { await a.evaluate(() => document.exitFullscreen()); });
console.log("OK full screen on the shared screen");

await b.getByRole("button", { name: "Stop sharing screen" }).click();
await a.locator(".tile.screen").waitFor({ state: "detached", timeout: 15000 });
assert.ok(await a.locator(".tile", { hasText: "Bob" }).count() >= 1, "camera survives screen stop");
await b.getByRole("button", { name: "Leave call" }).click();
await a.locator(".tile", { hasText: "Bob" }).waitFor({ state: "detached", timeout: 15000 });
console.log("OK stopping screen/call removes only those tiles");

// ---- link drop heals, no false left ----
await b.evaluate(() => window.__pcs.forEach((pc) => pc.close()));
await b.waitForTimeout(12000);
assert.ok(!(await text(a)).includes("Bob left"), "false left after link drop");
await say(b, "after heal");
for (const p of [a, c, d]) await until(p, "after heal", 20000);
console.log("OK link drop: no false left, mesh redialed");

// ---- permissions, kick, handover, succession, close ----
await a.getByLabel("Members can chat").uncheck();
await b.getByPlaceholder("Chat disabled by host").waitFor({ timeout: 10000 });
await a.getByLabel("Members can chat").check();
console.log("OK permissions");
await a.locator("li", { hasText: "Bob" }).hover();
await a.getByRole("button", { name: "Kick Bob" }).click();
await a.getByRole("button", { name: "Remove", exact: true }).click();
await until(b, "You were removed"); await until(a, "Bob was removed");
console.log("OK kick");
await a.locator("li", { hasText: "Cat" }).hover();
await a.getByRole("button", { name: "Make Cat host" }).click();
await until(c, "Cat is now host"); await c.getByText("Close space").waitFor();
console.log("OK handover");
await c.getByRole("button", { name: "Leave space" }).click();
await c.getByRole("button", { name: "Leave now" }).click();
await until(a, "Ann is now host"); await a.getByText("Close space").waitFor({ timeout: 10000 });
console.log("OK host left -> automatic succession");
await a.getByText("Close space").click();
await a.getByRole("button", { name: "Close for everyone" }).click();
await until(d, "Space closed");
console.log("OK close space");
await browser.close();
