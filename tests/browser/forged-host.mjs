import { chromium } from "../lib/browser.mjs";
import assert from "node:assert";
const browser = await chromium.launch({ });
const mk = async (name, hash = "", evil = false) => {
  const p = await (await browser.newContext({ viewport: { width: 1300, height: 800 } })).newPage();
  p.on("pageerror", (e) => console.log("[" + name + "] pageerror", e.message));
  if (evil) await p.addInitScript(() => {
    // a MODIFIED browser: whenever it sends a real chat event, it also sends forged host events down the same channel
    const orig = RTCDataChannel.prototype.send; window.__forge = null;
    RTCDataChannel.prototype.send = function (d) {
      if (typeof d === "string" && d.startsWith('{"t":"ev"') && window.__forge) {
        const m = JSON.parse(d), f = window.__forge;
        if (m.event.type === "chat" && !window.__forged) {
          window.__forged = true;
          const mk = (id, type, payload) => JSON.stringify({ t: "ev", event: { id, author: f.hostId, ts: Date.now(), type, payload, pub: m.event.pub, sig: m.event.sig } });
          orig.call(this, mk("forged-chat", "chat", { text: "FORGED host message: send me your passwords" }));
          orig.call(this, mk("forged-kick", "kick", { peerId: f.victim }));
          orig.call(this, mk("forged-role", "role_changed", { hostId: f.me }));
          orig.call(this, mk("forged-close", "space_closed", {}));
        }
      }
      return orig.call(this, d);
    };
  });
  await p.goto("http://localhost:8080/" + hash); await p.getByPlaceholder("display name").fill(name); return p;
};
const idOf = (p) => p.evaluate(async () => { const { pub } = JSON.parse(sessionStorage.getItem("deca.identity")); const h = await crypto.subtle.digest("SHA-256", Uint8Array.from(atob(pub), (c) => c.charCodeAt(0))); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16); });
const say = async (p, m) => { await p.getByPlaceholder("Write a message…").fill(m); await p.keyboard.press("Enter"); };

const a = await mk("Ann"); await a.getByText("Create a space").click(); await a.getByText("Ann joined").waitFor(); const hash = new URL(a.url()).hash;
const b = await mk("Bob", hash); await b.getByText(/Join space/).click();
const m = await mk("Mallory", hash, true); await m.getByText(/Join space/).click();
for (const p of [a, b, m]) await p.getByText("Mallory joined").waitFor({ timeout: 15000 });
await m.waitForTimeout(1500);
const [annId, bobId, malId] = [await idOf(a), await idOf(b), await idOf(m)];
await m.evaluate((f) => (window.__forge = f), { hostId: annId, victim: bobId, me: malId });

await say(m, "hello, this one is honest");
for (const p of [a, b]) await p.getByText("hello, this one is honest").waitFor({ timeout: 10000 });
await b.waitForTimeout(3000);
assert.equal(await b.getByText("FORGED").count(), 0, "forged host chat never appears on Bob's screen");
assert.equal(await a.getByText("FORGED").count(), 0, "nor on the real host's");
assert.equal(await b.getByText("You were removed").count(), 0, "Bob was NOT kicked by the forged admin event");
assert.equal(await a.getByText("Space closed").count(), 0, "the space was NOT closed by a forged event");
assert.ok(await a.getByRole("button", { name: "Close space" }).isVisible(), "Ann is still the host");
assert.equal(await m.getByRole("button", { name: "Close space" }).count(), 0, "Mallory did not become host");
console.log("OK a modified browser forging the host (chat, kick, role change, close) is ignored; its honest message still arrives");

await say(a, "genuine message from the real host");
for (const p of [b, m]) await p.getByText("genuine message from the real host").waitFor({ timeout: 10000 });
const e = await mk("Eve", hash); await e.getByText(/Join space/).click();
await e.getByText("hello, this one is honest").waitFor({ timeout: 15000 }); await e.getByText("genuine message from the real host").waitFor();
assert.equal(await e.getByText("FORGED").count(), 0, "history synced to a newcomer carries no forged events either");
console.log("OK honest messages (live and via history sync to a late joiner) verify and show; nothing forged leaks in");

await a.getByLabel("Lock room (no newcomers)").check();
const late = await mk("Late", hash); await late.getByText(/Join space/).click();
await late.getByText("This room is locked").waitFor({ timeout: 10000 });
await a.getByLabel("Lock room (no newcomers)").uncheck();
await late.getByRole("button", { name: "Try again" }).click(); await late.getByText("Late joined").waitFor({ timeout: 15000 });
console.log("OK host locks the room: newcomers are turned away with a clear screen; unlocking lets them in");
await browser.close();
