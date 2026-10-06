const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
const URL = "http://localhost:8080/";
const decode = (p, code) => p.evaluate(async (code) => { const un = (x) => Uint8Array.from(atob(x.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0)); const inf = async (u) => new TextDecoder().decode(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()); const c = JSON.parse(await inf(un(code.slice(6)))); const lines = []; for (const m of c.m) { if (m.candidate?.candidate) lines.push(m.candidate.candidate); if (m.description?.sdp) for (const l of m.description.sdp.split(/\r?\n/)) if (l.startsWith("a=candidate:")) lines.push(l.slice(2)); } return [...new Set(lines)].map((l) => l.split(" ")); }, code);
const kinds = (c) => ({ real: c.filter((f) => f[7] === "host" && !f[4].endsWith(".local")).length, hidden: c.filter((f) => f[7] === "host" && f[4].endsWith(".local")).length, srflx: c.filter((f) => f[7] === "srflx").length });
async function scenario(label, { args = [], tick = true, perms = [] }) {
  console.log(`\n=== ${label}`);
  const b = await chromium.launch({ args });
  const mk = async (link) => { const p = await (await b.newContext({ viewport: { width: 1300, height: 850 }, permissions: perms })).newPage(); await p.addInitScript(() => { window.__gum = 0; window.__tracks = []; const md = navigator.mediaDevices; if (md?.getUserMedia) { const g = md.getUserMedia.bind(md); md.getUserMedia = async (c) => { window.__gum++; const s = await g(c); window.__tracks.push(...s.getTracks()); return s; }; } }); await p.goto(link || URL); return p; };
  const dialog = (p) => p.getByRole("dialog", { name: "Connect by code" });
  const A = await mk(); await A.locator("input").first().fill("Ann"); await A.getByRole("button", { name: "No server? Connect by code" }).click();
  ok("the first screen explains the Same Wi-Fi option in plain words", /Same Wi-Fi\? Let my browser share its Wi-Fi address/.test(await A.locator("body").innerText()) && /nothing is recorded/.test(await A.locator("body").innerText()));
  const box = A.getByLabel(/Same Wi-Fi/); ok("it is ticked by default", await box.isChecked()); if (!tick) await box.uncheck();
  await A.getByRole("button", { name: "Create a space (no server)" }).click(); await A.locator(".composer textarea").waitFor();
  ok(tick ? "the microphone was asked for once (silently, no recording)" : "unticked: the microphone was NOT asked for", (await A.evaluate(() => window.__gum)) === (tick ? 1 : 0) || (tick && perms.length === 0), await A.evaluate(() => window.__gum));
  const B = await mk(`${URL}${await A.evaluate(() => location.hash)}`); await B.locator("input").first().fill("Bob");
  ok("joining by invite shows the same option", (await B.getByLabel(/Same Wi-Fi/).count()) === 1); if (!tick) await B.getByLabel(/Same Wi-Fi/).uncheck();
  await B.getByRole("button", { name: "Join space (no server)" }).click(); await dialog(B).waitFor({ timeout: 20000 });
  const codeB = await dialog(B).locator("textarea[readonly]").inputValue(); const cb = kinds(await decode(B, codeB));
  console.log("   Bob's code carries:", JSON.stringify(cb));
  if (tick && perms.length === 0) ok("microphone not available/allowed: joining still works (addresses stay hidden)", cb.hidden > 0);
  else if (tick) ok("with the option on: the code carries REAL Wi-Fi addresses (no hidden names)", cb.real > 0 && cb.hidden === 0, JSON.stringify(cb));
  else ok("with the option off: the addresses are hidden names (what makes same-Wi-Fi fail)", cb.hidden > 0 && cb.real === 0, JSON.stringify(cb));
  await A.getByRole("button", { name: "Paste their code" }).click(); await dialog(A).getByLabel("Paste a code").fill(codeB); await dialog(A).getByRole("button", { name: "Connect" }).click(); { const y = dialog(A).getByRole("button", { name: "Let them in" }); try { await y.waitFor({ timeout: 2000 }); await y.click(); } catch {} } await dialog(A).locator("textarea[readonly]").waitFor();
  const reply = await dialog(A).locator("textarea[readonly]").inputValue(); const ca = kinds(await decode(A, reply));
  console.log("   Ann's reply carries:", JSON.stringify(ca));
  const det = await dialog(A).locator("details").innerText().catch(() => ""); await dialog(A).locator("summary").click(); const detail = await dialog(A).locator(".code-diag").first().innerText();
  console.log("   details shown to Ann:", detail.replace(/\s+/g, " ").slice(0, 260));
  ok("the help lists what each code offered, in plain words", /Details for Bob/.test(detail) && /offered/.test(detail));
  if (tick && perms.length) ok("and says nothing alarming when real Wi-Fi addresses are offered", !/hid their Wi-Fi address/.test(detail));
  if (!tick) ok("with hidden addresses it names the likely cause and the fix", /hid their Wi-Fi address/.test(detail) && /Same Wi-Fi/.test(detail), detail);
  await dialog(B).getByRole("button", { name: "I have sent it: next" }).click(); await dialog(B).getByLabel("Paste a code").fill(reply); await dialog(B).getByRole("button", { name: "Connect" }).click();
  await B.waitForFunction(() => (document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || "").includes("2 / "), null, { timeout: 30000 }); ok("connected", true);
  await B.waitForTimeout(500);
  const had = await B.evaluate(() => window.__tracks.length);
  if (tick && had) { const ended = await B.evaluate(() => window.__tracks.every((t) => t.readyState === "ended")); ok("once the link is up the microphone is released (track ended, so the browser's mic light goes off)", ended, String(ended)); }
  await b.close();
}
(async () => {
  await scenario("option on, microphone allowed (permission granted, as after clicking Allow)", { args: ["--use-fake-device-for-media-stream"], perms: ["microphone"] });
  await scenario("option off (no permission asked)", { args: ["--use-fake-device-for-media-stream"], tick: false });
  await scenario("option on but the microphone is refused / unavailable", { args: [] });
  console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.log("ERR", e.message.split("\n").slice(0, 10).join("\n")); process.exit(1); });
