// The workspace (notes with paragraph-level merging, pages, polls, a board), the cards and commands that bring it into the chat,
// and search, between two people in a room.
const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };

(async () => {
  const b = await chromium.launch();
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1300, height: 850 } }); const p = await c.newPage(); p.on("pageerror", (e) => console.log("pageerror", e.message)); return p; };
  const A = await mk(); const errs = []; A.on("pageerror", (e) => errs.push(e.message));
  await A.goto("http://localhost:8080/"); await A.locator("input").first().fill("Ann"); await A.getByRole("button", { name: /create/i }).first().click(); await A.locator(".composer textarea").waitFor();
  const B = await mk(); await B.goto(A.url()); await B.locator("input").first().fill("Ben"); await B.getByRole("button", { name: /join/i }).first().click(); await B.locator(".composer textarea").waitFor();
  await A.waitForFunction(() => /\b2 \/ /.test(document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || ""), null, { timeout: 30000 });
  const say = async (p, t) => { await p.locator(".composer textarea").fill(t); await p.locator(".composer textarea").press("Enter"); await p.waitForTimeout(300); };
  const ws = (p) => p.getByRole("complementary", { name: "Workspace" });
  const paras = (p) => p.locator('textarea[aria-label^="Paragraph"]').evaluateAll((els) => els.map((e) => e.value));

  // ---- polls, from the chat
  await say(A, "/poll Pizza or tacos? | Pizza | Tacos");
  const card = (p) => p.locator(".poll-card", { hasText: "Pizza or tacos?" });
  await card(B).waitFor({ timeout: 10000 });
  ok("/poll puts a poll straight into the chat for everyone", (await card(A).count()) === 1 && (await card(B).count()) === 1);
  ok("it needed no dialog (the chat is still all there)", (await ws(A).count()) === 0);
  await card(B).getByRole("button", { name: /Tacos/ }).click(); await B.waitForTimeout(400);
  await card(A).getByRole("button", { name: /Pizza/ }).click(); await A.waitForTimeout(500);
  const counts = async (p) => (await card(p).locator(".poll-count").allInnerTexts()).join(",");
  ok("votes are counted in the feed for both", (await counts(A)) === "1,1" && (await counts(B)) === "1,1", (await counts(A)) + " / " + (await counts(B)));
  await card(B).getByRole("button", { name: /Pizza/ }).click(); await B.waitForTimeout(500);
  ok("changing your vote moves it (one vote each)", (await counts(A)) === "2,0", await counts(A));
  ok("only the author (or host) can end it", (await card(B).getByRole("button", { name: "End poll" }).count()) === 0 && (await card(A).getByRole("button", { name: "End poll" }).count()) === 1);
  await card(A).getByRole("button", { name: "End poll" }).click(); await A.waitForTimeout(500);
  ok("an ended poll takes no more votes", await card(B).getByRole("button", { name: /Tacos/ }).isDisabled());
  await say(A, "/poll only one option"); ok("a poll with fewer than two options is refused with help", (await A.getByText(/at least two options/i).count()) >= 1);

  // ---- notes: the pane beside the chat
  await say(A, "/note");
  await ws(A).waitFor({ timeout: 8000 });
  ok("/note makes a note and opens the workspace NEXT to the chat", (await ws(A).count()) === 1 && (await A.locator(".composer textarea").isVisible()));
  const wb = await ws(A).boundingBox(); const cb = await A.locator(".chat").boundingBox();
  ok("the chat and the workspace sit side by side", cb.x + cb.width <= wb.x + 2 && wb.width > 300, JSON.stringify([cb, wb]));
  await A.locator('textarea[aria-label="Paragraph 1"]').fill("Shopping list"); await A.keyboard.press("Enter"); await A.keyboard.type("milk"); await A.keyboard.press("Enter"); await A.keyboard.type("eggs"); await A.waitForTimeout(1200);
  ok("Enter starts a new paragraph", JSON.stringify(await paras(A)) === JSON.stringify(["Shopping list", "milk", "eggs"]), JSON.stringify(await paras(A)));
  await B.locator(".doc-card", { hasText: "Untitled note" }).getByRole("button", { name: "Open" }).click();
  await B.waitForFunction(() => document.querySelectorAll('textarea[aria-label^="Paragraph"]').length === 3, null, { timeout: 10000 });
  ok("the note card in the chat opens it for the other person, paragraphs and all", JSON.stringify(await paras(B)) === JSON.stringify(["Shopping list", "milk", "eggs"]), JSON.stringify(await paras(B)));
  ok("it is open beside their chat too", (await ws(B).count()) === 1 && (await B.locator(".composer textarea").isVisible()));

  // ---- two people editing at the same moment
  await Promise.all([A.locator('textarea[aria-label="Paragraph 2"]').fill("milk (2 litres)"), B.locator('textarea[aria-label="Paragraph 3"]').fill("eggs (a dozen)")]);
  await A.waitForTimeout(1800);
  const same = async () => JSON.stringify(await paras(A)) === JSON.stringify(await paras(B));
  ok("edits in DIFFERENT paragraphs at the same time both survive, on both screens", (await same()) && (await paras(A))[1] === "milk (2 litres)" && (await paras(A))[2] === "eggs (a dozen)", JSON.stringify([await paras(A), await paras(B)]));
  // both add a new paragraph at the end at the same moment
  await Promise.all([
    (async () => { const t = A.locator('textarea[aria-label="Paragraph 3"]'); await t.click(); await A.keyboard.press("End"); await A.keyboard.press("Enter"); await A.keyboard.type("bread from Ann"); })(),
    (async () => { const t = B.locator('textarea[aria-label="Paragraph 3"]'); await t.click(); await B.keyboard.press("End"); await B.keyboard.press("Enter"); await B.keyboard.type("jam from Ben"); })(),
  ]);
  await A.waitForTimeout(2200);
  const final = await paras(A);
  ok("two paragraphs added at once both appear, in the same order for both people", (await same()) && final.some((p) => p === "bread from Ann") && final.some((p) => p === "jam from Ben"), JSON.stringify([final, await paras(B)]));
  // the very same paragraph at the same time: one wins, both end identical, nothing else is touched
  await Promise.all([A.locator('textarea[aria-label="Paragraph 1"]').fill("Groceries (Ann)"), B.locator('textarea[aria-label="Paragraph 1"]').fill("Groceries (Ben)")]);
  await A.waitForTimeout(2200);
  const conflict = await paras(A);
  ok("the SAME paragraph edited at once: one version wins and both screens agree", (await same()) && /^Groceries \((Ann|Ben)\)$/.test(conflict[0]), JSON.stringify([conflict, await paras(B)]));
  ok("and nothing else in the note was disturbed", conflict.includes("milk (2 litres)") && conflict.includes("eggs (a dozen)") && conflict.includes("jam from Ben"));
  // backspace joins paragraphs
  const before = (await paras(A)).length;
  const last = A.locator(`textarea[aria-label="Paragraph ${before}"]`); await last.click(); await A.keyboard.press("Home"); await A.keyboard.press("Backspace"); await A.waitForTimeout(1500);
  ok("Backspace at the start of a paragraph joins it to the one above, for everyone", (await paras(A)).length === before - 1 && (await same()), JSON.stringify([await paras(A), await paras(B)]));

  // ---- a page is its author's, shown in a locked box
  await A.getByRole("button", { name: "+ Page" }).click();
  await A.getByLabel("Page HTML").fill('<h1>Hello page</h1><script>parent.document.title="pwned"</script><img src="http://localhost:9/evil.png">'); await A.waitForTimeout(1300);
  await B.getByRole("button", { name: /My page/ }).first().click({ timeout: 10000 }); await B.waitForTimeout(500);
  ok("another member sees the page but cannot edit it", (await B.getByLabel("Page HTML").count()) === 0 && (await B.locator("iframe.page-frame").count()) === 1);
  ok("it is shown in a frame with every permission off and a policy forbidding scripts and outside loads", (await B.locator("iframe.page-frame").getAttribute("sandbox")) === "" && /default-src 'none'/.test((await B.locator("iframe.page-frame").getAttribute("srcdoc")) ?? ""));
  const frame = await (await B.locator("iframe.page-frame").elementHandle()).contentFrame();
  ok("the page renders, and its script did not run", (await frame.locator("h1").innerText()) === "Hello page" && !/pwned/.test(await B.title()) && !/pwned/.test(await A.title()));

  // ---- the board
  await A.getByRole("tab", { name: "Board" }).click(); await B.getByRole("tab", { name: "Board" }).click();
  const cv = A.locator("canvas.board"); const box = await cv.boundingBox();
  await A.mouse.move(box.x + 100, box.y + 100); await A.mouse.down(); await A.mouse.move(box.x + 300, box.y + 200, { steps: 8 }); await A.mouse.up();
  const inked = (p) => p.evaluate(() => { const c = document.querySelector("canvas.board"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128 && d[i + 1] < 128 && d[i + 2] < 128) n++; return n; });
  await B.waitForFunction(() => { const c = document.querySelector("canvas.board"); if (!c) return false; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) return true; return false; }, null, { timeout: 8000 }).catch(() => {});
  ok("a stroke drawn by one person appears on the other's board", (await inked(B)) > 200, String(await inked(B)));
  await B.getByRole("button", { name: "Clear" }).click(); await B.getByRole("alertdialog").getByRole("button", { name: "Clear" }).click(); await B.waitForTimeout(800);
  ok("clearing the board clears it for everyone", (await inked(A)) === 0);
  await A.keyboard.press("Escape"); await B.keyboard.press("Escape");
  ok("Escape closes the workspace", (await ws(A).count()) === 0);

  // ---- the + menu and the sidebar
  await A.getByRole("button", { name: "Add to the room" }).click();
  ok("the + menu in the composer offers note, page, poll, whiteboard and search", (await A.getByRole("menuitem").allInnerTexts()).join("|").match(/note.*page.*poll.*whiteboard.*search/is) !== null);
  await A.getByRole("menuitem", { name: /Whiteboard/ }).click();
  ok("choosing Whiteboard opens it beside the chat", (await ws(A).getByRole("tab", { name: "Board", selected: true }).count()) === 1);
  await A.keyboard.press("Escape");
  ok("there is no Doors tool any more", (await A.getByText("Doors", { exact: true }).count()) === 0);

  // ---- search
  await say(A, "the secret word is marmalade");
  await B.keyboard.press("Control+k");
  const pal = B.getByRole("dialog", { name: "Search this room" }); await pal.waitFor();
  await pal.getByLabel("Search this room").fill("marmalade");
  ok("Ctrl+K opens search, and a message is found", (await pal.locator(".hit").count()) === 1);
  await pal.locator(".hit").first().click(); await B.waitForTimeout(400);
  ok("choosing it jumps to the message and highlights it", (await B.locator(".line.flash").count()) === 1 && (await pal.count()) === 0);
  await B.keyboard.press("Control+k"); await pal.getByLabel("Search this room").fill("jam");
  ok("notes are searched paragraph by paragraph", /Note/.test(await pal.locator(".hit").first().innerText()));
  await pal.getByLabel("Search this room").fill("tacos"); ok("and polls", /Poll/.test(await pal.locator(".hit").first().innerText()));
  await pal.getByLabel("Search this room").fill("zzzz-not-there"); ok("nothing found says so", (await pal.getByText("Nothing found.").count()) === 1);
  const sb = await pal.getByLabel("Search this room").evaluate((e) => getComputedStyle(e).textAlign); ok("the search text is left-aligned", sb === "left" || sb === "start", sb);
  await B.keyboard.press("Escape");

  // ---- phone
  const M = await (await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true })).newPage();
  await M.goto(A.url()); await M.locator("input").first().fill("Mo"); await M.getByRole("button", { name: /join/i }).first().click(); await M.locator(".composer textarea").waitFor();
  await M.getByRole("button", { name: "Add to the room" }).click(); await M.getByRole("menuitem", { name: /Poll/ }).click();
  const mb = await ws(M).boundingBox();
  ok("phone: the workspace is a full-screen sheet that fits", mb.x >= 0 && mb.x + mb.width <= 391 && mb.y >= 0 && mb.y + mb.height <= 781, JSON.stringify(mb));
  ok("phone: no sideways scroll", (await M.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
  ok("no page errors", errs.length === 0, errs.join());
  console.log(`\n${pass} passed, ${fail} failed`); await b.close();
})();
