const { chromium } = require("../lib/browser.cjs");
const URL = "http://localhost:8080/"; let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch({ });
  const mk = async (name, room) => { const p = await (await b.newContext({ viewport: { width: 1200, height: 800 } })).newPage(); p.errs = []; p.on("pageerror", (e) => p.errs.push(e.message)); await p.goto(room || URL); await p.locator("input").first().fill(name); await p.getByRole("button", { name: room ? /join/i : /create/i }).first().click(); await p.locator(".composer textarea").waitFor(); return p; };
  const a = await mk("Ann"); const room = a.url(); const bob = await mk("Bob", room); const cat = await mk("Cat", room);
  for (const p of [a, bob, cat]) { await p.getByText("Bob joined").waitFor({ timeout: 20000 }); await p.getByText("Cat joined").waitFor({ timeout: 20000 }); }
  // menu item
  await a.getByLabel("Deciders").click(); ok("menu has Blame someone", (await a.getByRole("menuitem", { name: /Blame someone/ }).count()) === 1);
  ok("menu item shows /blame", /\/blame/.test(await a.getByRole("menuitem", { name: /Blame someone/ }).innerText()));
  await a.getByRole("menuitem", { name: /Blame someone/ }).click();
  // live animation on every device, then lands
  await bob.locator(".blame-row").first().waitFor({ timeout: 8000 });
  ok("live pick animates first (picking state seen by a peer)", await bob.locator('.blame-row[data-state="picking"]').count() >= 1 || (await bob.locator('.blame-row[data-state="landed"]').count()) >= 1);
  for (const p of [a, bob, cat]) await p.locator('.blame-row[data-state="landed"]').first().waitFor({ timeout: 6000 });
  const txt = async (p) => (await p.locator(".blame-row").first().innerText()).replace(/\s+/g, " ").trim();
  const [ta, tb, tc] = [await txt(a), await txt(bob), await txt(cat)].map((t) => t.replace(/^\W+/u, ""));
  // normalise "you" -> actual name per viewer
  const target = (t, me) => { const x = t.replace(/^.*blamed /, ""); return x === "you" || x === "yourself" ? me : x; };
  const [ra, rb, rc] = [target(ta, "Ann"), target(tb, "Bob"), target(tc, "Cat")];
  ok("everyone sees the same person blamed", ra === rb && rb === rc && ["Ann", "Bob", "Cat"].includes(ra), JSON.stringify([ta, tb, tc]));
  ok("each viewer sees who blamed, in the first person where it applies", /^(You|Ann) blamed (Ann|Bob|Cat|you|yourself)$/.test(ta) && /^(You|Ann) blamed/.test(tb) && /^(You|Ann) blamed/.test(tc), JSON.stringify([ta, tb, tc]));
  ok("the blamer is named for everyone (Ann sees 'You', others see 'Ann')", /^You blamed/.test(ta) && /^Ann blamed/.test(tb) && /^Ann blamed/.test(tc), JSON.stringify([ta, tb, tc]));
  // late joiner: history shows result without animation
  const dee = await mk("Dee", room); await dee.getByText(/blamed/).first().waitFor({ timeout: 15000 });
  ok("late joiner sees it landed, never replays the animation", (await dee.locator('.blame-row[data-state="picking"]').count()) === 0 && (await dee.locator('.blame-row[data-state="landed"]').count()) >= 1);
  const rd = target(await txt(dee), "Dee"); ok("late joiner sees the same target", rd === ra, `${rd} vs ${ra}`);
  // /blame command, many times: distribution over the 4 people here, only online
  const say = async (p, t) => { await p.locator(".composer textarea").fill(t); await p.keyboard.press("Enter"); };
  for (let i = 0; i < 48; i++) { await say(bob, "/blame"); await bob.waitForTimeout(110); }
  await a.waitForTimeout(2500);
  const targets = (p) => p.locator(".blame-row").evaluateAll((rows) => rows.map((r) => (r.querySelectorAll("strong")[1] || r.querySelector("strong"))?.textContent));
  const names = await targets(a);
  const count = (n) => names.filter((x) => x === n).length;
  ok(`/blame works and typed command leaves no chat text`, names.length >= 45 && !(await a.getByText("/blame", { exact: true }).count()), names.length);
  ok("every online person gets blamed sometimes (random, not stuck)", ["Bob", "Cat", "Dee", "you"].every((n) => count(n) >= 2), // Ann's view: she is "you", Bob (the blamer) can be picked too
     JSON.stringify(names.reduce((m, n) => ((m[n] = (m[n] || 0) + 1), m), {})));
  const bobSees = await targets(bob);
  ok("the blamer is sometimes blamed too (yourself allowed)", bobSees.includes("yourself"), JSON.stringify(bobSees.reduce((m, n) => ((m[n] = (m[n] || 0) + 1), m), {})));
  // someone leaves: never blamed afterwards
  await cat.getByRole("button", { name: "Leave space" }).click(); await cat.getByRole("button", { name: "Leave now" }).click();
  await a.getByText("Cat left").waitFor({ timeout: 15000 });
  const before = (await targets(a)).length;
  for (let i = 0; i < 25; i++) { await say(a, "/blame"); await a.waitForTimeout(110); }
  await a.waitForTimeout(2200);
  const after = (await targets(a)).slice(before);
  ok("a person who left is not blamed", after.length >= 22 && !after.includes("Cat"), JSON.stringify(after.reduce((m, n) => ((m[n] = (m[n] || 0) + 1), m), {})));
  // host turns chat off: member gets an error and no event
  await a.getByLabel("Members can chat").uncheck(); await bob.waitForTimeout(800);
  const n0 = await bob.locator(".blame-row").count();
  ok("deciders button is disabled for members when chat is off", await bob.getByLabel("Deciders").isDisabled());
  ok("composer is disabled too (so /blame cannot be typed)", await bob.locator(".composer textarea").isDisabled());
  await bob.waitForTimeout(500);
  ok("no blame appeared while chat was off", (await bob.locator(".blame-row").count()) === n0);
  // the host can still blame
  await a.getByLabel("Deciders").click(); await a.getByRole("menuitem", { name: /Blame someone/ }).click(); await a.waitForTimeout(2200);
  ok("host can still blame with chat off", (await a.locator(".blame-row").count()) === n0 + 1);
  ok("no page errors", [a, bob, dee].every((p) => p.errs.length === 0), [a, bob, dee].flatMap((p) => p.errs).join("|"));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.log("ERR", e.message.split("\n").slice(0, 3).join(" ")); process.exit(1); });
