import assert from "node:assert";
import net from "node:net";
import { cloudflaredAsset, freePort } from "../../scripts/start.mjs";
const t = (p, a) => cloudflaredAsset(p, a);
assert.equal(t("darwin", "arm64").url.endsWith("cloudflared-darwin-arm64.tgz"), true); assert.equal(t("darwin", "arm64").kind, "tgz");
assert.equal(t("darwin", "x64").url.endsWith("cloudflared-darwin-amd64.tgz"), true);
assert.equal(t("linux", "x64").url.endsWith("cloudflared-linux-amd64"), true); assert.equal(t("linux", "x64").kind, "bin");
assert.equal(t("linux", "arm64").url.endsWith("cloudflared-linux-arm64"), true);
assert.equal(t("linux", "arm").url.endsWith("cloudflared-linux-arm"), true);
assert.equal(t("win32", "x64").url.endsWith("cloudflared-windows-amd64.exe"), true); assert.equal(t("win32", "x64").name, "cloudflared.exe");
assert.equal(t("win32", "ia32").url.endsWith("cloudflared-windows-386.exe"), true);
assert.equal(t("win32", "arm64"), null, "no native Windows ARM build: say so rather than download the wrong thing");
assert.equal(t("freebsd", "x64"), null); assert.equal(t("darwin", "ia32"), null);
for (const p of ["darwin", "linux", "win32"]) for (const a of ["x64", "arm64"]) { const s = t(p, a); if (s) assert.ok(s.url.startsWith("https://github.com/cloudflare/cloudflared/releases/latest/download/")); }
console.log("ok: right cloudflared file for every system, and null (clear error) for unsupported ones");
// freePort skips busy ports
const hold = await new Promise((r) => { const s = net.createServer(); s.listen(8200, () => r(s)); });
const hold2 = await new Promise((r) => { const s = net.createServer(); s.listen(8201, () => r(s)); });
assert.equal(await freePort(8200), 8202); hold.close(); hold2.close();
await new Promise((r) => setTimeout(r, 100)); assert.equal(await freePort(8200), 8200);
console.log("ok: freePort skips busy ports and returns the first free one");
process.exit(0);
