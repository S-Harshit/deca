// Sending pictures from a phone: a button that opens the photo library itself, and a plain-words note when the link was opened inside another app.
const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch();
  const phone = await (await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true })).newPage();
  await phone.goto("http://localhost:8080/"); await phone.locator("input").first().fill("Phone"); await phone.getByRole("button", { name: /create/i }).first().click(); await phone.locator(".composer textarea").waitFor();
  const photos = phone.locator(".photos-btn");
  ok("on a phone there is a Photos button in the chat box", await photos.isVisible());
  const input = photos.locator("input");
  ok("it asks for pictures and videos, which opens the gallery picker", (await input.getAttribute("accept")) === "image/*,video/*" && (await input.getAttribute("multiple")) !== null);
  const bx = await photos.boundingBox();
  ok("it fits next to the other buttons without sideways scroll", bx.x >= 0 && bx.x + bx.width <= 390 && (await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
  await input.setInputFiles({ name: "IMG_0001.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") });
  await phone.getByText("IMG_0001.png").first().waitFor({ timeout: 8000 });
  ok("a picture chosen there is shared into the room", (await phone.getByText("IMG_0001.png").count()) >= 1);
  const desk = await (await b.newContext({ viewport: { width: 1300, height: 850 } })).newPage();
  await desk.goto("http://localhost:8080/"); await desk.locator("input").first().fill("Desk"); await desk.getByRole("button", { name: /create/i }).first().click(); await desk.locator(".composer textarea").waitFor();
  ok("on a computer the Photos button stays out of the way", !(await desk.locator(".photos-btn").isVisible()));
  // opened inside another app
  const inapp = await (await b.newContext({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0", viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true })).newPage();
  await inapp.goto("http://localhost:8080/");
  ok("inside another app, the page says how to open it in the real browser", /Open in Safari/.test(await inapp.getByRole("note").innerText()));
  const normal = await (await b.newContext({ viewport: { width: 390, height: 780 } })).newPage(); await normal.goto("http://localhost:8080/");
  ok("in a normal browser there is no such note", (await normal.getByRole("note").count()) === 0);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
