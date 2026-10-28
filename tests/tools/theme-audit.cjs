// Walks every theme through the same screens and checks, for each interactive element, that its text stays readable against its
// own background in the normal AND hover AND focus states, and that hovering changes something. Prints problems; exits 1 if any.
//   cd tests && CHROME_PATH=... node tools/theme-audit.cjs [theme ...]
const { chromium } = require("../lib/browser.cjs");
const THEMES = ["graphite", "midnight", "light", "forest", "rose", "sunset", "shadcn", "web95", "paper", "terminal", "newspaper"];
const only = process.argv.slice(2);

// self-contained: it is serialised into the page, so it cannot use anything defined outside it
const measure = (el) => {
  const parse = (c) => { const q = /color\(srgb ([^)]+)\)/.exec(c); if (q) { const p = q[1].split(/[ /]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; } const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
  const over = (top, under) => { const a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const chain = []; for (let e = el; e; e = e.parentElement) chain.push(getComputedStyle(e).backgroundColor);
  let bg = [255, 255, 255, 1]; for (const c of chain.reverse()) { const p = parse(c); if (p[3] > 0) bg = over(p, bg); }
  const cs = getComputedStyle(el); const fg = over(parse(cs.color), bg);
  return { fg: cs.color, bg: `rgb(${bg.slice(0, 3).map(Math.round)})`, ratio: ratio(fg, bg), border: cs.borderTopColor, shadow: cs.boxShadow, transform: cs.transform };
};

(async () => {
  const b = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  let problems = 0;
  for (const theme of (only.length ? only : THEMES)) {
    const ctx = await b.newContext({ viewport: { width: 1250, height: 800 }, permissions: ["camera", "microphone"] });
    const p = await ctx.newPage();
    await p.addInitScript((t) => localStorage.setItem("deca.prefs", JSON.stringify({ theme: t })), theme);
    await p.goto("http://localhost:8080/"); await p.locator("input").first().fill("Ann"); await p.getByRole("button", { name: /create/i }).first().click(); await p.locator(".composer textarea").waitFor();
    await p.locator(".composer textarea").fill("hello https://example.com"); await p.locator(".composer textarea").press("Enter");
    const seen = new Set(); const found = [];
    const audit = async (scene) => {
      const els = await p.$$("button:visible:not(.dot), a[href]:visible, .swatch:visible, [role=tab]:visible, summary:visible");
      for (const el of els.slice(0, 32)) {
        const label = (await el.evaluate((e) => (e.getAttribute("aria-label") || e.textContent || e.className || e.tagName).trim().replace(/\s+/g, " ").slice(0, 30))) + " [" + scene + "]";
        if (seen.has(label)) continue; seen.add(label);
        const before = await el.evaluate(measure);
        await el.hover({ timeout: 500 }).catch(() => {}); await p.waitForTimeout(280); // past every colour transition
        const hover = await el.evaluate(measure);
        const dis = await el.evaluate((e) => e.disabled || e.getAttribute("aria-disabled") === "true");
        const bad = [];
        if (!dis && before.ratio < 2.6) bad.push(`normal contrast ${before.ratio.toFixed(1)} (${before.fg} on ${before.bg})`);
        if (!dis && hover.ratio < 2.6) bad.push(`HOVER contrast ${hover.ratio.toFixed(1)} (${hover.fg} on ${hover.bg})`);
        if (!dis && hover.bg === before.bg && hover.fg === before.fg && hover.border === before.border && hover.shadow === before.shadow && hover.transform === before.transform) bad.push("hover changes nothing");
        if (bad.length) found.push(`${theme}: ${label}: ${bad.join("; ")}`);
      }
      await p.mouse.move(0, 0);
    };
    await audit("room");
    await p.getByLabel("Appearance").click(); await audit("appearance"); await p.keyboard.press("Escape"); await p.getByLabel("Appearance").click().catch(() => {});
    await p.locator(".composer .icon-btn").nth(1).click().catch(() => {}); await audit("composer menu"); await p.keyboard.press("Escape");
    await p.keyboard.press("Escape"); await p.locator(".tool-tile", { has: p.locator("strong", { hasText: /^Notes$/ }) }).click().catch(() => {}); await p.waitForTimeout(500); await audit("workspace");
    for (const f of found) console.log(f);
    problems += found.length; await ctx.close();
  }
  console.log(`\n${problems} problem(s)`); await b.close(); process.exit(problems ? 1 : 0);
})();
