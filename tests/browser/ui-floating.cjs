// Floating things must be on top and inside their box in every look (the Appearance popover once opened behind the chat in Black hole
// and overflowed in Cyberpunk), the host's end-time control answers where it is pressed, search is centered and leaves the workspace
// alone, the workspace buttons have room between them, and the Black hole sky is a live canvas.
const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
const THEMES = ["midnight", "light", "graphite", "forest", "rose", "sunset", "shadcn", "web95", "paper", "terminal", "newspaper", "cyberpunk", "blackhole"];
(async () => {
  const b = await chromium.launch();
  const room = async (theme, vp = { width: 1300, height: 850 }) => {
    const p = await (await b.newContext({ viewport: vp })).newPage();
    p.on("pageerror", (e) => console.log("pageerror", e.message));
    await p.addInitScript((t) => localStorage.setItem("deca.prefs", JSON.stringify({ theme: t })), theme);
    await p.goto("http://localhost:8080/"); await p.locator("input").first().fill("Ann"); await p.getByRole("button", { name: /create/i }).first().click(); await p.locator(".composer textarea").waitFor();
    return p;
  };

  for (const t of THEMES) {
    for (const vp of [{ width: 1300, height: 850 }, { width: 390, height: 800 }]) {
      const p = await room(t, vp);
      await p.getByLabel("Appearance").click(); await p.waitForTimeout(350);
      const r = await p.evaluate(() => {
        const pop = document.querySelector(".popover, [role=dialog]"); if (!pop) return { none: true };
        const box = pop.getBoundingClientRect();
        // the popover must be what you hit at its middle and near its four corners (nothing painted over it)
        const pts = [[0.5, 0.5], [0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92]].map(([x, y]) => [box.left + box.width * x, box.top + Math.min(box.height, innerHeight - box.top) * y]);
        const covered = pts.filter(([x, y]) => { const e = document.elementFromPoint(x, y); return !e || !pop.contains(e); }).length;
        // and nothing inside may stick out sideways
        const out = [...pop.querySelectorAll("*")].filter((e) => { const q = e.getBoundingClientRect(); return q.width > 0 && (q.right > box.right + 1 || q.left < box.left - 1); }).length;
        return { covered, out, w: pop.scrollWidth - pop.clientWidth };
      });
      ok(`${t} @${vp.width}: the Appearance popover is on top of everything and nothing sticks out of it`, !r.none && r.covered === 0 && r.out === 0 && r.w <= 0, JSON.stringify(r));
      await p.context().close();
    }
  }

  // ---- host end-time control, and search / workspace
  const A = await room("graphite");
  const hostSection = A.locator("section", { has: A.getByRole("heading", { name: /Host controls/ }) });
  const toggle = hostSection.getByLabel("End this room after a set time");
  const sel = hostSection.getByLabel("How long the room lasts");
  const tb = await toggle.boundingBox(); const sb = await sel.boundingBox();
  ok("the length dropdown sits right under its switch, indented, not floating elsewhere", sb.y > tb.y && sb.y - tb.y < 60 && sb.x >= tb.x, JSON.stringify([tb, sb]));
  await toggle.check(); await A.waitForTimeout(400);
  const left = hostSection.getByRole("status");
  ok("turning it on shows the live countdown right there", /Ends in \d+:\d\d/.test(await left.innerText()));
  const lb = await left.boundingBox();
  ok("and it is next to the switch (not only in the top bar)", Math.abs(lb.y - tb.y) < 70);
  ok("the top bar shows it too", (await A.locator(".ends-in").count()) === 1);
  await toggle.uncheck();

  const launch = A.locator(".tool-launch");
  const gaps = await launch.evaluate((el) => { const k = [...el.children].map((c) => c.getBoundingClientRect()); let min = 1e9; for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) { const dx = Math.max(k[i].left - k[j].right, k[j].left - k[i].right), dy = Math.max(k[i].top - k[j].bottom, k[j].top - k[i].bottom); min = Math.min(min, Math.max(dx, dy)); } return min; });
  ok("the workspace buttons have space between them", gaps >= 6, String(gaps));

  await A.locator(".composer textarea").fill("/note"); await A.locator(".composer textarea").press("Enter");
  const ws = A.getByRole("complementary", { name: "Workspace" }); await ws.waitFor();
  await A.getByRole("button", { name: "Search this room" }).click();
  const pal = A.locator(".palette"); await pal.waitFor();
  ok("opening search keeps the workspace open behind it", (await ws.count()) === 1);
  const pb = await pal.boundingBox();
  ok("the search box is centered on the screen", Math.abs(pb.x + pb.width / 2 - 650) < 3 && Math.abs(pb.y + pb.height / 2 - 425) < 3, JSON.stringify(pb));
  await A.locator(".palette input").fill("zzzzzz"); await A.waitForTimeout(200);
  const pb2 = await pal.boundingBox();
  ok("and it does not jump when results appear or go", pb2.y === pb.y && pb2.height === pb.height);
  await A.keyboard.press("Escape"); await A.waitForTimeout(200);
  ok("Escape closes only the search; the workspace is still there", (await pal.count()) === 0 && (await ws.count()) === 1);
  await A.keyboard.press("Escape"); await A.waitForTimeout(200);
  ok("a second Escape closes the workspace", (await ws.count()) === 0);
  await A.keyboard.press("Control+k"); await A.locator(".palette").waitFor();
  ok("Ctrl+K opens search with no workspace", (await ws.count()) === 0);
  await A.context().close();

  // ---- Black hole: a live canvas that actually draws
  const H = await room("blackhole");
  await H.waitForTimeout(1500);
  const cv = H.locator("canvas.bh-canvas"); await cv.waitFor({ state: "attached", timeout: 10000 });
  const shot = async () => (await cv.screenshot()).toString("base64");
  const s1 = await shot(); await H.waitForTimeout(1200); const s2 = await shot();
  const { PNG } = require("pngjs");
  const img = PNG.sync.read(await cv.screenshot({ path: "blackhole.png" }));
  let bright = 0, lit = 0;
  for (let i = 0; i < img.data.length; i += 4) { const s = img.data[i] + img.data[i + 1] + img.data[i + 2]; if (s > 450) bright++; if (s > 60) lit++; }
  ok("the black hole sky is a canvas behind the interface", (await cv.count()) === 1 && (await cv.evaluate((e) => getComputedStyle(e).position)) === "fixed");
  ok("it draws light (not a black or blank frame) and it moves over time", s1 !== s2 && bright > 200 && lit > 2000, `bright ${bright} lit ${lit}`);
  ok("it never takes a click", (await cv.evaluate((e) => getComputedStyle(e).pointerEvents)) === "none");
  await H.getByLabel("Appearance").click(); await H.getByRole("button", { name: "Light theme" }).click(); await H.waitForTimeout(300);
  ok("switching to another theme removes it", (await H.locator("canvas.bh-canvas").count()) === 0);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
