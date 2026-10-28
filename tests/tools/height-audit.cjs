// Finds controls that sit side by side in a row but are different heights (an input next to its button, and so on).
//   cd tests && CHROME_PATH=... node tools/height-audit.cjs [theme ...]
const { chromium } = require("../lib/browser.cjs");
const themes = process.argv.slice(2).length ? process.argv.slice(2) : ["graphite", "light", "shadcn", "paper", "newspaper", "web95", "terminal", "cyberpunk", "blackhole"];
(async () => {
  const b = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  let bad = 0;
  for (const theme of themes) {
    const p = await (await b.newContext({ viewport: { width: 1300, height: 850 }, permissions: ["camera", "microphone"] })).newPage();
    await p.addInitScript((t) => localStorage.setItem("deca.prefs", JSON.stringify({ theme: t })), theme);
    await p.goto("http://localhost:8080/"); await p.locator("input").first().fill("Ann"); await p.getByRole("button", { name: /create/i }).first().click(); await p.locator(".composer textarea").waitFor();
    const scan = () => p.evaluate(() => {
      const out = [];
      const isCtl = (e) => e.matches("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]), select, button, .button, code.link") && e.offsetParent !== null && !e.matches(".small-btn, .dot, .swatch, .scrim, .slot-toggle, [aria-label='Toggle']") && !e.closest(".members li, .menu, .tool-launch");
      const label = (e) => (e.getAttribute("aria-label") || e.textContent || e.className || e.tagName).trim().replace(/\s+/g, " ").slice(0, 22);
      for (const parent of new Set([...document.querySelectorAll("input, select, button, .button, code.link")].map((e) => e.parentElement))) {
        if (!parent) continue;
        const cs = getComputedStyle(parent);
        if (!/flex|grid/.test(cs.display)) continue;
        const kids = [...parent.children].filter(isCtl);
        if (kids.length < 2) continue;
        const hs = kids.map((k) => Math.round(k.getBoundingClientRect().height * 10) / 10);
        if (Math.max(...hs) - Math.min(...hs) > 2.5) out.push(`${parent.className || parent.tagName}: ` + kids.map((k, i) => `${label(k)}=${hs[i]}`).join(", "));
      }
      return out;
    });
    const found = new Set(await scan());
    await p.locator(".tool-tile", { has: p.locator("strong", { hasText: /^Notes$/ }) }).click().catch(() => {}); await p.waitForTimeout(400); for (const f of await scan()) found.add(f);
    await p.keyboard.press("Escape");
    for (const f of found) console.log(`${theme}: ${f}`);
    bad += found.size; await p.context().close();
  }
  console.log(`\n${bad} mismatch(es)`); await b.close(); process.exit(bad ? 1 : 0);
})();
