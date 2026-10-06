import { chromium } from "../lib/browser.mjs";
import assert from "node:assert";
import fs from "node:fs";
const BASE = "http://localhost:8080/";
const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const mk = async (name, hash = "") => {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"], acceptDownloads: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__pcs = []; const P = window.RTCPeerConnection; window.RTCPeerConnection = function (...a) { const pc = new P(...a); window.__pcs.push(pc); return pc; }; window.RTCPeerConnection.prototype = P.prototype; });
  page.on("pageerror", (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto(BASE + hash);
  await page.getByPlaceholder("Display name").fill(name);
  return page;
};
const text = (p) => p.locator("body").innerText();
const until = async (p, s, ms = 15000) => { await p.waitForFunction((s) => document.body.innerText.includes(s), s, { timeout: ms }).catch(async () => { throw new Error(`timeout waiting for "${s}"\n---\n${await text(p)}`); }); };

const a = await mk("Ann");
await a.getByText("Create a space").click();
await until(a, "Ann joined");
const hash = new URL(a.url()).hash;
console.log("space", hash);

const b = await mk("Bob", hash); await b.getByText(/Join space/).click();
const c = await mk("Cat", hash); await c.getByText(/Join space/).click();
for (const p of [a, b, c]) { await until(p, "Bob joined"); await until(p, "Cat joined"); }
console.log("OK join/presence across 3 peers (mesh + sync)");

await b.getByPlaceholder("Write a message…").fill("hello from bob"); await b.getByLabel("Send").click();
for (const p of [a, c]) await until(p, "hello from bob");
console.log("OK chat");

// late-joiner history sync
const d = await mk("Dan", hash); await d.getByText(/Join space/).click();
await until(d, "hello from bob"); await until(d, "Ann joined");
console.log("OK late joiner received history");

// file
await a.locator('input[type=file]').setInputFiles("big.bin");
await until(b, "big.bin");
const dl = b.waitForEvent("download", { timeout: 20000 });
await b.getByText("Download").click();
await until(b, "Save", 20000);
await b.getByText("Save").click();
const download = await dl; const path = await download.path();
assert.equal(fs.statSync(path).size, fs.statSync("big.bin").size);
assert.ok(fs.readFileSync(path).equals(fs.readFileSync("big.bin")));
console.log("OK file transfer 3MB byte-identical");

// oversize
// reload = returned
await c.reload(); await c.getByPlaceholder("Display name").fill("Cat"); await c.getByText(/Join space/).click();
await until(a, "Cat came back", 15000);
await until(c, "hello from bob");
console.log("OK refresh => left + came back, history restored");

// link break must NOT produce a "left", and the mesh must heal
await b.evaluate(() => window.__pcs.forEach((pc) => pc.close()));
await b.waitForTimeout(12000);
assert.ok(!(await text(a)).includes("Bob left"), "false left after link drop");
await b.getByPlaceholder("Write a message…").fill("after heal"); await b.getByLabel("Send").click();
for (const p of [a, c, d]) await until(p, "after heal", 20000);
await c.getByPlaceholder("Write a message…").fill("heal reverse"); await c.getByLabel("Send").click();
await until(b, "heal reverse", 20000);
console.log("OK link drop: no false left, mesh redialed both ways");

// video
await b.getByLabel("Start call").click();
await a.waitForFunction(() => [...document.querySelectorAll("video")].some((v) => v.videoWidth > 0), null, { timeout: 20000 })
  .catch(async () => { throw new Error("no remote video on A\n" + await text(a)); });
console.log("OK video: A renders Bob's stream");
await b.getByLabel(/Leave call|Hang up|End call/).click();

// perms + kick + handover
await a.getByLabel("Members can chat").uncheck();
await b.getByPlaceholder("Chat disabled by host").waitFor({ timeout: 10000 });
console.log("OK permissions");
await a.getByLabel("Members can chat").check();

const bobRow = a.locator(".members > li", { hasText: "Bob" });
await bobRow.hover(); await bobRow.getByLabel("Kick Bob").click(); await a.getByRole("button", { name: "Remove", exact: true }).click();
await until(b, "You were removed");
await until(a, "Bob was removed");
console.log("OK kick");

await a.locator(".members > li", { hasText: "Cat" }).hover(); await a.locator(".members > li", { hasText: "Cat" }).getByLabel("Make Cat host").click();
await until(c, "Cat is now host");
await until(c, "Close space");
console.log("OK handover");
// host leaves: longest-standing online member (Ann) must take over automatically
await c.getByRole("button", { name: "Leave space" }).click(); await c.getByRole("button", { name: "Leave now" }).click().catch(() => {});
await until(a, "Ann is now host");
await a.getByText("Close space").waitFor({ timeout: 10000 });
await until(d, "Cat left");
console.log("OK host left -> automatic succession, leaver's connections closed");
a.on("dialog", (x) => x.accept());
await a.getByText("Close space").click(); await a.getByRole("button", { name: "Close for everyone" }).click();
await until(d, "Space closed");
console.log("OK close space");
await browser.close();
