import { chromium } from "../lib/browser.mjs";
import assert from "node:assert";
const BASE = "http://localhost:8080/";
const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const mk = async (name, hash = "") => {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"], viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[" + name + "] pageerror", e.stack));
  await page.goto(BASE + hash); await page.getByPlaceholder("display name").fill(name); return page;
};
const box = (p) => p.getByPlaceholder("Write a message…");
const send = async (p, msg) => { await box(p).fill(msg); await p.keyboard.press("Enter"); };

const a = await mk("Ann"); await a.getByText("Create a space").click(); await a.getByText("Ann joined").waitFor();
const hash = new URL(a.url()).hash;
const b = await mk("Bob", hash); await b.getByText(/Join space/).click();
await a.getByText("Bob joined").waitFor(); await b.getByText("Ann joined").waitFor();

// ---- code blocks ----
const CODE = "function greet(name: string) {\n  if (!name) {\n\treturn 'hi';\n  }\n  return \`hello \${name}\`;\n}";
await send(a, "check this out:\n\`\`\`ts\n" + CODE + "\n\`\`\`\nthoughts?");
await b.locator(".codeblock").waitFor();
assert.equal(await b.locator(".codeblock pre").first().evaluate((e) => e.textContent), CODE, "code text (indentation + tab) preserved exactly");
assert.equal((await b.locator(".cb-lang").first().innerText()).toLowerCase(), "ts");
assert.equal(await b.locator(".codeblock pre").first().evaluate((e) => getComputedStyle(e).whiteSpace), "pre", "no wrapping: real code layout");
await b.waitForFunction(() => document.querySelectorAll(".codeblock .hljs-keyword").length > 0, null, { timeout: 15000 });
const colours = await b.locator(".codeblock").first().evaluate((el) => { const c = (s) => { const n = el.querySelector(s); return n && getComputedStyle(n).color; }; return { kw: c(".hljs-keyword"), str: c(".hljs-string") }; });
assert.ok(colours.kw && colours.str && colours.kw !== colours.str, "tokens are coloured differently: " + JSON.stringify(colours));
assert.ok((await b.locator(".line .what").filter({ hasText: "check this out" }).first().innerText()).includes("thoughts?"), "prose around the block kept");
console.log("OK fenced code: exact text/indentation, highlighted, prose around it kept");

await b.getByRole("button", { name: "Copy code" }).first().click();
assert.equal(await b.evaluate(() => navigator.clipboard.readText()), CODE);
console.log("OK copy button copies the exact code");

await send(b, "run \`npm install\` first, docs at https://example.com/docs");
await a.locator("code.inline", { hasText: "npm install" }).waitFor();
await a.getByRole("link", { name: "https://example.com/docs" }).waitFor();
console.log("OK inline code + links in the same message");

// ---- long block collapses, unknown language stays plain, HTML is inert ----
const LONG = Array.from({ length: 30 }, (_, i) => "line_" + i + " = " + i).join("\n");
await send(a, "\`\`\`python\n" + LONG + "\n\`\`\`");
const long = b.locator(".codeblock", { hasText: "line_29" });
await long.waitFor();
assert.ok(await long.locator("pre.clamped").count() === 1, "long block is clamped");
await long.getByRole("button", { name: /Show all 30 lines/ }).click();
assert.equal(await long.locator("pre.clamped").count(), 0);
await send(a, "\`\`\`nonsenselang\nx = 1\n\`\`\`");
const unk = b.locator(".codeblock", { hasText: "nonsenselang" }).or(b.locator(".codeblock").filter({ has: b.locator(".cb-lang", { hasText: "nonsenselang" }) }));
await unk.first().waitFor(); await b.waitForTimeout(400);
assert.equal(await unk.first().locator("pre .hljs span").count(), 0, "unknown language is shown plain");
await send(a, "\`\`\`html\n<img src=x onerror=\"window.__xss=1\"><script>window.__xss=2</script>\n\`\`\`");
await b.locator(".codeblock", { hasText: "onerror" }).waitFor(); await b.waitForTimeout(600);
assert.equal(await b.evaluate(() => window.__xss ?? null), null, "no script ran");
assert.equal(await b.locator(".codeblock", { hasText: "onerror" }).locator("pre img, pre script").count(), 0, "html shown as text, not parsed");
console.log("OK long block collapses + expands, unknown language plain, pasted HTML is inert");

// ---- composer: code button, Shift+Enter ----
await box(a).fill(""); await a.getByRole("button", { name: "Insert code block" }).click();
assert.equal(await box(a).inputValue(), "\`\`\`\n\n\`\`\`");
assert.equal(await box(a).evaluate((t) => t.selectionStart), 4, "cursor parked inside the fence");
await box(a).fill(""); await box(a).type("first"); await a.keyboard.press("Shift+Enter"); await box(a).type("second");
assert.equal(await box(a).inputValue(), "first\nsecond"); await a.keyboard.press("Enter");
await b.locator(".line .what", { hasText: "second" }).waitFor();
assert.ok((await b.locator(".line .what", { hasText: "second" }).first().evaluate((e) => e.innerText)).includes("first\nsecond"), "line break kept");
console.log("OK code button + Shift+Enter newline");

// ---- chat spacing: wide panel and narrow (call) panel ----
const measure = (p) => p.evaluate(() => { const c = document.querySelector(".chat").getBoundingClientRect(); const w = [...document.querySelectorAll(".line:not(.grouped) .what")].pop().getBoundingClientRect(); return { chat: Math.round(c.width), left: Math.round(w.left - c.left), ratio: +(w.width / c.width).toFixed(2) }; });
const wide = await measure(b);
assert.ok(wide.left <= 170, "wide: text starts close to the edge " + JSON.stringify(wide));
await a.getByRole("button", { name: /Start call/ }).click(); await b.waitForTimeout(2500);
const narrow = await measure(b);
assert.ok(narrow.chat <= 400 && narrow.left <= 40 && narrow.ratio >= 0.85, "narrow: text uses the full width " + JSON.stringify(narrow));
console.log("OK chat spacing", JSON.stringify({ wide, narrow }));

// ---- video: opt-in load, then plays inline ----
const b64 = await a.evaluate(async () => {
  const c = document.createElement("canvas"); c.width = 320; c.height = 180; const x = c.getContext("2d");
  const rec = new MediaRecorder(c.captureStream(15), { mimeType: "video/webm;codecs=vp8" }); const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const t = setInterval(() => { x.fillStyle = "hsl(" + ((Date.now() / 5) % 360) + " 80% 50%)"; x.fillRect(0, 0, 320, 180); }, 50);
  rec.start(); await new Promise((r) => setTimeout(r, 1500)); const done = new Promise((r) => (rec.onstop = r)); rec.stop(); await done; clearInterval(t);
  const u = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer()); let s = ""; for (const v of u) s += String.fromCharCode(v); return btoa(s);
});
const clip = Buffer.from(b64, "base64"); assert.ok(clip.length > 1000, "recorded a webm");
await a.locator("input[type=file]").setInputFiles({ name: "demo.webm", mimeType: "video/webm", buffer: clip });
await a.locator("video.chat-video").waitFor({ timeout: 10000 });
await b.getByText("demo.webm").waitFor(); await b.waitForTimeout(1500);
assert.equal(await b.locator("video.chat-video").count(), 0, "receiver did NOT auto-download the video");
assert.equal(await b.locator(".img-ph .progress").count(), 0, "no transfer started on its own");
await b.getByRole("button", { name: "Load video" }).click();
await b.locator("video.chat-video").waitFor({ timeout: 20000 });
await b.waitForFunction(() => { const v = document.querySelector("video.chat-video"); return v && v.readyState >= 1 && v.videoWidth === 320; }, null, { timeout: 15000 });
console.log("OK video: opt-in download (nothing automatic), then plays inline (320x180)");
await browser.close();
