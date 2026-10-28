// "Share a file as a link": someone who is not in the room opens the link and the file downloads, straight from the sharer's browser.
const { chromium } = require("../lib/browser.cjs");
const crypto = require("node:crypto");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch();
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1300, height: 850 }, acceptDownloads: true }); const p = await c.newPage(); p.on("pageerror", (e) => console.log("pageerror", e.message)); return p; };
  const A = await mk();
  await A.goto("http://localhost:8080/"); await A.locator("input").first().fill("Ann"); await A.getByRole("button", { name: /create/i }).first().click(); await A.locator(".composer textarea").waitFor();
  const data = crypto.randomBytes(700 * 1024 + 123); // a few dozen chunks, not a multiple of the chunk size
  await A.getByRole("button", { name: "Add to the room" }).click();
  ok("the + menu offers to share a file as a link", (await A.getByRole("menuitem", { name: /Share a file as a link/ }).count()) === 1);
  await A.locator("input[data-drop-input]").setInputFiles({ name: "holiday photo (1).jpg", mimeType: "image/jpeg", buffer: data });
  const dlg = A.getByRole("dialog", { name: "Shared links" }); await dlg.waitFor();
  const link = await dlg.locator("code.link").innerText();
  ok("it gives a link of its own (not the room's)", /#\/d\/[A-Za-z0-9]{8,}$/.test(link) && !/#\/s\//.test(link), link);
  ok("and says who can get it and how long it lives", /only while this tab stays open/.test(await dlg.innerText()) && /nobody yet/.test(await dlg.innerText()));

  // someone who is not in the room opens the link
  const G = await mk();
  const [dl] = await Promise.all([G.waitForEvent("download", { timeout: 30000 }), G.goto(link)]);
  ok("the file downloads by itself, under its own name", dl.suggestedFilename() === "holiday photo (1).jpg", dl.suggestedFilename());
  const got = require("node:fs").readFileSync(await dl.path());
  ok("and every byte arrives intact", Buffer.compare(got, data) === 0, `${got.length} vs ${data.length}`);
  ok("the guest sees a plain page that says it was saved (and no chat, no room)", /Saved/.test(await G.locator("h1").innerText()) && (await G.locator(".composer").count()) === 0 && (await G.getByRole("button", { name: "Save again" }).count()) === 1);
  await A.waitForTimeout(800);
  ok("the sharer sees the download counted", /1 downloaded/.test(await dlg.innerText()), await dlg.innerText());
  ok("the guest is not in the room: the member list still shows one person", /\b1 \/ /.test(await A.locator(".members").first().locator("xpath=ancestor::section").locator("h3").first().innerText()));
  // two at once
  const G2 = await mk(), G3 = await mk();
  const dls = await Promise.all([G2.waitForEvent("download", { timeout: 30000 }), G3.waitForEvent("download", { timeout: 30000 }), G2.goto(link), G3.goto(link)]);
  const same = await Promise.all([dls[0], dls[1]].map(async (d) => Buffer.compare(require("node:fs").readFileSync(await d.path()), data) === 0));
  ok("two people can download at the same time", same.every(Boolean));
  // the + menu now lists the share, and Post in chat puts the link in the room
  await dlg.getByRole("button", { name: "Post in chat" }).click(); await A.waitForTimeout(400);
  ok("Post in chat sends the link into the room", (await A.locator(".timeline").innerText()).includes(link.slice(link.indexOf("#"))));
  // stop sharing: the link dies at once
  await dlg.getByRole("button", { name: "Stop sharing" }).click(); await A.waitForTimeout(500);
  ok("stopping removes it from the list", /Nothing is shared right now/.test(await dlg.innerText()));
  const G4 = await mk(); let late = 0; G4.on("download", () => late++); await G4.goto(link);
  await G4.getByText("Nobody is sharing this any more").waitFor({ timeout: 40000 });
  ok("a later visitor is told nobody is sharing it, and nothing downloads", late === 0);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
