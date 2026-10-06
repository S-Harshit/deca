import { chromium } from "../lib/browser.mjs";
import assert from "node:assert";
const BASE = "http://localhost:8080/";
const browser = await chromium.launch({ });
const mk = async (name, hash = "", skewMs = 0) => {
  const p = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  p.on("pageerror", (e) => console.log("[" + name + "] pageerror", e.stack));
  if (skewMs) await p.addInitScript((off) => { const n = Date.now.bind(Date); Date.now = () => n() + off; }, skewMs);
  await p.goto(BASE + hash); await p.getByPlaceholder("display name").fill(name); return p;
};
const box = (p) => p.getByPlaceholder("Write a message…");
const send = async (p, m) => { await box(p).fill(m); await p.keyboard.press("Enter"); };
const rows = (p) => p.locator(".rps-row");
const shown = (p, n) => p.waitForFunction((n) => document.querySelectorAll('.rps-row[data-state="shown"]').length >= n, n, { timeout: 8000 });
const results = (p) => p.locator(".rps-result").evaluateAll((els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
const ICON = { "✊": "rock", "✋": "paper", "✌️": "scissors" };

const a = await mk("Ann"); await a.getByText("Create a space").click(); await a.getByText("Ann joined").waitFor();
const hash = new URL(a.url()).hash;
const b = await mk("Bob", hash, 3600 * 1000); // Bob's clock is an HOUR fast: pairing must not care
await b.getByText(/Join space/).click(); await a.getByText("Bob joined").waitFor();

// ---- the menu ----
await a.getByRole("button", { name: "Deciders" }).click();
assert.equal(await a.getByRole("menuitem").count(), 3); // coin, rock paper scissors, blame
await a.keyboard.press("Escape"); assert.equal(await a.getByRole("menu").count(), 0);
await a.getByRole("button", { name: "Deciders" }).click(); await a.mouse.click(700, 300); assert.equal(await a.getByRole("menu").count(), 0);
console.log("OK Deciders menu: lists all three, closes on Esc and outside click");

// ---- a lone throw waits; throwing twice is refused ----
await a.getByRole("button", { name: "Deciders" }).click(); await a.getByRole("menuitem", { name: /Rock paper scissors/ }).click();
await rows(a).first().waitFor(); await rows(b).first().waitFor({ timeout: 5000 });
assert.equal(await a.locator('.rps-row[data-state="throwing"]').count(), 1, "it shakes before it lands");
await shown(a, 1); await shown(b, 1);
await a.getByText("waiting for someone to throw").waitFor();
await send(a, "/rps"); await a.getByText("already thrown").waitFor({ timeout: 4000 });
assert.equal(await rows(a).count(), 1, "second throw by the same person is refused");
console.log("OK a lone throw waits for an opponent; you can't re-roll while it's pending");

// ---- the other person answers: one shared result ----
await send(b, "/rps"); await shown(a, 2); await shown(b, 2);
await a.locator(".rps-result").waitFor(); await b.locator(".rps-result").waitFor();
const [ra, rb] = [await results(a), await results(b)];
const same = (t) => t.replace(/\b(you|Ann|Bob)\b/g, "#").replace(/wins?/, "win");
assert.equal(ra.length, 1); assert.equal(same(ra[0]), same(rb[0]), "same outcome from both points of view: " + ra[0] + " | " + rb[0]);
const txt = ra[0]; // e.g. "✊ Ann vs ✋ you: Bob win"  (a's view)
const [, h1, , h2] = /^(\S+) (\S+) vs (\S+) (\S+):/.exec(txt.replace("✌️", "✌")) ?? [];
console.log("OK answering pairs the throws and both sides show the same result: " + txt);

// ---- many rounds, including ties: always consistent, always exactly one result line per pair ----
let ties = 0, decided = 0;
for (let i = 0; i < 10; i++) {
  const first = i % 2 ? a : b, second = i % 2 ? b : a;
  const before = await rows(a).count();
  await send(first, "/rps"); await a.waitForFunction((n) => document.querySelectorAll(".rps-row").length >= n, before + 1, { timeout: 8000 });
  await a.waitForTimeout(150);
  await send(second, "/rps"); await a.waitForFunction((n) => document.querySelectorAll(".rps-row").length >= n, before + 2, { timeout: 8000 });
  await shown(a, before + 2); await shown(b, before + 2);
}
const [fa, fb] = [await results(a), await results(b)];
assert.equal(fa.length, 11); assert.equal(fb.length, 11, "one result line per pair on both sides");
const norm = (t) => t.replace(/\b(you)\b/g, "#").replace(/\b(Ann|Bob)\b/g, "#");
ties = fa.filter((t) => t.includes("a tie")).length; decided = fa.length - ties;
console.log("OK 11 rounds: " + decided + " decided, " + ties + " ties, identical line counts on both sides");
for (const t of fa) assert.ok(/ vs .*: (a tie, throw again| win)/.test(t.replace(/wins?/, " win")) || / wins?$/.test(t), "well-formed: " + t);

// ---- each result is correct for the hands shown ----
const okAll = await a.locator(".rps-result").evaluateAll((els) => els.every((e) => {
  const t = e.textContent.replace(/\s+/g, " ").trim(); const m = /^(\S+) (\S+) vs (\S+) (\S+): (.*)$/.exec(t); if (!m) return false;
  const rank = (x) => x.startsWith("✊") ? "rock" : x.startsWith("✋") ? "paper" : "scissors";
  const [p, q] = [rank(m[1]), rank(m[3])]; const beats = { rock: "scissors", scissors: "paper", paper: "rock" };
  const tie = p === q; if (tie !== m[5].includes("tie")) return false;
  if (tie) return true; const leftWins = beats[p] === q; const winner = leftWins ? m[2] : m[4];
  return m[5].startsWith(winner);
}));
assert.ok(okAll, "every announced winner matches the actual hands");
console.log("OK every result line names the right winner for the hands shown");

// ---- third person throws with nothing open: stays unanswered; late joiner sees history, no animation ----
const c = await mk("Cat", hash); await c.getByText(/Join space/).click(); await c.getByText("Cat joined").waitFor();
await c.waitForFunction(() => document.querySelectorAll(".rps-row").length >= 22, null, { timeout: 15000 });
assert.equal(await c.locator(".hand.shaking").count(), 0, "history doesn't replay throws");
assert.deepEqual((await results(c)).map(norm).length, 11, "late joiner sees all 11 results");
console.log("OK late joiner sees every throw and result instantly");

// ---- permission ----
await a.getByLabel("Members can chat").uncheck();
await b.getByPlaceholder("Chat disabled by host").waitFor({ timeout: 10000 });
assert.ok(await b.getByRole("button", { name: "Deciders" }).isDisabled());
console.log("OK host turning chat off also disables deciders for members");
await browser.close();
