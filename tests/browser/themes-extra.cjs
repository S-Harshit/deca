// The four extra looks (Early web, Paper, Terminal, Newspaper) and the square "Sharp" corners.
const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
(async () => {
  const b = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const room = async (theme, extra = {}, vp = { width: 1250, height: 800 }) => {
    const p = await (await b.newContext({ viewport: vp, permissions: ["camera", "microphone"] })).newPage();
    await p.addInitScript(([t, e]) => localStorage.setItem("deca.prefs", JSON.stringify({ theme: t, ...e })), [theme, extra]);
    await p.goto("http://localhost:8080/"); await p.locator("input").first().fill("Ann"); await p.getByRole("button", { name: /create/i }).first().click(); await p.locator(".composer textarea").waitFor();
    await p.locator(".composer textarea").fill("Hello from the " + theme + " theme"); await p.locator(".composer textarea").press("Enter"); await p.waitForTimeout(300);
    return p;
  };
  const css = (p, sel, prop) => p.evaluate(([s, pr]) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[pr] : null; }, [sel, prop]);
  const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);

  const picker = await room("graphite");
  await picker.getByLabel("Appearance").click();
  for (const label of ["Early web", "Paper", "Terminal", "Newspaper", "Cyberpunk", "Black hole"]) ok(`${label} is offered in the theme picker`, (await picker.getByRole("button", { name: `${label} theme`, exact: true }).count()) === 1);
  await picker.getByRole("button", { name: "Terminal theme" }).click(); await picker.waitForTimeout(200);
  ok("picking one sets it", (await picker.evaluate(() => document.documentElement.dataset.theme)) === "terminal");

  const web = await room("web95");
  ok("Early web: teal desktop behind the grey panels", (await css(web, "body", "backgroundColor")) === "rgb(0, 128, 128)");
  ok("Early web: the top bar is a taskbar at the bottom of the screen", (await web.evaluate(() => { const t = document.querySelector(".topbar").getBoundingClientRect(); return t.top > innerHeight - 80; })));
  ok("Early web: buttons are bevelled and square", (await css(web, "button", "borderTopColor")) === "rgb(255, 255, 255)" && (await css(web, "button", "borderRadius")) === "0px");
  ok("Early web: the chat is a white page with black text", (await css(web, ".timeline", "backgroundColor")) === "rgb(255, 255, 255)");
  ok("Early web: no sideways scroll", (await overflow(web)) <= 0);
  await web.screenshot({ path: "theme-web95.png" });

  const paper = await room("paper");
  ok("Paper: warm off-white page, ink text", (await css(paper, "body", "backgroundColor")) === "rgb(244, 238, 224)" && (await css(paper, ".app", "color")) === "rgb(29, 26, 20)");
  ok("Paper: headings are a serif", /Georgia|Palatino|Iowan|serif/i.test((await css(paper, ".panel h3", "fontFamily")) ?? ""));
  ok("Paper: no sideways scroll", (await overflow(paper)) <= 0);
  await paper.screenshot({ path: "theme-paper.png" });

  const term = await room("terminal");
  ok("Terminal: everything is monospace", /mono|Menlo|Consolas/i.test((await css(term, ".composer textarea", "fontFamily")) ?? "") && /mono|Menlo|Consolas/i.test((await css(term, "button", "fontFamily")) ?? ""));
  ok("Terminal: soft phosphor green on near-black (easy on the eyes, no flicker)", (await css(term, ".app", "color")) === "rgb(169, 220, 184)" && (await css(term, "body", "backgroundColor")) === "rgb(11, 16, 12)" && (await css(term, "body", "textShadow")) === "none");
  ok("Terminal: no sideways scroll", (await overflow(term)) <= 0);
  await term.screenshot({ path: "theme-terminal.png" });

  const news = await room("newspaper");
  ok("Newspaper: a masthead with the nameplate", (await news.evaluate(() => getComputedStyle(document.querySelector(".topbar"), "::before").content)).includes("Gazette"));
  ok("Newspaper: sections start with a double rule", /double/.test((await css(news, ".panel", "borderTopStyle")) ?? ""));
  ok("Newspaper: serif type", /Times|Georgia|serif/i.test((await css(news, "body", "fontFamily")) ?? ""));
  ok("Newspaper: no sideways scroll", (await overflow(news)) <= 0);
  await news.screenshot({ path: "theme-newspaper.png" });

  const cyber = await room("cyberpunk");
  ok("Cyberpunk: yellow-tagged HUD plates with cut corners on a near-black city", (await css(cyber, "button", "color")) === "rgb(252, 238, 9)" && /polygon/.test((await css(cyber, ".panel", "clipPath")) ?? "") && (await css(cyber, "body", "backgroundColor")) === "rgb(9, 9, 12)");
  ok("Cyberpunk: the workspace launcher has room to breathe", parseFloat((await cyber.evaluate(() => getComputedStyle(document.querySelector(".tool-launch")).columnGap))) >= 8);
  ok("Cyberpunk: no sideways scroll", (await overflow(cyber)) <= 0);
  await cyber.screenshot({ path: "theme-cyberpunk.png" });
  const hole = await room("blackhole");
  ok("Black hole: the sky is a live canvas (no image file), the interface is frosted glass", (await hole.locator("canvas.bh-canvas").count()) === 1 && /blur/.test((await css(hole, ".panel", "backdropFilter")) ?? ""));
  ok("Black hole: no image or video was loaded for the background", (await hole.evaluate(() => performance.getEntriesByType("resource").filter((r) => /\.(gif|png|jpe?g|webp|mp4|webm|avif)(\?|$)/i.test(r.name)).length)) === 0);
  ok("Black hole: no sideways scroll", (await overflow(hole)) <= 0);
  await hole.screenshot({ path: "theme-blackhole.png" });
  // red buttons stay red, in every new theme
  for (const [name, p] of [["Paper", paper], ["Newspaper", news], ["Early web", web], ["Cyberpunk", cyber], ["Black hole", hole], ["Terminal", term]]) ok(`${name}: the wake-up button is still visible and red`, (await css(p, ".horn-btn", "backgroundColor")) === "rgb(217, 45, 32)");

  // square corners
  const sharp = await room("graphite", { radius: 0 });
  ok("Sharp is square (buttons, inputs, panels)", (await css(sharp, "button", "borderRadius")) === "0px" && (await css(sharp, ".composer textarea", "borderRadius")) === "0px" && (await css(sharp, ".panel", "borderRadius")) === "0px", [await css(sharp, "button", "borderRadius"), await css(sharp, ".panel", "borderRadius")].join());
  const old = await room("graphite", { radius: 4 });
  ok("someone who had picked the old Sharp (4) now gets the square one", (await css(old, "button", "borderRadius")) === "0px");
  // phone widths
  for (const t of ["web95", "paper", "terminal", "newspaper", "cyberpunk", "blackhole"]) { const m = await room(t, {}, { width: 390, height: 780 }); ok(`${t}: fits a phone`, (await overflow(m)) <= 0, JSON.stringify(await m.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && e.offsetParent !== null).slice(0, 6).map((e) => e.tagName + "." + String(e.className).slice(0, 30) + " r=" + Math.round(e.getBoundingClientRect().right))))); }
  console.log(`\n${pass} passed, ${fail} failed`); await b.close();
})();
