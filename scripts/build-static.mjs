// Builds Deca for static hosting (GitHub Pages, Vercel, Netlify, any folder of files): no server at all.
// Output: dist-static/. People join by exchanging codes ("connect by code"), so nothing needs a backend.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const client = join(root, "dema-client");
const out = join(root, "dist-static");
// Only games that are free to redistribute (the others in games/ are the owner's own, git-ignored).
const GAMES = ["snake", "platformer", "freedoom"];

if (!existsSync(join(client, "node_modules"))) {
  const i = spawnSync("npm", ["ci"], { cwd: client, stdio: "inherit", shell: true });
  if (i.status) process.exit(i.status);
}
rmSync(out, { recursive: true, force: true });
const b = spawnSync("npm", ["run", "build", "--", "--outDir", out, "--emptyOutDir"], { cwd: client, stdio: "inherit", shell: true, env: { ...process.env, VITE_STATIC: "1" } });
if (b.status) process.exit(b.status);

// Freedoom (BSD) keeps its 28 MB data file out of the repository: fetch it like get-wad.sh does, or leave the game out.
const freedoom = join(root, "dema-server", "games", "freedoom");
if (!existsSync(join(freedoom, "freedoom1.wad"))) {
  const r = spawnSync("bash", [join(freedoom, "get-wad.sh")], { stdio: "inherit" });
  if (r.status) console.warn("\nCould not download Freedoom's data file; the game is left out of this build.");
}

const list = [];
for (const id of GAMES) {
  const from = join(root, "dema-server", "games", id);
  if (!existsSync(join(from, "index.html")) || (id === "freedoom" && !existsSync(join(from, "freedoom1.wad")))) continue;
  cpSync(from, join(out, "games", id), { recursive: true });
  let meta = {};
  try {
    meta = JSON.parse(readFileSync(join(from, "game.json"), "utf8"));
  } catch {
    // no game.json: the folder name is the title
  }
  list.push({ id, title: meta.title || id, heavy: meta.heavy === true, note: meta.note || "", controls: Array.isArray(meta.controls) ? meta.controls : [] });
}
writeFileSync(join(out, "games.json"), JSON.stringify(list));
writeFileSync(join(out, ".nojekyll"), ""); // GitHub Pages: serve every file as is
console.log(`\nStatic site ready in dist-static/ (${readdirSync(out).length} entries, games: ${list.map((g) => g.id).join(", ")}).`);
