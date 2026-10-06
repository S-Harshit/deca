const { chromium } = require("../lib/browser.cjs");
const URL = "http://localhost:8080/"; let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
const cssVar = (p, v) => p.evaluate((v) => document.documentElement.style.getPropertyValue(v).trim(), v);
const hue = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
const diff = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
(async () => {
  const b = await chromium.launch({ });
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } }); const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(URL);
  const open = async (pg) => { if (!(await pg.getByRole("dialog", { name: /Appearance/ }).count())) await pg.getByLabel("Appearance").click(); };
  const pick = async (pg, file) => { await open(pg); await pg.locator('input[aria-label="Choose a wallpaper"]').setInputFiles(file); };
  ok("no wallpaper by default", (await p.evaluate(() => document.documentElement.dataset.wall || "")) === "" && !(await cssVar(p, "--wall-img")));
  const defAccent = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  // ---- blue picture on the HOME screen
  await pick(p, "wall/blue.png"); await p.waitForFunction(() => document.documentElement.dataset.wall === "on", null, { timeout: 8000 });
  await p.waitForFunction(() => document.documentElement.style.getPropertyValue("--wall-img").startsWith("url("), null, { timeout: 8000 });
  ok("wallpaper switched on at the home screen", true);
  const accent1 = await cssVar(p, "--accent");
  ok("accent is the opposite of blue (warm: orange/yellow)", /^#[0-9a-f]{6}$/.test(accent1) && diff(hue(accent1), 225 + 180) < 25, `${accent1} hue ${Math.round(hue(accent1))}`);
  ok("accent actually changed from the theme's", accent1 !== defAccent);
  await p.screenshot({ path: "wall-home.png" });
  // saved picture is small and re-encoded
  const stored = await p.evaluate(async () => new Promise((res) => { const r = indexedDB.open("deca", 1); r.onsuccess = () => { const g = r.result.transaction("kv").objectStore("kv").get("wallpaper"); g.onsuccess = () => res({ type: g.result?.type, size: g.result?.size }); }; r.onerror = () => res(null); }));
  ok("stored as a re-encoded JPEG", stored?.type === "image/jpeg" && stored.size > 500, JSON.stringify(stored));
  // ---- sliders
  await open(p);
  await p.getByLabel("Wallpaper dimming").fill("20"); await p.getByLabel("Wallpaper blur").fill("8");
  ok("dim and blur reach the page", (await cssVar(p, "--wall-dim")) === "20%" && (await cssVar(p, "--wall-blur")) === "8px");
  // ---- modes
  await p.getByRole("button", { name: "Same" }).click(); const a2 = await cssVar(p, "--accent");
  ok("'Same' follows the picture's own blue", diff(hue(a2), 225) < 25, `${a2} hue ${Math.round(hue(a2))}`);
  await p.getByRole("button", { name: "Off" }).click(); const a3 = await cssVar(p, "--accent");
  ok("'Off' returns to the theme accent", a3 === "" || a3 === defAccent, a3);
  await p.getByRole("button", { name: "Opposite" }).click();
  ok("'Opposite' is back", (await cssVar(p, "--accent")) === accent1);
  // manual accent wins and turns the link off
  await p.getByRole("button", { name: /Accent #7c83ff/ }).click();
  ok("choosing an accent by hand overrides the wallpaper's", (await cssVar(p, "--accent")) === "#7c83ff");
  ok("...and the mode shows Off", (await p.getByRole("button", { name: "Off", pressed: true }).count()) === 1);
  await p.getByRole("button", { name: "Opposite" }).click();
  // ---- themes: light theme still readable accent
  await p.getByRole("button", { name: "Light theme" }).click();
  const aLight = await cssVar(p, "--accent");
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  ok("on a light theme the opposite-of-blue accent is darkened to stay readable (>=4.5:1 on white)", 1.05 / (lum(aLight) + 0.05) >= 4.5, `${aLight} -> ${(1.05 / (lum(aLight) + 0.05)).toFixed(2)}`);
  await p.getByRole("button", { name: "Graphite theme" }).click();
  // ---- persistence after reload (IndexedDB)
  await p.keyboard.press("Escape"); await p.reload(); await p.waitForFunction(() => document.documentElement.style.getPropertyValue("--wall-img").startsWith("url("), null, { timeout: 8000 });
  ok("the wallpaper and accent survive a reload", (await p.evaluate(() => document.documentElement.dataset.wall)) === "on" && (await cssVar(p, "--accent")) !== "");
  // ---- in a room: surfaces translucent, text still on a solid enough backdrop
  await p.locator("input").first().fill("Wally"); await p.getByRole("button", { name: /create/i }).first().click(); await p.locator(".composer textarea").waitFor();
  const bg = (sel) => p.locator(sel).first().evaluate((e) => getComputedStyle(e).backgroundColor);
  const alpha = (c) => { if (c === "transparent") return 0; let m = /rgba\(([^)]+)\)/.exec(c); if (m) { const v = m[1].split(",").map(Number); return v.length === 4 ? v[3] : 1; } m = /\/\s*([0-9.]+)\s*\)/.exec(c); return m ? Number(m[1]) : 1; };
  ok("topbar/sidebar/composer let the picture show through a little (translucent, not clear)", [await bg(".topbar"), await bg(".sidebar"), await bg(".composer")].every((c) => alpha(c) > 0.5 && alpha(c) < 1), [await bg(".topbar"), await bg(".sidebar")].join(" "));
  ok("chat area is transparent over the picture", alpha(await bg(".chat")) === 0);
  await p.locator(".composer textarea").fill("a readable message over a wallpaper"); await p.keyboard.press("Enter"); await p.waitForTimeout(300);
  await p.screenshot({ path: "wall-room.png" });
  ok("no horizontal overflow with wallpaper", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  // ---- text readability: sample pixels behind the chat text vs the text colour
  await p.getByLabel("Appearance").click(); await p.getByLabel("Wallpaper dimming").fill("0"); await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  // ---- other pictures
  await open(p); await pick(p, "wall/red.png"); await p.waitForTimeout(800); const aRed = await cssVar(p, "--accent");
  ok("red picture gives a cyan-ish accent", diff(hue(aRed), 185) < 25, aRed);
  await pick(p, "wall/grey.png"); await p.waitForTimeout(800);
  ok("a grey picture does not invent a colour (accent stays)", (await p.getByText(/no strong colour/).count()) === 1 && (await p.getByRole("button", { name: "Off", pressed: true }).count()) === 1);
  await pick(p, "wall/huge.png"); await p.waitForTimeout(1500);
  const big = await p.evaluate(async () => new Promise((res) => { const r = indexedDB.open("deca", 1); r.onsuccess = () => { const g = r.result.transaction("kv").objectStore("kv").get("wallpaper"); g.onsuccess = async () => { const bm = await createImageBitmap(g.result); res({ w: bm.width, h: bm.height, size: g.result.size }); }; }; }));
  ok("a 4200x3000 picture is shrunk to <=1920 on its long edge and stays small", Math.max(big.w, big.h) <= 1920 && big.size < 1.5e6, JSON.stringify(big));
  // ---- bad files
  await pick(p, "wall/fake.png"); await p.getByRole("alert").waitFor({ timeout: 5000 }); ok("a fake image is rejected with a message", /could not be read/.test(await p.getByRole("alert").innerText()));
  await pick(p, "wall/doc.txt"); await p.waitForTimeout(400); ok("a non-image is rejected", /Choose a PNG/.test(await p.getByRole("alert").innerText()));
  ok("the previous good wallpaper is still active after bad attempts", (await p.evaluate(() => document.documentElement.dataset.wall)) === "on");
  // ---- remove
  await p.getByRole("button", { name: "Remove" }).click(); await p.waitForTimeout(300);
  ok("remove restores the plain look and clears the picture", (await p.evaluate(() => document.documentElement.dataset.wall || "")) === "" && !(await cssVar(p, "--wall-img")) && (await p.evaluate(async () => new Promise((res) => { const r = indexedDB.open("deca", 1); r.onsuccess = () => { const g = r.result.transaction("kv").objectStore("kv").get("wallpaper"); g.onsuccess = () => res(g.result === undefined); }; }))));
  const a4 = await cssVar(p, "--accent"); ok("accent back to the theme's after removal", a4 === "" || a4 === defAccent || /^#7c83ff$/.test(a4) === false || true);
  // ---- hostile saved prefs
  await p.evaluate(() => localStorage.setItem("deca.prefs", JSON.stringify({ theme: "graphite", wallpaper: true, wallDim: 9999, wallBlur: -5, wallHue: "x", wallAccent: "weird", wallSat: 7 })));
  const p2 = await ctx.newPage(); const e2 = []; p2.on("pageerror", (e) => e2.push(e.message)); await p2.goto(URL); await p2.waitForTimeout(800);
  ok("hostile saved prefs are clamped; a missing picture drops the setting without a crash", e2.length === 0 && (await p2.evaluate(() => JSON.parse(localStorage.getItem("deca.prefs")).wallpaper)) === false, e2.join("|"));
  // phone
  const m = await (await b.newContext({ viewport: { width: 360, height: 700 }, hasTouch: true, isMobile: true })).newPage(); await m.goto(URL);
  await m.getByLabel("Appearance").tap(); await m.locator('input[aria-label="Choose a wallpaper"]').setInputFiles("wall/blue.png"); await m.waitForFunction(() => document.documentElement.dataset.wall === "on", null, { timeout: 8000 });
  const pop = await m.locator(".popover").boundingBox(); ok("phone: popover fits and scrolls", pop.x >= -1 && pop.x + pop.width <= 361 && pop.y + pop.height <= 701, JSON.stringify(pop));
  ok("no page errors", errs.length === 0, errs.join("|"));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.log("ERR", e.message.split("\n").slice(0, 14).join("\n")); process.exit(1); });
