// The workspace (notes everyone types in at once, polls, a board), the cards and commands that bring it into the chat,
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
  const note = (p) => p.locator('textarea[aria-label="Note"]');
  const text = (p) => note(p).inputValue();

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
  await note(A).fill("Shopping list\nmilk\neggs");
  await B.locator(".doc-card", { hasText: "Untitled note" }).getByRole("button", { name: "Open" }).click();
  await B.waitForFunction(() => document.querySelector('textarea[aria-label="Note"]')?.value.includes("eggs"), null, { timeout: 10000 });
  ok("the note card in the chat opens it for the other person, text and all", (await text(B)) === "Shopping list\nmilk\neggs", await text(B));
  ok("it is open beside their chat too", (await ws(B).count()) === 1 && (await B.locator(".composer textarea").isVisible()));

  // ---- two people editing at the same moment
  const type = async (p, where, s) => { await note(p).evaluate((el, w) => { el.focus(); const i = w === "start" ? 0 : el.value.length; el.setSelectionRange(i, i); }, where); await p.keyboard.type(s, { delay: 20 }); };
  await Promise.all([type(A, "start", "[Ann] "), type(B, "end", " [Ben]")]);
  await A.waitForTimeout(1500);
  ok("typing at the start and at the end at the same moment: both survive, and both screens agree", (await text(A)) === (await text(B)) && (await text(A)) === "[Ann] Shopping list\nmilk\neggs [Ben]", JSON.stringify([await text(A), await text(B)]));
  // both type in the very same place, at the same time
  await Promise.all([type(A, "start", "AAAA"), type(B, "start", "BBBB")]);
  await A.waitForTimeout(1800);
  const both = await text(A);
  const count = (s, ch) => s.split(ch).length - 1;
  ok("two people typing in the SAME spot keep every character, and end with identical text", both === (await text(B)) && count(both, "A") >= 4 + 1 && count(both, "B") >= 4 + 1 && both.includes("Shopping list") && both.endsWith("[Ben]"), JSON.stringify([both, await text(B)]));
  // a long burst from both sides at once
  const na = count(await text(A), "a"), nb = count(await text(A), "b");
  await Promise.all([type(A, "end", "a".repeat(60)), type(B, "end", "b".repeat(60))]);
  await A.waitForTimeout(2200);
  const burst = await text(A);
  ok("a burst from both people at once converges with nothing lost", burst === (await text(B)) && count(burst, "a") === na + 60 && count(burst, "b") === nb + 60, [count(burst, "a") - na, count(burst, "b") - nb].join("/"));
  await A.evaluate(() => { const el = document.querySelector('textarea[aria-label="Note"]'); el.focus(); el.setSelectionRange(8, 8); });
  await type(B, "start", "XYZ"); await A.waitForTimeout(1200);
  ok("when someone types before your caret, it moves with the text instead of jumping", (await A.evaluate(() => document.querySelector('textarea[aria-label="Note"]').selectionStart)) === 11);

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
  ok("the + menu in the composer offers note, poll, whiteboard and search (and no page)", (await A.getByRole("menuitem").allInnerTexts()).join("|").match(/note.*poll.*whiteboard.*search/is) !== null && !/page/i.test((await A.getByRole("menuitem").allInnerTexts()).join("|")));
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
  await B.keyboard.press("Control+k"); await pal.getByLabel("Search this room").fill("Shopping");
  ok("notes are searched by their live text", /Note/.test(await pal.locator(".hit").first().innerText()));
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
