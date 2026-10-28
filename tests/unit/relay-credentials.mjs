// The server's /ice: public STUN by default, a TURN relay with short-lived credentials minted from Cloudflare when a key is configured,
// reused for hours, and never failing the page when the provider is down. A fake provider stands in for Cloudflare.
import assert from "node:assert";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const server = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dema-server", "server.js");
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const boot = async (env) => {
  const port = await new Promise((r) => { const s = http.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
  const p = spawn(process.execPath, [server], { env: { ...process.env, PORT: String(port), ...env }, stdio: ["ignore", "ignore", "pipe"] });
  let err = ""; p.stderr.on("data", (d) => (err += d));
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/healthz`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  return { port, kill: () => p.kill(), err: () => err };
};
const ice = async (s) => (await fetch(`http://127.0.0.1:${s.port}/ice`)).json();

// plain: STUN only
{
  const s = await boot({});
  const list = await ice(s);
  assert.ok(list.length >= 1 && list.every((x) => String(x.urls).startsWith("stun:")) && !list.some((x) => x.credential), "no key: public STUN only");
  s.kill();
}
// a hand-written list wins, and bad JSON does not break the page
{
  const s = await boot({ ICE_SERVERS: JSON.stringify([{ urls: "turn:t.example:3478", username: "u", credential: "c" }]) });
  assert.equal((await ice(s))[0].username, "u"); s.kill();
  const bad = await boot({ ICE_SERVERS: "{not json" });
  assert.ok((await ice(bad)).length >= 1, "invalid ICE_SERVERS falls back to STUN"); bad.kill();
}
// Cloudflare-style provider
{
  let calls = 0, mode = "ok", seen = null;
  const fake = http.createServer((req, res) => {
    calls++; let body = ""; req.on("data", (d) => (body += d));
    req.on("end", () => {
      seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body || "{}") };
      if (mode === "down") { res.statusCode = 500; return res.end("no"); }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478", "turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:5349?transport=tcp"], username: "user-1", credential: "secret-1" }] }));
    });
  });
  const fp = await listen(fake);
  const s = await boot({ TURN_KEY_ID: "key123", TURN_KEY_API_TOKEN: "tok", TURN_API_BASE: `http://127.0.0.1:${fp}` });
  const a = await Promise.all([ice(s), ice(s), ice(s)]);
  assert.ok(a.every((l) => l.some((x) => x.username === "user-1" && x.credential === "secret-1")), "relay credentials are served");
  assert.ok(a[0].some((x) => String(x.urls).startsWith("stun:")), "and STUN stays in the list");
  assert.equal(calls, 1, "three simultaneous visitors cost one request to the provider");
  await ice(s); assert.equal(calls, 1, "and the answer is reused");
  assert.equal(seen.url, "/v1/turn/keys/key123/credentials/generate-ice-servers"); assert.equal(seen.auth, "Bearer tok"); assert.ok(seen.body.ttl >= 3600, "a day-scale lifetime");
  s.kill();
  mode = "down";
  const d = await boot({ TURN_KEY_ID: "key123", TURN_KEY_API_TOKEN: "tok", TURN_API_BASE: `http://127.0.0.1:${fp}` });
  const down = await ice(d);
  assert.ok(down.length >= 1 && !down.some((x) => x.credential), "provider down: the page still gets STUN");
  assert.ok(!d.err().includes("tok"), "the token is never logged"); d.kill();
  fake.close();
}
console.log("ok: /ice serves STUN, a hand-written list, or minted relay credentials (one provider call, reused, failure-safe)");
process.exit(0);
