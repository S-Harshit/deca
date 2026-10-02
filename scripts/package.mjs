#!/usr/bin/env node
/**
 * Builds deca-ready.zip: the app already built, the server's one dependency included, the one-click launchers
 * and the plain guide. A person who unzips it only needs Node.js: no build, no install, no terminal commands.
 *
 *   node scripts/package.mjs
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "deca-ready.zip");
const STAGE = join(ROOT, ".package", "Deca");
const win = process.platform === "win32";
const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: win });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
};

console.log("Building the app...");
if (!existsSync(join(ROOT, "dema-client", "node_modules"))) run("npm", ["ci", "--no-audit", "--no-fund"], join(ROOT, "dema-client"));
run("npm", ["run", "build"], join(ROOT, "dema-client"));

rmSync(join(ROOT, ".package"), { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

// server: code, games (only the tracked ones, never the big game file), and its single dependency
const server = join(STAGE, "dema-server");
cpSync(join(ROOT, "dema-server"), server, {
  recursive: true,
  filter: (src) => !/node_modules|\.wad$/.test(src),
});
for (const g of readdirSync(join(server, "games"))) if (!["snake", "platformer", "freedoom"].includes(g)) rmSync(join(server, "games", g), { recursive: true, force: true });
run("npm", ["ci", "--omit=dev", "--omit=optional", "--no-audit", "--no-fund"], server);

// client: only what is served
mkdirSync(join(STAGE, "dema-client"), { recursive: true });
cpSync(join(ROOT, "dema-client", "dist"), join(STAGE, "dema-client", "dist"), { recursive: true });

mkdirSync(join(STAGE, "scripts"), { recursive: true });
cpSync(join(ROOT, "scripts", "start.mjs"), join(STAGE, "scripts", "start.mjs"));
for (const f of ["Start Deca.command", "Start Deca.bat", "START-HERE.md", "LICENSE"]) if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(STAGE, f));
writeFileSync(join(STAGE, "package.json"), JSON.stringify({ name: "deca", private: true, type: "module", scripts: { start: "node scripts/start.mjs" }, engines: { node: ">=18" } }, null, 2) + "\n");

rmSync(OUT, { force: true });
if (win) run("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${STAGE}' -DestinationPath '${OUT}'`], ROOT);
else run("zip", ["-qr", OUT, "Deca"], join(ROOT, ".package"));
rmSync(join(ROOT, ".package"), { recursive: true, force: true });
const mb = (statSync(OUT).size / 1024 / 1024).toFixed(1);
console.log(`\nDone: ${OUT} (${mb} MB). Share this file; people unzip it and double-click "Start Deca".`);
