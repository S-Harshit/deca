import { chromium } from "../lib/browser.mjs";
import assert from "node:assert";
const BASE = "http://localhost:8080/";
const browser = await chromium.launch({ });
const CAT = "https://img.magnific.com/free-vector/simple-vibing-cat-square-meme_742173-4493.jpg?semt=ais_hybrid&w=740&q=80";
const mk = async (name, hash = "") => {
  const p = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  p.on("pageerror", (e) => console.log("[" + name + "] pageerror", e.stack));
  await p.goto(BASE + hash); await p.getByPlaceholder("display name").fill(name); return p;
};
const box = (p) => p.getByPlaceholder("Write a message…");
const send = async (p, m) => { await box(p).fill(m); await p.keyboard.press("Enter"); };
const decoded = (p, sel = ".link-image img") => p.locator(sel).first().evaluate((i) => i.complete && i.naturalWidth > 0);

const a = await mk("Ann"); await a.getByText("Create a space").click(); await a.getByText("Ann joined").waitFor();
const hash = new URL(a.url()).hash;
const b = await mk("Bob", hash); await b.getByText(/Join space/).click(); await a.getByText("Bob joined").waitFor();

// ---- image links ----
await send(a, "lol " + CAT);
for (const p of [a, b]) { await p.locator(".link-image img").waitFor({ timeout: 20000 }); await p.waitForFunction(() => { const i = document.querySelector(".link-image img"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 20000 }); }
assert.ok(await b.locator('.what a[href^="https://img.magnific.com"]').count() >= 1, "the link is still there too");
const dims = await b.locator(".link-image img").first().evaluate((i) => ({ w: i.clientWidth, h: i.clientHeight, nat: i.naturalWidth }));
assert.ok(dims.w <= 360 && dims.h <= 300 && dims.nat > 300, "sized to fit the chat: " + JSON.stringify(dims));
console.log("OK the real image URL from the request renders inline for everyone (" + JSON.stringify(dims) + ")");

await send(a, "a local one https://localhost:8080/vite.svg. and a non-image https://example.com/page");
await send(a, "see http://localhost:8080/vite.svg.");
await b.waitForFunction(() => document.querySelectorAll(".link-image img").length >= 2, null, { timeout: 15000 });
assert.equal(await b.locator('a[href="https://example.com/page"]').count(), 1);
assert.equal(await b.locator('.link-image[href="https://example.com/page"]').count(), 0, "plain pages get no preview");
console.log("OK trailing dot doesn't break the link; ordinary pages stay plain links");

await send(a, "broken https://localhost:8080/nope.png");
await b.getByText("broken").waitFor(); await b.waitForTimeout(1500);
assert.equal(await b.locator('.line:has-text("broken") .link-image').count(), 0, "a link that isn't really an image leaves no broken box");
assert.equal(await b.locator('.line:has-text("broken") a[href$="nope.png"]').count(), 1, "but the link stays");
console.log("OK broken/non-image responses fall back to just the link");

// ---- preference: off means click-to-load ----
await b.getByRole("button", { name: "Appearance" }).click();
await b.getByLabel("Preview image links").uncheck(); await b.keyboard.press("Escape"); await b.mouse.click(700, 500);
await b.locator(".show-image").first().waitFor({ timeout: 5000 });
assert.equal(await b.locator(".link-image img").count(), 0, "no image fetched while previews are off");
await b.reload(); await b.getByPlaceholder("display name").fill("Bob"); await b.getByText(/Join space/).click();
await b.locator(".show-image").first().waitFor({ timeout: 15000 });
const showMe = await b.locator(".show-image").count(); await b.locator(".show-image").first().click();
await b.waitForFunction((n) => document.querySelectorAll(".link-image img").length >= 1 && document.querySelectorAll(".show-image").length === n - 1, showMe, { timeout: 15000 });
console.log("OK 'Preview image links' off: nothing loads until 'Show image' is clicked, and the setting persists");
await b.getByRole("button", { name: "Appearance" }).click(); await b.getByLabel("Preview image links").check(); await b.keyboard.press("Escape");

// ---- coin ----
const viaMenu = async (p, item) => { await p.getByRole("button", { name: "Deciders" }).click(); await p.getByRole("menuitem", { name: item }).click(); };
const flips = async (p) => p.locator(".coin-row[data-result=heads], .coin-row[data-result=tails]").evaluateAll((els) => els.map((e) => e.dataset.result));
await viaMenu(a, /Flip a coin/);
await a.locator('.coin-row[data-result="flipping"]').waitFor({ timeout: 3000 });
await b.locator('.coin-row[data-result="flipping"]').waitFor({ timeout: 5000 });
assert.ok(await b.locator(".coin.flipping").count() === 1, "live flip animates for the other person too");
await Promise.all([a, b].map((p) => p.waitForFunction(() => document.querySelectorAll('.coin-row[data-result="heads"], .coin-row[data-result="tails"]').length >= 1, null, { timeout: 6000 })));
assert.deepEqual(await flips(a), await flips(b), "both see the same result");
console.log("OK coin button: animates live on both sides and lands on the same face (" + (await flips(a))[0] + ")");

for (let i = 0; i < 24; i++) await send(a, "/flip");
await b.waitForFunction(() => document.querySelectorAll('.coin-row[data-result="heads"], .coin-row[data-result="tails"]').length >= 25, null, { timeout: 20000 });
const fa = await flips(a), fb = await flips(b);
assert.deepEqual(fa, fb, "25 flips identical on both sides");
assert.ok(fa.includes("heads") && fa.includes("tails"), "both faces occur in 25 flips: " + fa.join(""));
assert.equal(await a.locator('.line .what:has-text("/flip")').count(), 0, "/flip is a command, not a chat message");
console.log("OK /flip command: 24 flips consistent on both sides, both faces appear (" + fa.filter((x) => x === "heads").length + " heads of " + fa.length + ")");

// ---- late joiner: results only, no replayed animation ----
const c = await mk("Cat", hash); await c.getByText(/Join space/).click();
await c.waitForFunction(() => document.querySelectorAll('.coin-row').length >= 25, null, { timeout: 15000 });
await c.waitForTimeout(400);
assert.equal(await c.locator(".coin.flipping").count(), 0, "history doesn't replay flips");
assert.deepEqual(await flips(c), fa, "late joiner sees the same history");
console.log("OK late joiner sees every result instantly, no replay");

// ---- permission ----
await a.getByLabel("Members can chat").uncheck();
await b.getByPlaceholder("Chat disabled by host").waitFor({ timeout: 10000 });
assert.ok(await b.getByRole("button", { name: "Deciders" }).isDisabled(), "member can't flip when chat is off");
console.log("OK host turning chat off also stops members flipping");
await browser.close();
