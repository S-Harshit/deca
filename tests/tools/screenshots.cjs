// Regenerates the README pictures in docs/images/ from the running app (a real room, two people, a bit of conversation).
//   cd tests && CHROME_PATH=... node tools/screenshots.cjs      (the app must be running on :8080; `node run.mjs` starts one)
const path = require("node:path");
const { chromium } = require("../lib/browser.cjs");

const OUT = path.join(__dirname, "..", "..", "docs", "images");
const BASE = process.env.DECA_URL || "http://localhost:8080/";

(async () => {
  const b = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const ctx = async (theme) => {
    const c = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await c.addInitScript((t) => localStorage.setItem("deca.prefs", JSON.stringify({ theme: t })), theme);
    return c;
  };
  const say = async (p, t) => { await p.locator(".composer textarea").fill(t); await p.locator(".composer textarea").press("Enter"); await p.waitForTimeout(250); };

  for (const [theme, name] of [["graphite", "room"], ["shadcn", "room-zinc"]]) {
    const A = await (await ctx(theme)).newPage();
    await A.goto(BASE);
    if (name === "room") await A.screenshot({ path: path.join(OUT, "home.png") });
    await A.locator("input").first().fill("Ann"); await A.getByRole("button", { name: /create/i }).first().click(); await A.locator(".composer textarea").waitFor();
    const B = await (await ctx(theme)).newPage();
    await B.goto(A.url()); await B.locator("input").first().fill("Ben"); await B.getByRole("button", { name: /join/i }).first().click(); await B.locator(".composer textarea").waitFor();
    await A.waitForFunction(() => /\b2 \/ /.test(document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || ""), null, { timeout: 30000 });
    await say(A, "Friday plan: pizza at 7, then a game night?");
    await say(B, "In. I can bring drinks");
    await say(A, "```js\nconst room = \"a link\";\nroom.vanishesWhenEveryoneLeaves = true;\n```");
    await say(B, "Love that nothing is stored anywhere");
    await A.waitForTimeout(600);
    await A.screenshot({ path: path.join(OUT, `${name}.png`) });
    await A.context().close(); await B.context().close();
  }
  await b.close();
  console.log("wrote", OUT);
})();
