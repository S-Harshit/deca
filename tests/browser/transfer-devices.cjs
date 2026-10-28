// "Move files between my devices" (QR code, auto-lock, a file crossing) and the chime when someone joins.
const fs = require("node:fs");
const { PNG } = require("pngjs");
const jsQR = require("jsqr");
const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };

(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const mk = async (opts = {}) => { const c = await b.newContext({ viewport: { width: 1200, height: 800 }, acceptDownloads: true, ...opts }); const p = await c.newPage(); p.on("pageerror", (e) => console.log("pageerror", e.message)); return p; };
  const dlg = (p) => p.getByRole("dialog", { name: "Open this room on another device" });

  // ---- the personal room
  const A = await mk();
  await A.goto("http://localhost:8080/");
  ok("the landing page offers it", await A.getByRole("button", { name: "Move files between my devices" }).isVisible());
  await A.getByRole("button", { name: "Move files between my devices" }).click();
  await dlg(A).waitFor({ timeout: 10000 });
  ok("it makes a room and shows the QR code at once, without asking for a name", (await dlg(A).locator(".qr-box svg").count()) === 1 && /#\/s\/[\w-]+$/.test(A.url()));
  ok("this device is named for what it is", /My computer/.test(await A.locator(".members").innerText()));
  const link = A.url();
  // decode the QR from a screenshot, like a phone camera would
  const shot = await dlg(A).locator(".qr-box").screenshot();
  const png = PNG.sync.read(shot); const q = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  ok("scanning the QR code gives the invite link", !!q && q.data === link, q?.data + " vs " + link);
  await A.keyboard.press("Escape"); ok("Escape closes it", (await dlg(A).count()) === 0);

  // the phone opens that link
  const P = await mk({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148" });
  await P.goto(q.data); await P.locator("input").first().fill("My phone"); await P.getByRole("button", { name: /join/i }).first().click(); await P.locator(".composer textarea").waitFor();
  await A.getByText("My phone joined").waitFor({ timeout: 20000 });
  ok("the second device joins", true);
  await A.getByText(/room is locked so nobody else can join/).waitFor({ timeout: 8000 }).catch(() => {});
  ok("the room locks itself once the other device is in (and says so)", (await A.getByText(/room is locked so nobody else can join/).count()) >= 1 || (await A.getByLabel(/Lock room/).isChecked()));
  const S = await mk(); await S.goto(link); await S.locator("input").first().fill("Stranger"); await S.getByRole("button", { name: /join/i }).first().click();
  await S.getByRole("heading", { name: /locked/i }).waitFor({ timeout: 15000 }).catch(() => {});
  ok("a third person with the link is turned away", (await S.getByRole("heading", { name: /locked/i }).count()) === 1);

  // a file crosses from the computer to the phone, byte for byte
  fs.writeFileSync("device-file.bin", require("node:crypto").randomBytes(150_000));
  await A.locator('.composer input[aria-label="Attach files"]').setInputFiles("device-file.bin");
  await P.getByText("device-file.bin").first().waitFor({ timeout: 20000 });
  ok("the file shows up on the phone", true);
  await P.getByText("Download").first().click();
  const saved = P.waitForEvent("download", { timeout: 20000 });
  await P.getByText("Save").first().waitFor({ timeout: 20000 }); await P.getByText("Save").first().click();
  const got = fs.readFileSync(await (await saved).path());
  ok("and arrives byte for byte", got.equals(fs.readFileSync("device-file.bin")));
  // text goes the other way
  await P.locator(".composer textarea").fill("https://example.com/from-the-phone"); await P.locator(".composer textarea").press("Enter");
  await A.getByText("https://example.com/from-the-phone").waitFor({ timeout: 10000 });
  ok("a link typed on the phone reaches the computer", true);

  // ---- an ordinary room: the QR is one click away, and the chime
  const H = await mk(); await H.addInitScript(() => { window.__tones = 0; const c = AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator = function () { window.__tones++; return c.call(this); }; });
  await H.goto("http://localhost:8080/"); await H.locator("input").first().fill("Hana"); await H.getByRole("button", { name: /create/i }).first().click(); await H.locator(".composer textarea").waitFor();
  await H.getByRole("button", { name: "Show QR code" }).first().click(); await dlg(H).waitFor({ timeout: 5000 });
  ok("in any room, the top bar opens the QR code", (await dlg(H).locator(".qr-box svg").count()) === 1);
  await H.keyboard.press("Escape");
  await H.getByRole("button", { name: "Show QR code" }).last().click().catch(() => {}); await H.keyboard.press("Escape");
  await H.click("body", { position: { x: 5, y: 5 } }); await H.waitForTimeout(4500); // past the quiet period after our own join
  await H.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  const before = await H.evaluate(() => window.__tones);
  const G = await mk(); await G.goto(H.url()); await G.locator("input").first().fill("Gus"); await G.getByRole("button", { name: /join/i }).first().click(); await G.locator(".composer textarea").waitFor();
  await H.waitForFunction(() => /Gus joined/.test(document.title), null, { timeout: 15000 }).catch(() => {});
  ok("while you are in another tab, the title says who arrived", /Gus joined/.test(await H.title()), await H.title());
  ok("and a soft chime plays", (await H.evaluate(() => window.__tones)) > before);
  ok("the person who just joined is not chimed about the people already there", !/joined/.test(await G.title()), await G.title());
  await H.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
  await H.waitForTimeout(300); ok("coming back clears the note", !/joined/.test(await H.title()), await H.title());
  console.log(`\n${pass} passed, ${fail} failed`); await b.close();
})();
