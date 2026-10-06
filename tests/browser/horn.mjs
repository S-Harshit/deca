import { chromium } from "../lib/browser.mjs";
import assert from "node:assert";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const mk = async (name, hash = "") => {
  const p = await (await browser.newContext({ viewport: { width: 1300, height: 820 } })).newPage();
  p.on("pageerror", (e) => console.log("[" + name + "] pageerror", e.message));
  await p.addInitScript(() => { window.__osc = 0; const s = OscillatorNode.prototype.start; OscillatorNode.prototype.start = function (...a) { window.__osc++; return s.apply(this, a); }; });
  await p.goto("http://localhost:8080/" + hash); await p.getByPlaceholder("display name").fill(name); return p;
};
const osc = (p) => p.evaluate(() => window.__osc);
const flash = (p) => p.locator(".horn-flash");
const a = await mk("Ann"); await a.getByText("Create a space").click(); await a.getByText("Ann joined").waitFor(); const hash = new URL(a.url()).hash;
const b = await mk("Bob", hash); await b.getByText(/Join space/).click(); const c = await mk("Cat", hash); await c.getByText(/Join space/).click();
for (const p of [a, b, c]) await p.getByText("Cat joined").waitFor();
await a.waitForTimeout(1200);

// ---- only the host has the button ----
assert.equal(await b.getByRole("button", { name: /Wake up/ }).count(), 0); assert.equal(await c.getByRole("button", { name: /Wake up/ }).count(), 0);
await a.getByRole("button", { name: /Wake up/ }).waitFor();
console.log("OK the red button exists for the host only");

// ---- press: everyone gets the flash, the line and the sound ----
await a.getByRole("button", { name: /Wake up/ }).click();
for (const p of [a, b, c]) { await flash(p).waitFor({ timeout: 4000 }); await p.getByText("Ann sounded the air horn").first().waitFor(); }
for (const p of [a, b, c]) assert.ok((await osc(p)) >= 6, "the horn's tones were started on this device (" + (await osc(p)) + ")");
console.log("OK one press: flash + alert + the horn sound on all three devices");

// ---- cooldown ----
assert.ok(await a.getByRole("button", { name: /Sounded/ }).isDisabled(), "button locks right after");
await a.waitForTimeout(3300); await a.getByRole("button", { name: /Wake up/ }).waitFor();
const before = await osc(b); await a.getByRole("button", { name: /Wake up/ }).click(); await flash(b).waitFor({ timeout: 4000 });
assert.ok((await osc(b)) > before, "and works again after the cooldown");
console.log("OK 3-second cooldown: no spamming, works again afterwards");

// ---- a person can silence it on their own device (still sees the alert) ----
await c.getByRole("button", { name: "Appearance" }).click(); await c.getByLabel("Play the host's air horn").uncheck(); await c.keyboard.press("Escape"); await c.mouse.click(40, 500);
await a.waitForTimeout(3300); const [cb, bb] = [await osc(c), await osc(b)];
await a.getByRole("button", { name: /Wake up/ }).click(); await flash(c).waitFor({ timeout: 4000 }); await c.getByText("sounded the air horn").first().waitFor(); await b.waitForTimeout(600);
assert.equal(await osc(c), cb, "no sound on the device that muted it"); assert.ok((await osc(b)) > bb, "other devices still hear it");
console.log("OK 'Play the host's air horn' off: that device stays silent but still sees the flash and alert");

// ---- late joiners read the history, never hear it ----
const d = await mk("Dan", hash); await d.getByText(/Join space/).click(); await d.getByText("sounded the air horn").first().waitFor({ timeout: 15000 });
await d.waitForTimeout(1200);
assert.equal(await flash(d).count(), 0); assert.equal(await osc(d), 0, "history is silent");
console.log("OK a late joiner sees the lines in history but gets no flash and no sound");

// ---- the button follows the host role ----
await a.locator("li", { hasText: "Bob" }).hover(); await a.getByRole("button", { name: "Make Bob host" }).click();
await b.getByRole("button", { name: /Wake up/ }).waitFor({ timeout: 8000 });
await a.waitForFunction(() => ![...document.querySelectorAll("button")].some((x) => /Wake up/.test(x.textContent)), null, { timeout: 8000 });
console.log("OK hand the host role over and the red button moves with it");
await browser.close();
