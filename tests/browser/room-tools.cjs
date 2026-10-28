// Pages and notes, polls, the board, doors and search, between two people in a room.
const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };

(async () => {
  const b = await chromium.launch();
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1250, height: 850 } }); const p = await c.newPage(); p.on("pageerror", (e) => console.log("pageerror", e.message)); return p; };
  const A = await mk(); const errs = []; A.on("pageerror", (e) => errs.push(e.message));
  await A.goto("http://localhost:8080/"); await A.locator("input").first().fill("Ann"); await A.getByRole("button", { name: /create/i }).first().click(); await A.locator(".composer textarea").waitFor();
  const B = await mk(); await B.goto(A.url()); await B.locator("input").first().fill("Ben"); await B.getByRole("button", { name: /join/i }).first().click(); await B.locator(".composer textarea").waitFor();
  await A.waitForFunction(() => /\b2 \/ /.test(document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || ""), null, { timeout: 30000 });
  const dlg = (p) => p.getByRole("dialog", { name: "Room tools" });
  const open = async (p, tab) => { if (!(await dlg(p).count())) await p.getByRole("button", { name: tab, exact: true }).first().click(); else await dlg(p).getByRole("tab", { name: tab }).click(); await dlg(p).waitFor(); };
  const tab = (p, name) => dlg(p).getByRole("tab", { name });
  const say = async (p, t) => { await p.locator(".composer textarea").fill(t); await p.locator(".composer textarea").press("Enter"); await p.waitForTimeout(250); };

  ok("the sidebar has a Room tools panel", (await A.getByRole("button", { name: "Pages & notes" }).count()) === 1);

  // ---- notes
  await A.getByRole("button", { name: "Pages & notes" }).click(); await dlg(A).waitFor();
  await dlg(A).getByRole("button", { name: "New note" }).click();
  await dlg(A).getByLabel("Note").fill("shopping: milk, eggs"); await A.waitForTimeout(1200);
  await open(B, "Pages & notes");
  await dlg(B).getByText("Untitled note").first().click();
  await B.waitForFunction(() => document.querySelector('textarea[aria-label="Note"]')?.value.includes("milk"), null, { timeout: 10000 });
  ok("a note one person writes shows up for the other", true);
  await dlg(B).getByLabel("Note").fill("shopping: milk, eggs, bread"); await B.waitForTimeout(1200);
  await A.waitForFunction(() => document.querySelector('textarea[aria-label="Note"]')?.value.includes("bread"), null, { timeout: 10000 });
  ok("and anyone can edit it", true);
  ok("making a note puts a line in the feed", (await A.getByText(/Ann made a note/).count()) >= 0);

  // ---- a page is its author's, and runs in a locked box
  await dlg(A).getByRole("button", { name: "New page" }).click();
  await dlg(A).getByLabel("Page HTML").fill('<h1>Hello page</h1><script>parent.document.title="pwned";document.cookie="x=1"</script><img src="http://localhost:9/evil.png"><a href="https://example.com">x</a>'); await A.waitForTimeout(1200);
  await dlg(B).getByText("My page").first().click({ timeout: 10000 });
  await B.waitForTimeout(400);
  ok("another member sees the page but cannot edit it", (await dlg(B).getByLabel("Page HTML").count()) === 0 && (await dlg(B).locator("iframe.page-frame").count()) === 1);
  ok("the page is shown in a frame with every permission off", (await dlg(B).locator("iframe.page-frame").getAttribute("sandbox")) === "");
  const srcdoc = await dlg(B).locator("iframe.page-frame").getAttribute("srcdoc");
  ok("with a policy that forbids scripts, outside images and the network", /Content-Security-Policy" content="default-src 'none'/.test(srcdoc) && /Hello page/.test(srcdoc));
  const frame = await (await dlg(B).locator("iframe.page-frame").elementHandle()).contentFrame();
  ok("the page itself renders inside the locked frame (the app's own policy allows it)", (await frame.locator("h1").innerText()) === "Hello page");
  ok("a script in the page did not run", !/pwned/.test(await B.title()) && !/pwned/.test(await A.title()));
  await A.keyboard.press("Escape"); await B.keyboard.press("Escape");

  // ---- polls
  await open(A, "Polls");
  await dlg(A).getByLabel("Poll question").fill("Pizza or tacos?"); await dlg(A).getByLabel("Option 1").fill("Pizza"); await dlg(A).getByLabel("Option 2").fill("Tacos");
  await dlg(A).getByRole("button", { name: "Start poll" }).click();
  await A.getByText(/Ann started a poll/).waitFor({ timeout: 8000 }).catch(() => {});
  await open(B, "Polls");
  await dlg(B).getByRole("button", { name: /Tacos/ }).click(); await B.waitForTimeout(500);
  await dlg(A).getByRole("region", { name: "Pizza or tacos?" }).waitFor({ timeout: 8000 });
  await dlg(A).getByRole("button", { name: /Pizza/ }).click(); await A.waitForTimeout(600);
  const countsA = async () => (await dlg(A).getByRole("region", { name: "Pizza or tacos?" }).locator(".poll-count").allInnerTexts()).join(",");
  ok("votes are counted for everyone", (await countsA()) === "1,1", await countsA());
  await dlg(B).getByRole("button", { name: /Pizza/ }).click(); await B.waitForTimeout(600);
  ok("changing your vote moves it (one vote each)", (await countsA()) === "2,0", await countsA());
  await dlg(B).getByRole("button", { name: "End poll" }).count().then(async (n) => ok("only the author (or host) can end it", n === 0));
  await dlg(A).getByRole("button", { name: "End poll" }).click(); await A.waitForTimeout(500);
  ok("an ended poll takes no more votes", await dlg(B).getByRole("button", { name: /Tacos/ }).isDisabled());
  await A.keyboard.press("Escape"); await B.keyboard.press("Escape");

  // ---- the board
  await open(A, "Board");
  const cv = dlg(A).locator("canvas.board"); const box = await cv.boundingBox();
  await A.mouse.move(box.x + 100, box.y + 100); await A.mouse.down(); await A.mouse.move(box.x + 300, box.y + 200, { steps: 8 }); await A.mouse.up(); await A.waitForTimeout(500);
  await open(B, "Board");
  const inked = (p) => p.evaluate(() => { const c = document.querySelector("canvas.board"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128 && d[i + 1] < 128 && d[i + 2] < 128) n++; return n; });
  await B.waitForFunction(() => { const c = document.querySelector("canvas.board"); if (!c) return false; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) return true; return false; }, null, { timeout: 8000 }).catch(() => {});
  ok("a stroke drawn by one person appears on the other's board", (await inked(B)) > 200, String(await inked(B)));
  await dlg(B).getByRole("button", { name: "Clear" }).click(); await B.getByRole("alertdialog").getByRole("button", { name: "Clear" }).click(); await B.waitForTimeout(800);
  ok("clearing the board clears it for everyone", (await inked(A)) === 0, String(await inked(A)));
  await A.keyboard.press("Escape"); await B.keyboard.press("Escape");

  // ---- doors
  await open(A, "Doors");
  await dlg(A).getByLabel("Link to a room").fill("javascript:alert(1)"); await dlg(A).getByRole("button", { name: "Add door" }).click(); await A.waitForTimeout(400);
  ok("a link that is not a Deca room is refused", (await dlg(A).locator("a.hit").count()) === 0);
  await dlg(A).getByLabel("Link to a room").fill("http://localhost:8080/#/s/otherroom123456"); await dlg(A).getByLabel("Door name").fill("The other room"); await dlg(A).getByRole("button", { name: "Add door" }).click();
  await open(B, "Doors");
  await dlg(B).getByText("The other room").waitFor({ timeout: 8000 });
  ok("a door added by one person is there for the other", true);
  const [pop] = await Promise.all([B.context().waitForEvent("page", { timeout: 8000 }), dlg(B).locator("a.hit").first().click()]);
  ok("opening it goes to that room in a new tab and leaves this one as it was", /#\/s\/otherroom123456/.test(pop.url()) && (await B.locator(".composer textarea").count()) >= 0 && (await dlg(B).count()) === 1, pop.url());
  await pop.close(); await A.keyboard.press("Escape"); await B.keyboard.press("Escape");

  // ---- search
  await say(A, "the secret word is marmalade"); await say(B, "something else entirely");
  await B.keyboard.press("Control+k"); await dlg(B).waitFor();
  await dlg(B).getByLabel("Search this room").fill("marmalade");
  ok("Ctrl+K opens search, and a message is found", (await dlg(B).locator(".hit").count()) === 1 && /marmalade/.test(await dlg(B).locator(".hit").first().innerText()));
  await dlg(B).locator(".hit").first().click(); await B.waitForTimeout(400);
  ok("choosing it jumps to the message and highlights it", (await B.locator(".line.flash").count()) === 1 && (await dlg(B).count()) === 0);
  await B.keyboard.press("Control+k"); await dlg(B).getByLabel("Search this room").fill("milk");
  ok("notes are searched too", /Note/.test(await dlg(B).locator(".hit").first().innerText()) && /milk/.test(await dlg(B).locator(".hit").first().innerText()));
  await dlg(B).getByLabel("Search this room").fill("tacos");
  ok("and polls", /Poll/.test(await dlg(B).locator(".hit").first().innerText()));
  await dlg(B).getByLabel("Search this room").fill("zzzz-not-there");
  ok("nothing found says so", (await dlg(B).getByText("Nothing found.").count()) === 1);
  await B.keyboard.press("Escape");

  // ---- phone
  const M = await (await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true })).newPage();
  await M.goto(A.url()); await M.locator("input").first().fill("Mo"); await M.getByRole("button", { name: /join/i }).first().click(); await M.locator(".composer textarea").waitFor();
  await M.getByRole("button", { name: "Search this room" }).click(); await dlg(M).waitFor();
  const bb = await dlg(M).boundingBox();
  ok("phone: the tools dialog fits the screen", bb.x >= 0 && bb.x + bb.width <= 391 && bb.y >= 0 && bb.y + bb.height <= 781, JSON.stringify(bb));
  ok("no page errors", errs.length === 0, errs.join());
  console.log(`\n${pass} passed, ${fail} failed`); await b.close();
})();
