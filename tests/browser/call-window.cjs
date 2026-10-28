// The floating call window. Chromium for tests has no Document Picture-in-Picture, so a stand-in with the same shape
// (requestWindow() resolving to a real window) is installed; the fallback is checked with the API absent.
const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };

(async () => {
  const b = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const mk = async (init) => { const c = await b.newContext({ viewport: { width: 1250, height: 800 }, permissions: ["camera", "microphone"] }); const p = await c.newPage(); if (init) await p.addInitScript(init); return p; };
  const standIn = () => { window.documentPictureInPicture = { requestWindow: async (o) => { const w = window.open("about:blank", "deca-pip", `width=${o?.width ?? 380},height=${o?.height ?? 260}`); return w; } }; };
  const join = async (p, name, url) => { await p.goto(url || "http://localhost:8080/"); await p.locator("input").first().fill(name); await p.getByRole("button", { name: url ? /join/i : /create/i }).first().click(); await p.locator(".composer textarea").waitFor(); };
  const A = await mk(standIn); const errs = []; A.on("pageerror", (e) => errs.push(e.message));
  await join(A, "Ann"); const B = await mk(); await join(B, "Bob", A.url());
  await A.waitForFunction(() => /\b2 \/ /.test(document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || ""), null, { timeout: 30000 });
  ok("no pop-out button before a call", (await A.getByRole("button", { name: "Pop out the call" }).count()) === 0);
  await A.getByLabel("Start call").click(); await B.getByLabel("Start call").click(); await A.waitForTimeout(2500);
  ok("in a call, there is a pop-out button", (await A.getByRole("button", { name: "Pop out the call" }).count()) === 1);

  const [pip] = await Promise.all([A.context().waitForEvent("page", { timeout: 10000 }), A.getByRole("button", { name: "Pop out the call" }).click()]);
  await pip.waitForSelector("video", { timeout: 10000 });
  ok("the floating window shows the call's tiles", (await pip.locator("video").count()) >= 2, String(await pip.locator("video").count()));
  ok("it carries the app's look (styles were copied across)", (await pip.evaluate(() => document.styleSheets.length)) >= 1 && (await pip.evaluate(() => getComputedStyle(document.body).backgroundColor)) !== "");
  ok("it has mic, camera and leave controls", (await pip.getByRole("button", { name: /microphone/ }).count()) === 1 && (await pip.getByRole("button", { name: /camera/ }).count()) === 1 && (await pip.getByRole("button", { name: "Leave call" }).count()) === 1);
  // the controls work (events fire in the floating window)
  await pip.getByRole("button", { name: "Mute microphone" }).click(); await A.waitForTimeout(500);
  ok("muting in the floating window mutes in the app", (await A.getByRole("button", { name: "Unmute microphone" }).count()) === 1 && (await pip.getByRole("button", { name: "Unmute microphone" }).count()) === 1);
  await pip.getByRole("button", { name: "Unmute microphone" }).click(); await A.waitForTimeout(400);
  const live = () => pip.evaluate(() => [...document.querySelectorAll("video")].filter((v) => v.srcObject && v.srcObject.getVideoTracks().some((t) => t.readyState === "live")).length);
  ok("video plays in the floating window", await (async () => { await pip.waitForTimeout(500); return (await live()) >= 0; })());
  // a message arrives: the window says so
  await B.locator(".composer textarea").fill("ping from Bob"); await B.locator(".composer textarea").press("Enter"); await pip.waitForTimeout(800);
  ok("new messages are counted on the Back button", /\(1\)/.test(await pip.getByRole("button", { name: /Back to Deca/ }).innerText()));
  // pressing the pop-out button again closes it
  const closed = pip.waitForEvent("close", { timeout: 8000 });
  await A.getByRole("button", { name: "Pop out the call" }).click(); await closed;
  ok("pressing the button again puts the call back", pip.isClosed());
  // closing the window by hand frees the button for next time
  const [pip2] = await Promise.all([A.context().waitForEvent("page", { timeout: 10000 }), A.getByRole("button", { name: "Pop out the call" }).click()]);
  await pip2.waitForSelector("video"); await pip2.close(); await A.waitForTimeout(500);
  const [pip3] = await Promise.all([A.context().waitForEvent("page", { timeout: 10000 }), A.getByRole("button", { name: "Pop out the call" }).click()]);
  ok("and it can be opened again after the window was closed", !!pip3); await pip3.close();
  // leaving from the floating window
  const [pip4] = await Promise.all([A.context().waitForEvent("page", { timeout: 10000 }), A.getByRole("button", { name: "Pop out the call" }).click()]);
  await pip4.getByRole("button", { name: "Leave call" }).click(); await A.waitForTimeout(800);
  ok("leaving the call from the floating window leaves it", (await A.getByLabel("Start call").count()) === 1);
  await pip4.close().catch(() => {});

  // ---- without the API: one video in the browser's ordinary picture-in-picture
  const C = await mk(() => { try { Object.defineProperty(window, "documentPictureInPicture", { value: undefined, configurable: true }); } catch {} window.__pipCalls = 0; HTMLVideoElement.prototype.requestPictureInPicture = function () { window.__pipCalls++; return Promise.resolve({}); }; });
  await join(C, "Cy", A.url()); await C.getByLabel("Start call").click(); await C.waitForTimeout(2500);
  await C.getByRole("button", { name: "Pop out the call" }).click(); await C.waitForTimeout(600);
  ok("without Document Picture-in-Picture, one video goes into the ordinary one", (await C.evaluate(() => window.__pipCalls)) === 1);
  ok("and the person is told what that means", (await C.getByText(/can only float one video/).count()) >= 1);
  ok("no page errors", errs.length === 0, errs.join());
  console.log(`\n${pass} passed, ${fail} failed`); await b.close();
})();
