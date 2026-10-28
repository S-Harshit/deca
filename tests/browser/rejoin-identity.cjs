// Coming back to a room on the same browser is the same person (not a second profile), and a new name renames them.
const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };

(async () => {
  const b = await chromium.launch();
  const hostCtx = await b.newContext({ viewport: { width: 1200, height: 800 } });
  const A = await hostCtx.newPage();
  await A.goto("http://localhost:8080/"); await A.locator("input").first().fill("Ann"); await A.getByRole("button", { name: /create/i }).first().click(); await A.locator(".composer textarea").waitFor();
  const link = A.url();
  const members = (p) => p.locator(".members li").allInnerTexts();
  const count = (p) => p.evaluate(() => /(\d+) \/ 8/.exec(document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || "")?.[1]);
  const say = async (p, t) => { await p.locator(".composer textarea").fill(t); await p.locator(".composer textarea").press("Enter"); await p.waitForTimeout(250); };
  const join = async (ctx, name) => { const p = await ctx.newPage(); await p.goto(link); await p.locator("input").first().fill(name); await p.getByRole("button", { name: /join/i }).first().click(); await p.locator(".composer textarea").waitFor(); return p; };

  const benCtx = await b.newContext({ viewport: { width: 1200, height: 800 } });
  const B1 = await join(benCtx, "Ben");
  await A.waitForFunction(() => /\b2 \/ /.test(document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || ""), null, { timeout: 30000 });
  await say(B1, "hello from Ben");
  await A.getByText("hello from Ben").waitFor({ timeout: 10000 });
  const idBefore = await B1.evaluate(() => JSON.parse(sessionStorage.getItem("deca.identity")).pub);

  // Ben closes the tab and opens the link again later, with a different name
  await B1.close();
  await A.getByText("Ben left").waitFor({ timeout: 20000 }).catch(() => {});
  const B2 = await join(benCtx, "Benjamin");
  await A.waitForFunction(() => /Benjamin/.test(document.querySelector(".members")?.innerText || ""), null, { timeout: 20000 });
  const idAfter = await B2.evaluate(() => JSON.parse(sessionStorage.getItem("deca.identity")).pub);
  ok("the same browser comes back as the same identity", idBefore === idAfter);
  const list = (await members(A)).join(" | ");
  ok("Ann sees two people, not three (no second profile for Ben)", (await count(A)) === "2", list);
  ok("and the old name is gone, renamed to the new one", /Benjamin/.test(list) && !/\bBen\b/.test(list.replace(/Benjamin/g, "")), list);
  ok("his earlier message now shows the new name too", (await A.locator(".line", { hasText: "hello from Ben" }).first().innerText()).includes("Benjamin"));
  ok("the feed says he came back (not joined as a stranger)", (await A.getByText(/Benjamin came back/).count()) >= 1);

  // two tabs of the same browser at once are two people
  const B3 = await join(benCtx, "Benji-second-tab");
  await A.waitForFunction(() => /Benji-second-tab/.test(document.querySelector(".members")?.innerText || ""), null, { timeout: 20000 });
  ok("a second tab open at the same time is a separate person, and does not kick the first", (await count(A)) === "3" && (await B2.locator(".composer textarea").isVisible()));
  const idThird = await B3.evaluate(() => JSON.parse(sessionStorage.getItem("deca.identity")).pub);
  ok("with its own identity", idThird !== idAfter);

  // a refresh is still you
  await B2.reload(); await B2.locator("input").first().fill("Benjamin"); await B2.getByRole("button", { name: /join/i }).first().click(); await B2.locator(".composer textarea").waitFor();
  ok("a refresh keeps the identity", (await B2.evaluate(() => JSON.parse(sessionStorage.getItem("deca.identity")).pub)) === idAfter);

  // another browser (separate storage) is a different person
  const other = await b.newContext({ viewport: { width: 1200, height: 800 } }); const D = await join(other, "Dee");
  ok("a different browser is a different identity", (await D.evaluate(() => JSON.parse(sessionStorage.getItem("deca.identity")).pub)) !== idAfter);

  // the remembered identity is per room, and limited
  const stored = await benCtx.pages()[0].evaluate(() => JSON.parse(localStorage.getItem("deca.rooms") || "{}"));
  ok("what is remembered is keyed by room and small", Object.keys(stored).length === 1 && Object.keys(stored)[0] === link.split("/s/")[1], Object.keys(stored).join());
  console.log(`\n${pass} passed, ${fail} failed`); await b.close();
})();
