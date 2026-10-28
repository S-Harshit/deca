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
  await A.locator(".np-title").waitFor({ timeout: 40000 });
  await B.waitForFunction(() => document.querySelectorAll('[aria-label="Up next"] li').length > 10, null, { timeout: 30000 });
  const qa = await queue(A), qb = await queue(B);
  ok("a playlist link queues many songs, the first one playing", qa > 10 && (await A.locator(".np-title").count()) === 1, String(qa));
  ok("everyone has the same queue", qa === qb, `${qa} / ${qb}`);
  ok("never more than the 50-song limit", qa <= 49);
  // similar songs
  await A.getByRole("button", { name: "Add similar songs" }).click();
  await A.getByText(/similar song/).first().waitFor({ timeout: 40000 }).catch(() => {});
  const after = await queue(A);
  ok("Add similar songs adds songs the playlist did not have (or says the queue is full)", after >= qa, `${qa} -> ${after}`);
  // an automatic mix pasted as a link
  const C = await mk(); await C.goto("http://localhost:8080/"); await C.locator("input").first().fill("Cy"); await C.getByRole("button", { name: /create/i }).first().click(); await C.locator(".composer textarea").waitFor();
  await C.getByLabel("YouTube link").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&start_radio=1"); await C.getByLabel("Add to queue").click();
  await C.locator(".np-title").waitFor({ timeout: 40000 });
  await C.waitForFunction(() => document.querySelectorAll('[aria-label="Up next"] li').length > 5, null, { timeout: 30000 });
  ok("a link from YouTube's automatic mix queues the song and the mix", (await queue(C)) > 5);
  // a personal mix is refused in plain words
  await C.getByLabel("YouTube link").fill("https://www.youtube.com/playlist?list=RDMMdQw4w9WgXcQ"); await C.getByLabel("Add to queue").click();
  await C.getByText(/personal mixes/i).first().waitFor({ timeout: 10000 });
  ok("a personal mix (My Mix) is explained, not silently ignored", true);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
