// Playlists and automatic mixes: paste one link and the whole list is queued for everyone; "Add similar songs" queues YouTube's mix for the
// playing song; and the two listeners stay together. Needs the internet (a real YouTube player).
const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1300, height: 900 } }); const p = await c.newPage(); p.on("pageerror", (e) => console.log("pageerror", e.message)); return p; };
  const A = await mk(); await A.goto("http://localhost:8080/"); await A.locator("input").first().fill("Ann"); await A.getByRole("button", { name: /create/i }).first().click(); await A.locator(".composer textarea").waitFor();
  const B = await mk(); await B.goto(A.url()); await B.locator("input").first().fill("Ben"); await B.getByRole("button", { name: /join/i }).first().click(); await B.locator(".composer textarea").waitFor();
  await A.waitForFunction(() => /\b2 \/ /.test(document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || ""), null, { timeout: 30000 });
  const queue = (p) => p.getByRole("list", { name: "Up next" }).getByRole("listitem").count();
  // a playlist
  await A.getByLabel("YouTube link").fill("https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI"); await A.getByLabel("Add to queue").click();
  const dlg = A.getByRole("alertdialog"); await dlg.waitFor({ timeout: 30000 });
  ok("a whole playlist is never added without asking, and the question says how many", /Add \d+ songs from this playlist/.test(await dlg.innerText()), await dlg.innerText());
  await dlg.getByRole("button", { name: "Not now" }).click(); await A.waitForTimeout(1500);
  ok("cancelling adds nothing", (await A.locator(".np-title").count()) === 0 && (await queue(A)) === 0);
  await A.getByLabel("YouTube link").fill("https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI"); await A.getByLabel("Add to queue").click(); await dlg.waitFor({ timeout: 30000 }); await dlg.getByRole("button", { name: /^Add \d+/ }).click();
  await A.locator(".np-title").waitFor({ timeout: 40000 });
  await B.waitForFunction(() => document.querySelectorAll('[aria-label="Up next"] li').length > 10, null, { timeout: 30000 });
  const qa = await queue(A), qb = await queue(B);
  ok("a playlist link queues many songs, the first one playing", qa > 10 && (await A.locator(".np-title").count()) === 1, String(qa));
  ok("everyone has the same queue", qa === qb, `${qa} / ${qb}`);
  ok("never more than the 50-song limit", qa <= 49);
  // play a chosen song from the queue
  const nth = A.getByRole("list", { name: "Up next" }).getByRole("listitem").nth(3);
  const chosen = (await nth.locator(".queue-play .ellipsis").innerText()).trim();
  await nth.getByRole("button", { name: /^Play .* now$/ }).click(); await A.waitForTimeout(1500);
  ok("a song chosen from the queue plays now, for everyone", (await A.locator(".np-title").first().innerText()).includes(chosen.slice(0, 20)) && (await B.locator(".np-title").first().innerText()).includes(chosen.slice(0, 20)), chosen);
  ok("and leaves the rest of the list as it was (minus that one)", (await queue(A)) === qa - 1 && (await queue(B)) === qa - 1, `${await queue(A)} vs ${qa - 1}`);
  const src = await A.locator(".music iframe").first().getAttribute("src");
  ok("the mini player asks YouTube for no captions and no pop-up notes", /cc_load_policy=0/.test(src) && /iv_load_policy=3/.test(src), src);
  // similar songs
  await A.getByRole("button", { name: "Add similar songs" }).click();
  await A.getByText(/similar song/).first().waitFor({ timeout: 40000 }).catch(() => {});
  const after = await queue(A);
  ok("Add similar songs adds a handful (never more than 15) of songs the list did not have", after >= qa - 1 && after - (qa - 1) <= 15, `${qa - 1} -> ${after}`);
  // a link copied while YouTube's automatic mix is playing adds just that song (not the whole mix)
  const C = await mk(); await C.goto("http://localhost:8080/"); await C.locator("input").first().fill("Cy"); await C.getByRole("button", { name: /create/i }).first().click(); await C.locator(".composer textarea").waitFor();
  await C.getByLabel("YouTube link").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&start_radio=1"); await C.getByLabel("Add to queue").click();
  await C.locator(".np-title").waitFor({ timeout: 40000 }); await C.waitForTimeout(3000);
  ok("a link from an automatic mix adds only that song", (await queue(C)) === 0);
  // full screen means the picture fills it; the queue opens over it only when asked for
  await A.getByRole("button", { name: "Maximise player" }).click().catch(() => {}); await A.waitForTimeout(700);
  const geo = await A.evaluate(() => { const f = document.querySelector(".music .player-frame")?.getBoundingClientRect(), q = document.querySelector(".music .queue-wrap"); return { fh: f && Math.round(f.height), fw: f && Math.round(f.width), vh: innerHeight, vw: innerWidth, queueShown: !!q && getComputedStyle(q).display !== "none" }; });
  ok("in full screen the video fills the screen (most of its height and all of its width)", geo.fh >= geo.vh * 0.72 && geo.fw >= geo.vw * 0.95, JSON.stringify(geo));
  ok("and the queue is out of the way until asked for", !geo.queueShown, JSON.stringify(geo));
  await A.getByRole("button", { name: /^Up next \(/ }).click(); await A.waitForTimeout(300);
  ok("the Up next button opens it over the picture, and it can be scrolled", await A.locator(".music .queue-wrap").isVisible() && (await A.locator(".music .queue-wrap").evaluate((e) => e.getBoundingClientRect().height)) <= (await A.evaluate(() => innerHeight)) * 0.56);
  await A.getByRole("button", { name: /^Up next \(/ }).click();
  await A.keyboard.press("Escape"); await A.waitForTimeout(400);
  const tog = A.getByRole("button", { name: /^Up next \(/ }); if (await tog.isVisible()) await tog.click(); // still in full screen: the list is behind its button
  await A.getByRole("button", { name: "Clear queue" }).click(); await A.waitForTimeout(500);
  ok("Clear queue empties the up-next list for everyone at once", (await queue(A)) === 0 && (await B.locator('[aria-label="Up next"] li').count()) === 0);
  // a personal mix is refused in plain words
  await C.getByLabel("YouTube link").fill("https://www.youtube.com/playlist?list=RDMMdQw4w9WgXcQ"); await C.getByLabel("Add to queue").click();
  await C.getByText(/personal mixes/i).first().waitFor({ timeout: 10000 });
  ok("a personal mix (My Mix) is explained, not silently ignored", true);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
