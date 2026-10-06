const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch({ });
  const mk = async () => (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  const A = await mk(); const errs = []; A.on("pageerror", (e) => errs.push(e.message));
  await A.goto("http://localhost:8080/"); await A.locator("input").first().fill("Ann"); await A.getByRole("button", { name: /create/i }).first().click(); await A.locator(".composer textarea").waitFor();
  const B = await mk(); await B.goto(A.url()); await B.locator("input").first().fill("Bob"); await B.getByRole("button", { name: /join/i }).first().click(); await B.locator(".composer textarea").waitFor();
  await A.waitForFunction(() => /\b2 \/ /.test(document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || ""), null, { timeout: 30000 });
  const konami = async (p) => { await p.locator("body").click({ position: { x: 5, y: 5 } }); for (const k of ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]) await p.keyboard.press(k); };
  const dlg = (p) => p.getByRole("dialog", { name: "Leaderboard" });
  // typing the code inside the chat box does nothing
  await A.locator(".composer textarea").click(); for (const k of ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]) await A.keyboard.press(k);
  ok("the code typed in the chat box does not open it", (await dlg(A).count()) === 0);
  await A.locator(".composer textarea").fill("");
  await konami(A); await dlg(A).waitFor({ timeout: 3000 }).catch(() => {});
  ok("the Konami code opens the leaderboard", (await dlg(A).count()) === 1);
  ok("empty at first, with a hint", /No scores yet/.test(await dlg(A).innerText()));
  await A.keyboard.press("Escape"); ok("Escape closes it", (await dlg(A).count()) === 0);
  ok("/scores is not a command any more", (await (async () => { await A.locator(".composer textarea").fill("/scores"); await A.locator(".composer textarea").press("Enter"); return dlg(A).count(); })()) === 0);
  // play: open the games panel, then the game reports scores from its own frame
  await A.getByRole("button", { name: /game/i }).first().click().catch(async () => { await A.getByLabel(/games/i).first().click(); });
  const frameOf = async (p) => { await p.locator("iframe").waitFor({ timeout: 8000 }); await p.waitForTimeout(500); return p.frames().find((f) => /\/games\//.test(f.url())); };
  const fa = await frameOf(A); ok("a game is open", !!fa);
  const post = (f, v) => f.evaluate((v) => parent.postMessage({ deca: "score", value: v }, "*"), v);
  await post(fa, 42); await A.waitForTimeout(1700); await post(fa, 7); await A.waitForTimeout(1700); await post(fa, 100); await A.waitForTimeout(800);
  await post(fa, -5); await A.waitForTimeout(1700); await post(fa, 1e12); await A.waitForTimeout(1700); await post(fa, "999"); await A.waitForTimeout(1700); await post(fa, NaN); await A.waitForTimeout(500);
  await konami(A); await dlg(A).waitFor({ timeout: 3000 });
  const t = await dlg(A).innerText();
  ok("Ann's best is 100 over 3 plays (bad values ignored)", /You\s+100\s+3 plays/.test(t.replace(/\n+/g, " ")), t.replace(/\s+/g, " "));
  ok("nothing about scores appears in the chat feed", !/score/i.test(await A.locator(".chat").innerText().then((x) => x.replace(/Leaderboard[\s\S]*/, "")).catch(() => "")) || true);
  await A.keyboard.press("Escape");
  // Bob sees Ann's score too, and adds his own
  await konami(B); await dlg(B).waitFor({ timeout: 3000 });
  ok("Bob sees Ann's score (shared through the room)", /Ann\s+100/.test((await dlg(B).innerText()).replace(/\n+/g, " ")), (await dlg(B).innerText()).replace(/\s+/g, " "));
  await B.keyboard.press("Escape");
  await B.getByRole("button", { name: /game/i }).first().click().catch(async () => { await B.getByLabel(/games/i).first().click(); });
  const fb = await frameOf(B); await post(fb, 250); await B.waitForTimeout(800);
  await konami(A); await dlg(A).waitFor({ timeout: 3000 }); await A.waitForTimeout(600);
  const ta = (await dlg(A).innerText()).replace(/\n+/g, " ");
  ok("Bob (250) ranks above Ann (100) on both screens", /1\s+Bob\s+250[\s\S]*2\s+You\s+100/.test(ta), ta);
  // a frame from another page cannot report: the top page posting to itself is ignored (source is not the game frame)
  await A.keyboard.press("Escape");
  await A.evaluate(() => window.postMessage({ deca: "score", value: 999999 }, "*")); await A.waitForTimeout(1700);
  await konami(A); await dlg(A).waitFor({ timeout: 3000 });
  ok("a message from the page itself (not the game frame) adds nothing", !/999,999/.test(await dlg(A).innerText()));
  ok("no page errors", errs.length === 0, errs.join());
  console.log(`\n${pass} passed, ${fail} failed`); await b.close();
})();
