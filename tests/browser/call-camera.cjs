// Starting a call turns on only the microphone; the camera starts when you press its button (and its light goes out when you turn it off).
const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };

(async () => {
  const b = await chromium.launch({ realDefaults: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1250, height: 800 }, permissions: ["camera", "microphone"] }); const p = await c.newPage(); await p.addInitScript(() => { window.__gum = []; const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = (c) => { window.__gum.push(JSON.stringify(c)); return g(c); }; }); return p; };
  const join = async (p, name, url) => { await p.goto(url || "http://localhost:8080/"); await p.locator("input").first().fill(name); await p.getByRole("button", { name: url ? /join/i : /create/i }).first().click(); await p.locator(".composer textarea").waitFor(); };
  const live = (p) => p.evaluate(() => [...document.querySelectorAll("video")].some((v) => v.srcObject && v.srcObject.getVideoTracks().some((t) => t.readyState === "live")));
  const A = await mk(); await join(A, "Ann"); const B = await mk(); await join(B, "Bob", A.url());
  await A.waitForFunction(() => /\b2 \/ /.test(document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || ""), null, { timeout: 30000 });

  await A.getByLabel("Start call").click(); await A.waitForTimeout(1500);
  const asked = await A.evaluate(() => window.__gum);
  ok("starting a call asks only for the microphone", asked.length === 1 && /"audio"/.test(asked[0]) && !/"video"/.test(asked[0]), asked.join(" | "));
  ok("the camera button shows the camera is off", (await A.getByRole("button", { name: "Turn on camera" }).count()) === 1);
  ok("no camera is running on this device", !(await live(A)));
  await B.getByLabel("Start call").click(); await B.waitForTimeout(1500);
  ok("both are in the call (mic only): each sees the other's tile", (await A.locator(".tile").count()) >= 2 && (await B.locator(".tile").count()) >= 2);

  await A.getByRole("button", { name: "Turn on camera" }).click(); await A.waitForTimeout(2000);
  ok("turning the camera on asks for it then", (await A.evaluate(() => window.__gum)).some((g, i) => i > 0 && /"video"/.test(g)));
  ok("the camera runs, and the button now offers to turn it off", (await live(A)) && (await A.getByRole("button", { name: "Turn off camera" }).count()) === 1);
  await B.waitForFunction(() => [...document.querySelectorAll("video")].some((v) => v.srcObject && v.srcObject.getVideoTracks().some((t) => t.readyState === "live")), null, { timeout: 15000 }).catch(() => {});
  ok("the other person now receives Ann's video", await live(B));

  await A.getByRole("button", { name: "Turn off camera" }).click(); await A.waitForTimeout(1200);
  ok("turning it off releases the camera (not just hides it)", !(await live(A)) && (await A.getByRole("button", { name: "Turn on camera" }).count()) === 1);
  await A.getByRole("button", { name: "Turn on camera" }).click(); await A.waitForTimeout(1800);
  ok("it can be turned on again", await live(A));

  // the preference: start with the camera on
  const C = await mk(); await C.addInitScript(() => localStorage.setItem("deca.prefs", JSON.stringify({ theme: "graphite", startWithCamera: true })));
  await join(C, "Cy"); await C.getByLabel("Start call").click(); await C.waitForTimeout(1800);
  const ask2 = await C.evaluate(() => window.__gum);
  ok("with the setting on, starting a call turns the camera on too", /"video"/.test(ask2.join()) && (await live(C)));
  await C.getByLabel("Appearance").click();
  ok("the setting is in Appearance, and shows as on", await C.getByLabel("Turn the camera on when I start a call").isChecked());
  console.log(`\n${pass} passed, ${fail} failed`); await b.close();
})();
