import { chromium } from "../lib/browser.mjs";
import assert from "node:assert";
const BASE = "http://localhost:8080/";
const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const mk = async (name, hash = "", skewMs = 0) => {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[" + name + "] pageerror", e.stack));
  if (skewMs) await page.addInitScript((off) => { const n = Date.now.bind(Date); Date.now = () => n() + off; }, skewMs);
  await page.goto(BASE + hash); await page.getByPlaceholder("display name").fill(name); return page;
};
const secs = async (p) => { const t = (await p.getByRole("timer").innerText()).trim(); const parts = t.split(":").map(Number); return parts.reduce((x, y) => x * 60 + y, 0); };
const leaveBtn = (p) => p.getByRole("button", { name: "Leave space" });
const dialog = (p) => p.getByRole("alertdialog");

const a = await mk("Ann"); await a.getByText("Create a space").click(); await a.getByText("Ann joined").waitFor();
const hash = new URL(a.url()).hash;

// ---- leave dialog, alone ----
await leaveBtn(a).click(); await dialog(a).waitFor();
assert.ok((await dialog(a).innerText()).includes("only one here"), "warns that the space ends when you are alone");
await a.getByRole("button", { name: "Stay" }).click(); await dialog(a).waitFor({ state: "detached" });
assert.ok(await a.getByRole("button", { name: "Leave space" }).isVisible(), "still in the space after Stay");
await leaveBtn(a).click(); await a.keyboard.press("Escape"); await dialog(a).waitFor({ state: "detached" });
await leaveBtn(a).click(); await dialog(a).click({ position: { x: 1, y: 1 } }).catch(() => {}); // inside the card: must NOT dismiss
assert.ok(await dialog(a).isVisible(), "clicking inside the card keeps it open");
await a.mouse.click(10, 10); await dialog(a).waitFor({ state: "detached" });
console.log("OK leave dialog: alone warning; Stay, Esc and backdrop all cancel; card click does not");

// ---- host with others, sharing files, in a call ----
const b = await mk("Bob", hash); await b.getByText(/Join space/).click();
await a.getByText("Bob joined").waitFor();
await a.locator("input[type=file]").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
await b.getByText("notes.txt").waitFor();
await a.getByRole("button", { name: /Start call/ }).click();
await a.getByRole("timer").waitFor({ timeout: 15000 });
await leaveBtn(a).click(); await dialog(a).waitFor();
const text = await dialog(a).innerText();
for (const want of ["host", "Bob will take over", "Your call will end", "file you shared"]) assert.ok(text.includes(want), "dialog mentions: " + want + "\n" + text);
await a.getByRole("button", { name: "Stay" }).click();
console.log("OK leave dialog: host handover target, call ending, and shared-file consequences are spelled out");

// ---- tab close warning only when it matters ----
const dialogs = [];
a.on("dialog", (d) => { dialogs.push(d.type()); d.accept(); });
await a.close({ runBeforeUnload: true });
await new Promise((r) => setTimeout(r, 800));
assert.ok(dialogs.includes("beforeunload"), "closing the tab mid-call asks first: " + JSON.stringify(dialogs));
const calm = await mk("Cat", hash); await calm.getByText(/Join space/).click(); await calm.getByText("Cat joined").waitFor();
const calmDialogs = []; calm.on("dialog", (d) => { calmDialogs.push(d.type()); d.accept(); });
await calm.close({ runBeforeUnload: true }); await new Promise((r) => setTimeout(r, 800));
assert.deepEqual(calmDialogs, [], "no nagging when nothing is at stake");
console.log("OK tab close: browser warning mid-call, silent when nothing is at stake");

// ---- call timer (fresh space) ----
const h = await mk("Hana"); await h.getByText("Create a space").click(); await h.getByText("Hana joined").waitFor();
const hash2 = new URL(h.url()).hash;
const i = await mk("Ivo", hash2, 3600 * 1000); // this browser's clock is an HOUR fast
await i.getByText(/Join space/).click(); await h.getByText("Ivo joined").waitFor();
await h.getByRole("button", { name: /Start call/ }).click();
await h.getByRole("timer").waitFor({ timeout: 15000 }); await i.getByRole("timer").waitFor({ timeout: 20000 });
await h.waitForTimeout(3500);
const [t1h, t1i] = [await secs(h), await secs(i)];
assert.ok(t1h >= 3, "timer counts up: " + t1h);
assert.ok(Math.abs(t1h - t1i) <= 2, "both sides agree despite a 1h clock skew: " + t1h + " vs " + t1i);
// the second person joining the call must not reset it
await i.getByRole("button", { name: /Start call/ }).click(); await i.waitForTimeout(2500);
const [t2h, t2i] = [await secs(h), await secs(i)];
assert.ok(t2i >= t1i + 2 && Math.abs(t2h - t2i) <= 2, "joining later does not restart the call timer: " + [t1h, t1i, t2h, t2i]);
await h.getByRole("button", { name: "Leave call" }).click(); await i.waitForTimeout(1500);
assert.ok(await i.getByRole("timer").isVisible(), "call still running while one person remains");
await i.getByRole("button", { name: "Leave call" }).click();
await h.getByRole("timer").waitFor({ state: "detached", timeout: 10000 });
console.log("OK call timer: shared across a skewed clock, late joiner doesn't reset it, vanishes when the call ends");

// ---- confirm leaves for real ----
await leaveBtn(h).click(); await h.getByRole("button", { name: "Leave now" }).click();
await h.getByRole("button", { name: /create a space/i }).waitFor();
console.log("OK 'Leave now' returns to the home screen");
await browser.close();
