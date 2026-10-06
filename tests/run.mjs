#!/usr/bin/env node
// Runs the Deca tests, one suite at a time (they share one server and its per-address limits, so not in parallel).
//
//   node run.mjs               everything
//   node run.mjs quick         a fast, representative subset
//   node run.mjs unit          unit tests only (no browser, no server)
//   node run.mjs browser       browser tests only
//   node run.mjs scores room   any suite whose name contains one of the words
//
// It starts the app itself on http://localhost:8080 (from dema-client/dist, building it first if missing), unless something is
// already answering there. Environment: CHROME_PATH (browser binary), RETRIES (default 1, for the few flaky suites).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const PORT = 8080;
const BASE = `http://localhost:${PORT}/`;
const RETRIES = Number(process.env.RETRIES ?? 1);

// Suites that need something extra, and the ones in the quick set.
const SLOW = new Set(["code-mode-slow.cjs"]); // a minute or two of deliberate waiting
const NEEDS_NET = new Set(["music-replay.cjs", "music-maximise.cjs", "music-float.cjs", "music-float-wallpaper.cjs"]); // plays a YouTube video
const QUICK = new Set(["core.mjs", "forged-host.mjs", "deciders.mjs", "horn.mjs", "scores.cjs", "room-end.cjs", "code-mode-basic.cjs", "auto-retry.cjs"]);

const args = process.argv.slice(2);
const only = (list) => list.filter((f) => !f.startsWith("."));
const unit = only(readdirSync(join(here, "unit"))).map((f) => ({ kind: "unit", file: join("unit", f) }));
const browser = only(readdirSync(join(here, "browser"))).map((f) => ({ kind: "browser", file: join("browser", f), name: f }));

let picked;
if (!args.length || args[0] === "all") picked = [...unit, ...browser];
else if (args[0] === "unit") picked = unit;
else if (args[0] === "browser") picked = browser;
else if (args[0] === "quick") picked = [...unit, ...browser.filter((s) => QUICK.has(s.name))];
else picked = [...unit, ...browser].filter((s) => args.some((a) => s.file.includes(a)));
if (!picked.length) {
  console.error("No suite matches:", args.join(" "));
  process.exit(2);
}

const alive = async () => {
  try {
    return (await fetch(`${BASE}healthz`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
};

let server;
async function startApp() {
  if (await alive()) {
    console.log(`Using the app already running at ${BASE}\n`);
    return;
  }
  const dist = join(root, "dema-client", "dist");
  if (!existsSync(dist)) {
    console.log("Building the app first (dema-client/dist is missing)...");
    const b = spawnSync("npm", ["run", "build"], { cwd: join(root, "dema-client"), stdio: "inherit", shell: true });
    if (b.status) process.exit(b.status);
  }
  server = spawn("node", ["server.js"], { cwd: join(root, "dema-server"), env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  for (let i = 0; i < 40 && !(await alive()); i++) await new Promise((r) => setTimeout(r, 250));
  if (!(await alive())) {
    console.error(`Could not start the app on port ${PORT}. Is something else using it?`);
    server.kill();
    process.exit(1);
  }
  console.log(`Started the app on ${BASE}\n`);
}

function run(suite) {
  const isUnit = suite.kind === "unit";
  const cmd = isUnit ? ["--experimental-strip-types", "--no-warnings", suite.file] : [suite.file];
  const limit = SLOW.has(suite.name) ? 420_000 : 240_000;
  const abs = cmd.map((c) => (c === suite.file ? join(here, c) : c));
  const r = spawnSync("node", abs, { cwd: isUnit ? here : fixtures, env: { ...process.env, DECA_URL: process.env.DECA_URL ?? BASE }, encoding: "utf8", timeout: limit, maxBuffer: 50 * 1024 * 1024 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const failed = [...out.matchAll(/(\d+) failed/g)].some((m) => Number(m[1]) > 0);
  const bad = r.status !== 0 || r.error || failed || /^(FAIL|ERR)\b/m.test(out) || /AssertionError|TimeoutError/.test(out);
  return { ok: !bad, out, timedOut: !!r.error };
}

if (picked.some((s) => s.kind === "unit")) {
  const p = spawnSync("node", [join(here, "lib", "prep-unit.mjs")], { stdio: "inherit" });
  if (p.status) process.exit(p.status);
}
let fixtures = here;
if (picked.some((s) => s.kind === "browser")) {
  fixtures = createRequire(import.meta.url)("./lib/fixtures.cjs").make(); // the browser suites run in here, and upload from here
  if (!process.env.CHROME_PATH) console.log("Browser: Playwright's Chromium (set CHROME_PATH to use another; install with `npx playwright-core install chromium`)");
  if (picked.some((s) => s.name === "static-build.cjs") && !existsSync(join(root, "dist-static"))) {
    console.log("Building the static site first (dist-static is missing)...");
    spawnSync("node", [join(root, "scripts", "build-static.mjs")], { stdio: "inherit" });
  }
  await startApp();
}

const results = [];
for (const s of picked) {
  const t0 = Date.now();
  let r = run(s);
  let tries = 0;
  while (!r.ok && tries < RETRIES) {
    tries++;
    r = run(s);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const note = NEEDS_NET.has(s.name) ? " (needs internet)" : "";
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${s.file}  ${secs}s${tries && r.ok ? "  (passed on retry)" : ""}${r.ok ? "" : note}`);
  if (!r.ok) console.log(r.out.split("\n").filter((l) => /FAIL|ERR|Error|failed/.test(l)).slice(0, 8).map((l) => `      ${l.slice(0, 200)}`).join("\n"));
  results.push({ s, ok: r.ok });
}
server?.kill();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} of ${results.length} suites passed${bad.length ? `. Failed: ${bad.map((b) => b.s.file).join(", ")}` : "."}`);
process.exit(bad.length ? 1 : 0);
