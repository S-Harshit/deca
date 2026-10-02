#!/usr/bin/env node
/**
 * One-step launcher for Deca. Works on macOS, Windows and Linux with only Node.js installed.
 *
 *   node scripts/start.mjs            start Deca and make a public link to share
 *   node scripts/start.mjs --local    this computer only (no link, nothing downloaded)
 *   node scripts/start.mjs --port N   use another port
 *   node scripts/start.mjs --no-open  do not open the browser
 *
 * First run sets itself up (installs what the server needs and builds the app if that was not already done),
 * downloads the free Cloudflare tunnel program if it is missing, then prints the link. Close the window to stop.
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, closeSync, createWriteStream, existsSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "dema-server");
const CLIENT = join(ROOT, "dema-client");
const RUN = join(ROOT, ".run");
const BIN = join(ROOT, ".bin");
const win = process.platform === "win32";

/** Which cloudflared download fits this computer? Pure, so it can be tested for every system. */
export function cloudflaredAsset(platform, arch) {
  const a = { x64: "amd64", arm64: "arm64", ia32: "386", arm: "arm" }[arch];
  if (!a) return null;
  const base = "https://github.com/cloudflare/cloudflared/releases/latest/download";
  if (platform === "darwin") return a === "amd64" || a === "arm64" ? { url: `${base}/cloudflared-darwin-${a}.tgz`, kind: "tgz", name: "cloudflared" } : null;
  if (platform === "linux") return { url: `${base}/cloudflared-linux-${a}`, kind: "bin", name: "cloudflared" };
  if (platform === "win32") return a === "amd64" || a === "386" ? { url: `${base}/cloudflared-windows-${a}.exe`, kind: "bin", name: "cloudflared.exe" } : null;
  return null;
}

/** The first free port at or after `start`. */
export async function freePort(start) {
  for (let p = start; p < start + 50; p++) {
    const ok = await new Promise((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(false));
      s.listen(p, () => s.close(() => resolve(true)));
    });
    if (ok) return p;
  }
  throw new Error(`No free port found from ${start} to ${start + 49}.`);
}

function say(msg = "") {
  console.log(msg);
}
function step(msg) {
  console.log(`\n> ${msg}`);
}
function die(msg) {
  console.error(`\nSomething went wrong:\n  ${msg}\n`);
  process.exitCode = 1;
  cleanup();
  setTimeout(() => process.exit(1), 100);
}

const children = [];
let stopping = false;
function cleanup() {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    try {
      c.kill();
    } catch {
      // already gone
    }
  }
}
process.on("SIGINT", () => {
  say("\nStopping Deca. Bye!");
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
process.on("exit", cleanup);

/** Run npm quietly: a dot every few seconds, and the details only if it fails. */
function quiet(args, cwd) {
  return new Promise((resolve) => {
    const p = spawn("npm", args, { cwd, shell: win, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const add = (d) => {
      out = (out + d).slice(-6000);
    };
    p.stdout.on("data", add);
    p.stderr.on("data", add);
    const tick = setInterval(() => process.stdout.write("."), 2500);
    const end = (ok) => {
      clearInterval(tick);
      process.stdout.write("\n");
      if (!ok) say(out);
      resolve(ok);
    };
    p.on("close", (code) => end(code === 0));
    p.on("error", () => end(false));
  });
}

async function setup() {
  if (!existsSync(join(SERVER, "node_modules", "ws"))) {
    step("First time only: installing the small part the server needs (about a minute)...");
    if (!(await quiet(["install", "--omit=dev", "--no-audit", "--no-fund"], SERVER))) throw new Error("Could not install the server's files. Check your internet connection and try again.");
  }
  if (!existsSync(join(CLIENT, "dist", "index.html"))) {
    if (!existsSync(join(CLIENT, "package.json"))) throw new Error("The app is missing. Download Deca again from the page you got it from.");
    step("First time only: building the app (a few minutes, needs internet)...");
    if (!existsSync(join(CLIENT, "node_modules")) && !(await quiet(["ci", "--no-audit", "--no-fund"], CLIENT))) throw new Error("Could not install the app's tools. Check your internet connection and try again.");
    if (!(await quiet(["run", "build"], CLIENT))) throw new Error("Could not build the app.");
  }
}

async function waitFor(url, ms, alive) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (alive && !alive()) return false;
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function download(url, to) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
  const total = Number(res.headers.get("content-length")) || 0;
  let got = 0;
  let shown = -1;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    got += chunk.length;
    if (total) {
      const pct = Math.floor((got / total) * 10) * 10;
      if (pct !== shown) {
        shown = pct;
        process.stdout.write(`  ${pct}%\r`);
      }
    }
  });
  await pipeline(body, createWriteStream(to));
  say("  done      ");
}

async function findCloudflared() {
  if (process.env.DECA_TUNNEL_BIN) return process.env.DECA_TUNNEL_BIN; // for testing or a custom install
  const asset = cloudflaredAsset(process.platform, process.arch);
  const found = spawnSync(win ? "where" : "which", ["cloudflared"], { encoding: "utf8" });
  if (found.status === 0 && found.stdout.trim()) return found.stdout.trim().split(/\r?\n/)[0];
  if (!asset) throw new Error(`No tunnel program is available for this computer (${process.platform}/${process.arch}).`);
  const target = join(BIN, asset.name);
  if (existsSync(target)) return target;
  mkdirSync(BIN, { recursive: true });
  step("First time only: downloading the free Cloudflare tunnel program that makes your public link...");
  if (asset.kind === "tgz") {
    const tgz = join(BIN, "cloudflared.tgz");
    await download(asset.url, tgz);
    const t = spawnSync("tar", ["xzf", tgz, "-C", BIN, asset.name], { stdio: "inherit" });
    rmSync(tgz, { force: true });
    if (t.status !== 0) throw new Error("Could not unpack the tunnel program.");
  } else {
    await download(asset.url, target);
  }
  if (!win) chmodSync(target, 0o755);
  return target;
}

/** Start the tunnel; resolves with the public address once it is actually connected. */
function startTunnel(bin, port) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      return reject(e);
    }
    children.push(child);
    let url = "";
    let buf = "";
    let settled = false;
    const done = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(v);
    };
    const onData = (d) => {
      buf += d.toString();
      url ||= /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buf)?.[0] ?? "";
      if (url && /Registered tunnel connection/.test(buf)) done(resolve, url);
      if (buf.length > 20000) buf = buf.slice(-4000);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e) => done(reject, e));
    child.on("exit", () => {
      if (!settled) done(reject, new Error("The tunnel program stopped."));
      else if (!stopping) {
        say("\nThe public link stopped working (internet dropped?). Close this window and start again.");
      }
    });
    const timer = setTimeout(() => done(reject, new Error("The public link took too long to start.")), 45000);
  });
}

function copyToClipboard(text) {
  const cmd = process.platform === "darwin" ? ["pbcopy"] : win ? ["clip"] : ["sh", "-c", "wl-copy || xclip -selection clipboard || xsel -b"];
  try {
    const p = spawnSync(cmd[0], cmd.slice(1), { input: text, stdio: ["pipe", "ignore", "ignore"] });
    return p.status === 0;
  } catch {
    return false;
  }
}

function openBrowser(url) {
  try {
    if (process.platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    else if (win) spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
    else spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // the link is printed anyway
  }
}

async function main() {
  const args = process.argv.slice(2);
  const local = args.includes("--local");
  const noOpen = args.includes("--no-open");
  const portArg = args.indexOf("--port");
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18) throw new Error(`Your Node.js is too old (${process.versions.node}). Install the current version from https://nodejs.org and try again.`);

  say("");
  say("  Deca. A room you carry in a link.");
  await setup();

  mkdirSync(RUN, { recursive: true });
  const port = await freePort(portArg >= 0 ? Number(args[portArg + 1]) || 8080 : 8080);
  const log = openSync(join(RUN, "server.log"), "w");
  step("Starting Deca...");
  const server = spawn(process.execPath, ["server.js"], { cwd: SERVER, env: { ...process.env, PORT: String(port) }, stdio: ["ignore", log, log] });
  closeSync(log);
  children.push(server);
  let serverDown = false;
  server.on("exit", (code) => {
    serverDown = true;
    if (!stopping) die(`Deca stopped (code ${code}). Details: ${join(RUN, "server.log")}`);
  });
  if (!(await waitFor(`http://127.0.0.1:${port}/healthz`, 15000, () => !serverDown))) throw new Error(`Deca did not start. Details: ${join(RUN, "server.log")}`);

  let link = `http://localhost:${port}`;
  let public_ = false;
  if (!local) {
    try {
      const bin = await findCloudflared();
      step("Making your public link (a few seconds)...");
      link = await startTunnel(bin, port);
      public_ = true;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      say(`\nCould not make a public link: ${/ENOENT|EACCES/.test(why) ? "the tunnel program could not be started." : why}`);
      say("Deca still works on this computer, but friends cannot join until a link exists. Check your internet and start again.");
    }
  }
  writeFileSync(join(RUN, "url"), link + "\n");

  const copied = public_ && copyToClipboard(link);
  say("");
  say("  ============================================================");
  say("   Deca is running.");
  say("");
  say(public_ ? "   Share this link with your friends:" : "   Open Deca here (this computer only):");
  say(`     ${link}`);
  say("");
  if (copied) say("   (The link is copied. Paste it into a chat to send it.)");
  say("   Open the link yourself too: you are the host.");
  say("   Keep this window open. Close it to stop Deca.");
  say("  ============================================================");
  say("");
  if (public_) say("  A new link can take up to a minute to start working for other people. If it says \"not found\", wait and refresh.");
  if (!noOpen) openBrowser(link);
  await new Promise(() => {});
}

// Run only when started directly (a test can import the helpers above without starting anything).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => die(e instanceof Error ? e.message : String(e)));
