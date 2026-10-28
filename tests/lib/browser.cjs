// The one place that decides how the tests start a browser. Tests call chromium.launch({ args }) as usual.
//  CHROME_PATH   use this browser binary (otherwise Playwright's own Chromium; install it with `npx playwright-core install chromium`)
//  DECA_URL      where the app really is. The tests are written against http://localhost:8080/, and navigation to that address
//                is pointed here (the runner starts the app on 8080 itself, so this is only for an app running elsewhere).
const pw = require("playwright-core");

const BASE = process.env.DECA_URL || "http://localhost:8080/";
const WRITTEN_FOR = /^http:\/\/localhost:8080\//;

function aim(page) {
  const goto = page.goto.bind(page);
  page.goto = (url, o) => goto(typeof url === "string" ? url.replace(WRITTEN_FOR, BASE) : url, o);
  return page;
}
function aimContext(ctx) {
  const newPage = ctx.newPage.bind(ctx);
  ctx.newPage = async () => aim(await newPage());
  return ctx;
}

// Calls start with the camera OFF by default (the app's own default), but most tests are about video, so they turn the "start with
// camera" preference on before the page loads. A test about the real default passes launch({ realDefaults: true }).
const CAMERA_ON = () => {
  try {
    const k = "deca.prefs";
    const v = JSON.parse(localStorage.getItem(k) || "{}");
    if (v.startWithCamera === undefined) {
      v.theme ||= "graphite"; // the app ignores saved preferences that name no known theme
      v.startWithCamera = true;
      localStorage.setItem(k, JSON.stringify(v));
    }
  } catch {
    // no storage: the app default applies
  }
};

const chromium = {
  launch: async (opts = {}) => {
    const { executablePath: _ignored, realDefaults, ...rest } = opts; // tests never pick a binary themselves
    const b = await pw.chromium.launch({ ...rest, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const newContext = b.newContext.bind(b);
    b.newContext = async (o) => {
      const c = aimContext(await newContext(o));
      if (!realDefaults) await c.addInitScript(CAMERA_ON);
      return c;
    };
    const newPage = b.newPage.bind(b);
    b.newPage = async (o) => {
      const p = await newPage(o);
      if (!realDefaults) await p.addInitScript(CAMERA_ON);
      return aim(p);
    };
    return b;
  },
};

module.exports = { chromium, BASE };
