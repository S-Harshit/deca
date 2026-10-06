const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, acceptDownloads: true }); const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const create = async (pg, name) => { await pg.goto("http://localhost:8080/"); await pg.locator("input").first().fill(name); await pg.getByRole("button", { name: /create/i }).first().click(); await pg.locator(".composer textarea").waitFor(); };
  await create(p, "Ann");
  // ---- 1) replay does not outlive the room
  await p.getByLabel("YouTube link").fill("https://youtu.be/jNQXAC9IVRw"); await p.getByLabel("Add to queue").click(); await p.locator(".np-title").waitFor({ timeout: 15000 });
  await p.getByLabel("Next track").click(); await p.locator(".np-title").waitFor({ state: "detached" });
  ok("replay offered right after the track ended (same visit)", (await p.getByRole("button", { name: /^Replay/ }).count()) === 1);
  await p.getByRole("button", { name: /^Replay/ }).click(); await p.locator(".np-title").waitFor({ timeout: 15000 }); ok("replay works", true);
  await p.getByLabel("Next track").click(); await p.locator(".np-title").waitFor({ state: "detached" });
  await p.getByRole("button", { name: "Leave space" }).click(); await p.getByRole("button", { name: "Leave now" }).click();
  await p.locator("input").first().waitFor();
  await p.locator("input").first().fill("Ann"); await p.getByRole("button", { name: /create/i }).first().click(); await p.locator(".composer textarea").waitFor();
  ok("after leaving and creating a new room: no replay suggestion", (await p.getByRole("button", { name: /^Replay/ }).count()) === 0);
  const stored = await p.evaluate(() => Object.keys(localStorage).filter((k) => /track/i.test(k)));
  ok("nothing about tracks is saved on the device", stored.length === 0, stored.join());
  await p.reload(); await p.locator("input").first().fill("Ann"); await p.getByRole("button", { name: /create|join/i }).first().click(); await p.locator(".composer textarea").waitFor();
  ok("...nor after a reload", (await p.getByRole("button", { name: /^Replay/ }).count()) === 0);
  // ---- 7) empty code snippet
  const ta = p.locator(".composer textarea"), send = p.getByLabel("Send");
  await p.getByLabel("Insert code block").click();
  ok("code button inserts an empty fence", (await ta.inputValue()).includes("```"));
  ok("Send is disabled while the fence is empty", await send.isDisabled());
  const before = await p.locator(".timeline > .line").count();
  await ta.press("Enter"); await p.waitForTimeout(500);
  ok("Enter on an empty fence sends nothing", (await p.locator(".timeline > .line").count()) === before);
  ok("...and leaves the composer as it was (so you can type inside)", (await ta.inputValue()).includes("```"));
  await ta.fill("```\n   \n```"); ok("whitespace-only fence is also blank", await send.isDisabled());
  await ta.fill("```js\n\n```"); ok("empty fence with a language is blank", await send.isDisabled());
  await ta.fill("```\nlet a = 1\n```"); ok("a fence with code is sendable", await send.isEnabled());
  await ta.press("Enter"); await p.locator(".codeblock").waitFor({ timeout: 5000 }); ok("and renders as code", true);
  await ta.fill("hello\n```\n```"); ok("text plus an empty fence is sendable", await send.isEnabled());
  await ta.press("Enter"); await p.getByText("hello", { exact: true }).waitFor({ timeout: 5000 });
  ok("sent as just the text (no empty code box)", (await p.locator(".codeblock").count()) === 1);
  await ta.fill("```"); ok("an unclosed fence is plain text, so it can be sent", await send.isEnabled());
  await ta.fill(""); ok("empty composer: disabled", await send.isDisabled());
  // an empty-fence message from an older client is hidden
  // ---- 3) disabled option looks disabled
  await p.getByRole("button", { name: "Export", exact: true }).click(); await p.getByRole("dialog").waitFor();
  // (this room has no files)
  const box = p.getByLabel(/No files on this device/); const lab = p.locator("label.toggle", { has: box });
  const st = await lab.evaluate((e) => ({ opacity: getComputedStyle(e).opacity, cursor: getComputedStyle(e).cursor }));
  ok("a disabled option is dimmed and shows a not-allowed cursor", Number(st.opacity) <= 0.55 && st.cursor === "not-allowed", JSON.stringify(st));
  ok("...and the box really is disabled", await box.isDisabled());
  await p.keyboard.press("Escape");
  ok("no page errors", errs.length === 0, errs.join("|"));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.log("ERR", e.message.split("\n").slice(0, 6).join("\n")); process.exit(1); });
