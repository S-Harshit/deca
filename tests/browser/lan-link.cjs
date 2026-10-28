// "Open on your phone" from a room running on localhost: the QR code carries this computer's address on the local network, and a page opened
// there (a plain http address: no WebCrypto, so signing is done in plain JavaScript) works and talks to the laptop's page, in both directions.
const os = require("node:os"); const http = require("node:http");
const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
const lanIp = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === "IPv4" && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address))?.address;
(async () => {
  if (!lanIp) { console.log("SKIP no private network address on this machine"); process.exit(0); }
  const b = await chromium.launch();
  const mk = async (opts = {}) => { const c = await b.newContext({ viewport: { width: 1300, height: 850 }, ...opts }); const p = await c.newPage(); p.on("pageerror", (e) => console.log("pageerror", e.message)); return p; };
  // the server answers /lan only to this same computer
  const lan = await new Promise((res) => http.get({ host: lanIp, port: 8080, path: "/lan" }, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(JSON.parse(d))); }));
  ok("a request from another address is not told what is behind the router", lan.addresses.length === 0, JSON.stringify(lan));
  const A = await mk(); await A.goto("http://localhost:8080/"); await A.locator("input").first().fill("Ann"); await A.getByRole("button", { name: /create/i }).first().click(); await A.locator(".composer textarea").waitFor();
  ok("the laptop's own page is a secure context (localhost)", await A.evaluate(() => isSecureContext && !!crypto.subtle));
  await A.getByRole("button", { name: /QR|phone|another device/i }).first().click();
  const dlg = A.getByRole("dialog"); await dlg.waitFor(); await A.waitForTimeout(800);
  const link = await dlg.locator("code.link").innerText();
  ok("the QR link uses the computer's Wi-Fi address, not localhost", link.startsWith(`http://${lanIp}:8080/#/s/`), link);
  ok("and the old 'a phone cannot open it' warning is gone", !/phone cannot open it/.test(await dlg.innerText()) && /same Wi-Fi/.test(await dlg.innerText()));
  await A.keyboard.press("Escape");
  // the "phone": the same link, a page that is NOT a secure context
  const P = await mk({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  await P.goto(link);
  ok("the phone's page has no WebCrypto at all (a plain http address)", await P.evaluate(() => !isSecureContext && !crypto.subtle));
  await P.locator("input").first().fill("Phone"); await P.getByRole("button", { name: /join/i }).first().click(); await P.locator(".composer textarea").waitFor({ timeout: 20000 });
  await A.waitForFunction(() => /\b2 \/ /.test(document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || ""), null, { timeout: 30000 });
  ok("it joins the room (it could make and use its own signing key)", true);
  await P.locator(".composer textarea").fill("hello from the phone"); await P.keyboard.press("Enter");
  await A.getByText("hello from the phone").first().waitFor({ timeout: 10000 });
  ok("the laptop (WebCrypto) accepts a message signed in plain JavaScript", true);
  await A.locator(".composer textarea").fill("hello from the laptop"); await A.keyboard.press("Enter");
  await P.getByText("hello from the laptop").first().waitFor({ timeout: 10000 });
  ok("the phone (plain JavaScript) accepts a message signed by WebCrypto", true);
  // sharing a file between them works too
  await P.locator('input[aria-label="Attach files"]').setInputFiles({ name: "from-phone.txt", mimeType: "text/plain", buffer: Buffer.from("hello file") });
  await A.getByText("from-phone.txt").first().waitFor({ timeout: 10000 });
  ok("a file from the phone shows up on the laptop", true);
  // a call needs a secure address: the page says so in words instead of failing silently
  await P.getByRole("button", { name: /Start call/ }).first().click().catch(() => {}); await P.waitForTimeout(1500);
  ok("starting a call on a plain http address explains why it cannot", /secure|https|localhost/i.test(await P.locator("body").innerText()));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
