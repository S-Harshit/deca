const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch({ });
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1300, height: 900 } }); await c.clock.install({ time: new Date() }); return c.newPage(); };
  const A = await mk(); const errs = []; A.on("pageerror", (e) => errs.push(e.message));
  await A.goto("http://localhost:8080/"); await A.locator("input").first().fill("Ann"); await A.getByRole("button", { name: /create/i }).first().click(); await A.locator(".composer textarea").waitFor();
  const B = await mk(); await B.goto(A.url()); await B.locator("input").first().fill("Bob"); await B.getByRole("button", { name: /join/i }).first().click(); await B.locator(".composer textarea").waitFor();
  await A.waitForFunction(() => /\b2 \/ /.test(document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || ""), null, { timeout: 30000 });
  const timerBox = A.getByLabel("End this room after a set time"), sumBox = A.getByLabel("Show a summary when the room ends");
  ok("both options are off by default", !(await timerBox.isChecked()) && !(await sumBox.isChecked()));
  ok("no countdown and no end line yet", (await A.getByRole("timer", { name: "Time left in this room" }).count()) === 0 && (await B.getByRole("timer", { name: "Time left in this room" }).count()) === 0);
  ok("only the host sees the options", (await B.getByLabel("End this room after a set time").count()) === 0);
  const say = async (p, t) => { await p.locator(".composer textarea").fill(t); await p.locator(".composer textarea").press("Enter"); };
  await say(A, "Agenda: budget review"); await say(B, "Numbers are in the sheet"); await say(A, "Thanks, decision by Friday");
  await sumBox.check(); await A.locator('select[aria-label="How long the room lasts"]').selectOption("5"); await timerBox.check();
  await B.getByRole("timer", { name: "Time left in this room" }).waitFor({ timeout: 8000 });
  const pill = await B.getByRole("timer", { name: "Time left in this room" }).innerText();
  ok("everyone sees the countdown (about 5 minutes)", /ends in [45]:\d\d/.test(pill), pill);
  ok("the host sees an Add 15 min button", (await A.getByRole("button", { name: "Add 15 min" }).count()) === 1);
  await A.getByRole("button", { name: "Add 15 min" }).click(); await A.waitForTimeout(500);
  const pill2 = await B.getByRole("timer", { name: "Time left in this room" }).innerText();
  ok("adding time extends it for everyone (about 20 minutes)", /ends in 19:5\d|ends in 20:00/.test(pill2), pill2);
  // turn it off then on again, then jump to the end
  await timerBox.uncheck(); await B.waitForFunction(() => !document.querySelector('[aria-label="Time left in this room"]'), null, { timeout: 5000 });
  ok("turning it off removes the countdown", true);
  await A.locator('select[aria-label="How long the room lasts"]').selectOption("5"); await timerBox.check(); await B.getByRole("timer", { name: "Time left in this room" }).waitFor({ timeout: 5000 });
  // a game score for the summary
  await A.getByRole("button", { name: /game/i }).first().click().catch(() => {}); await A.locator("iframe").waitFor({ timeout: 8000 }).catch(() => {}); await A.waitForTimeout(600);
  const fr = A.frames().find((f) => /\/games\//.test(f.url())); if (fr) await fr.evaluate(() => parent.postMessage({ deca: "score", value: 77 }, "*")); await A.waitForTimeout(500);
  await A.clock.fastForward("05:10"); await B.clock.fastForward("05:10");
  await A.getByRole("heading", { name: "Time's up" }).waitFor({ timeout: 10000 }).catch(() => {}); await B.getByRole("heading", { name: "Time's up" }).waitFor({ timeout: 10000 }).catch(() => {});
  ok("the host's screen says time is up", (await A.getByRole("heading", { name: "Time's up" }).count()) === 1);
  ok("and so does the member's", (await B.getByRole("heading", { name: "Time's up" }).count()) === 1);
  for (const [n, p] of [["host", A], ["member", B]]) {
    const t = (await p.locator(".summary").innerText().catch(() => "")).replace(/\n+/g, " | ");
    ok(n + " sees the summary with people and message count", /2 \| people/i.test(t) && /3 \| messages/i.test(t), t);
    ok(n + " sees the game score", /77/.test(t), t);
  }
  await A.screenshot({ path: "summary-desktop.png" });
  const card = await A.locator(".hero.ended").boundingBox();
  ok("desktop: the end card fits the window and is wider than before", card.width > 500 && card.width <= 1300 && card.y >= 0 && card.y + card.height <= 900 + 1, JSON.stringify(card));
  ok("desktop: three stat tiles in a row", (await A.locator(".summary .stat").count()) === 3 && (async () => true)());
  const st = await A.locator(".summary .stat").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  ok("desktop: the stat tiles sit on one row", new Set(st).size === 1, st.join());
  ok("no page errors", errs.length === 0, errs.join());
  await b.close();
  // summary off: closing shows no summary
  const b2 = await chromium.launch({ }); const c2 = await b2.newContext({ viewport: { width: 1300, height: 900 } }); const H = await c2.newPage();
  await H.goto("http://localhost:8080/"); await H.locator("input").first().fill("Hal"); await H.getByRole("button", { name: /create/i }).first().click(); await H.locator(".composer textarea").waitFor();
  await H.getByRole("button", { name: "Close space" }).click(); await H.getByRole("button", { name: "Close for everyone" }).click();
  await H.getByRole("heading", { name: "Space closed" }).waitFor({ timeout: 8000 });
  ok("closing normally, summary off: plain end screen", (await H.locator(".summary").count()) === 0);
  await b2.close();
  const b3 = await chromium.launch({ }); const P = await (await b3.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true })).newPage();
  await P.goto("http://localhost:8080/"); await P.locator("input").first().fill("Pia"); await P.getByRole("button", { name: /create/i }).first().click(); await P.locator(".composer textarea").waitFor();
  await P.getByRole("button", { name: "Members", exact: true }).click(); await P.getByLabel("Show a summary when the room ends").check();
  await P.getByRole("button", { name: "Close space" }).click(); await P.getByRole("button", { name: "Close for everyone" }).click();
  await P.locator(".summary").waitFor({ timeout: 8000 });
  await P.screenshot({ path: "summary-phone.png" });
  const over = await P.evaluate(() => document.documentElement.scrollWidth - innerWidth); const pc = await P.locator(".hero.ended").boundingBox();
  ok("phone: no sideways scroll and the card fits", over <= 0 && pc.x >= 0 && pc.x + pc.width <= 391, over + " " + JSON.stringify(pc));
  console.log(`\n${pass} passed, ${fail} failed`); await b3.close();
})();
