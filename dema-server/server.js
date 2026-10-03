const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

// Signaling only: room membership + relaying offer/answer/ICE. Never sees chat or file data.
// If ../dema-client/dist exists (after `npm run build`), it also serves the client, so one
// process on one port is the whole app in production.
const PORT = process.env.PORT || 8080;
const DIST = path.join(__dirname, "../dema-client/dist");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

// Games panel: every folder in ./games with an index.html is offered to the client. These are plain
// static folders (the project only ships the sample); add your own by dropping a folder in.
const GAMES = path.join(__dirname, "games");
function listGames() {
  try {
    return fs
      .readdirSync(GAMES, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(GAMES, d.name, "index.html")))
      .map((d) => {
        let meta = {};
        try {
          meta = JSON.parse(fs.readFileSync(path.join(GAMES, d.name, "game.json"), "utf8"));
        } catch {
          // no game.json: the folder name is the title
        }
        return { d, meta };
      })
      // a game that needs a data file (Freedoom's 28 MB .wad is not in the repository) is not offered until the file is there
      .filter(({ d, meta }) => !Array.isArray(meta.requires) || meta.requires.every((f) => typeof f === "string" && !f.includes("..") && fs.existsSync(path.join(GAMES, d.name, f))))
      .map(({ d, meta }) => {
        const text = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
        return {
          id: d.name,
          title: text(meta.title, 60) || d.name,
          heavy: meta.heavy === true,
          note: text(meta.note, 200),
          controls: Array.isArray(meta.controls) ? meta.controls.slice(0, 12).map((c) => text(c, 80)).filter(Boolean) : [],
        };
      });
  } catch {
    return [];
  }
}

// Content Security Policy for the app itself (not /games/, whose pages bring their own inline scripts).
// Allows exactly what the app uses: YouTube's player and API, Google Fonts, any image (link previews),
// blob/data media, and the signaling WebSocket.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src * data: blob:",
  "media-src * blob: data:",
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
  "connect-src 'self' ws: wss: https://www.youtube.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

const server = http.createServer((req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (!req.url.startsWith("/games/")) res.setHeader("Content-Security-Policy", CSP);
  if (req.url === "/healthz") return res.end("ok");
  if (req.url === "/games.json") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify(listGames()));
  }
  if (req.url.startsWith("/games/")) {
    // /games/<id>/<file...>, never outside ./games
    const rel = decodeURIComponent(req.url.split("?")[0].slice("/games/".length));
    const file = path.join(GAMES, path.normalize(rel));
    if (!file.startsWith(GAMES + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404;
      return res.end("not found");
    }
    res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
    return fs.createReadStream(file).pipe(res);
  }
  if (req.url === "/ice") {
    res.setHeader("Content-Type", "application/json");
    return res.end(process.env.ICE_SERVERS || JSON.stringify([{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }]));
  }
  if (!fs.existsSync(DIST)) {
    res.statusCode = 404;
    return res.end("Client not built. Run `npm run build` in dema-client.");
  }
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(DIST, path.normalize(urlPath));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, "index.html"); // SPA fallback
  }
  res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});

// Slow-request defences (Node's defaults are generous).
server.headersTimeout = 15000;
server.requestTimeout = 30000;
server.maxHeadersCount = 50;
// ---------------------------------------------------------------------------------------------
// Signaling. Everything below limits what one abusive client can do to everyone else.
// ---------------------------------------------------------------------------------------------
const num = (name, fallback) => Number(process.env[name] ?? fallback);
const MAX_PAYLOAD = num("MAX_PAYLOAD", 64 * 1024); // signaling messages are tiny; a 100 MB frame is an attack
const MAX_SOCKETS = num("MAX_SOCKETS", 4000);
const MAX_ROOMS = num("MAX_ROOMS", 1000);
const MAX_PER_IP = num("MAX_PER_IP", 40); // sockets per client address
const JOINS_PER_MIN = num("JOINS_PER_MIN", 60); // join attempts per address per minute (also slows room-id guessing)
const MSG_BURST = num("MSG_BURST", 250); // per-socket token bucket: a joining browser legitimately sends bursts of candidates
const MSG_PER_SEC = num("MSG_PER_SEC", 100);
const JOIN_TIMEOUT_MS = num("JOIN_TIMEOUT_MS", 5000);
// Optional: only accept sockets from these origins (comma separated), e.g. https://deca.example.com
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean);
const ID = /^[A-Za-z0-9_-]{4,64}$/;

const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD });

// Behind Cloudflare / a host's proxy the real address is in a header. Only trust these when the server
// is reachable ONLY through that proxy (as with a tunnel or a hosted service), or they can be spoofed.
const clientIp = (req) =>
  req.headers["cf-connecting-ip"] || (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
const perIp = new Map(); // ip -> open sockets
const joinLog = new Map(); // ip -> recent join timestamps

// Drop connections that stopped answering (sleeping laptops, dead networks) so their
// "left" is announced promptly instead of never.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  const cutoff = Date.now() - 60000;
  for (const [ip, ts] of joinLog) {
    const recent = ts.filter((t) => t > cutoff);
    if (recent.length) joinLog.set(ip, recent);
    else joinLog.delete(ip);
  }
}, 20000);

// A dropped socket (tunnel hiccup, wifi blip, sleeping laptop) must not read as "left": hold the
// person's place for a moment so the same browser session can slip back in unnoticed.
const GRACE_MS = num("GRACE_MS", 10000);
// Everyone connects directly to everyone, so links grow with the square of the room size
// (n people = n*(n-1)/2 links). Past a handful of people browsers struggle; cap it. 0 = no cap.
const MAX_PEERS = num("MAX_PEERS", 8);

// spaceId -> { hostId, locked, peers: Map<peerId, { ws, name, session, key, timer }> }
const rooms = new Map();

const send = (ws, msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
const refuse = (ws, reason, code = 1008) => {
  send(ws, { type: "refused", reason });
  ws.close(code, reason);
};

function removePeer(spaceId, peerId) {
  const room = rooms.get(spaceId);
  const p = room?.peers.get(peerId);
  if (!p) return;
  clearTimeout(p.timer);
  room.peers.delete(peerId);
  for (const q of room.peers.values()) send(q.ws, { type: "peer-left", peerId });
  if (room.peers.size === 0) rooms.delete(spaceId);
  console.log(`[${spaceId}] ${peerId} left (${room.peers.size} peers)`);
}

wss.on("connection", (ws, req) => {
  // A socket error (an oversize frame, a reset, a malformed frame) must never become an uncaught
  // exception: without a listener Node would take the whole server down. The socket is just closed.
  ws.on("error", () => ws.terminate());
  const ip = clientIp(req);
  if (ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(req.headers.origin || "")) return ws.close(1008, "origin");
  if (wss.clients.size > MAX_SOCKETS) return ws.close(1013, "busy");
  const open = (perIp.get(ip) ?? 0) + 1;
  perIp.set(ip, open);
  ws.on("close", () => perIp.set(ip, Math.max(0, (perIp.get(ip) ?? 1) - 1)));
  if (open > MAX_PER_IP) return ws.close(1013, "too many connections");

  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  let spaceId = null;
  let peerId = null;
  // Say hello (join) within a few seconds, or go away: idle sockets are free to hold open otherwise.
  const joinTimer = setTimeout(() => !spaceId && ws.close(1008, "no join"), JOIN_TIMEOUT_MS);
  ws.on("close", () => clearTimeout(joinTimer));

  // Token bucket: refills at MSG_PER_SEC, holds MSG_BURST. A flood gets the socket closed.
  let tokens = MSG_BURST;
  let refilled = Date.now();

  ws.on("message", (raw) => {
    const now = Date.now();
    tokens = Math.min(MSG_BURST, tokens + ((now - refilled) / 1000) * MSG_PER_SEC);
    refilled = now;
    if (--tokens < 0) return ws.close(1008, "rate limit");

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "ping") return send(ws, { type: "pong" });

    if (msg.type === "join") {
      if (spaceId) return; // one join per socket
      if (
        !ID.test(String(msg.spaceId)) ||
        !ID.test(String(msg.peerId)) ||
        typeof msg.name !== "string" ||
        msg.name.length > 32 ||
        typeof msg.key !== "string" ||
        msg.key.length < 16 ||
        msg.key.length > 128 ||
        (msg.session != null && (typeof msg.session !== "string" || msg.session.length > 64))
      ) {
        return ws.close(1008, "bad join");
      }
      const joins = (joinLog.get(ip) ?? []).filter((t) => t > now - 60000);
      joins.push(now);
      joinLog.set(ip, joins);
      if (joins.length > JOINS_PER_MIN) return ws.close(1013, "too many joins");

      let room = rooms.get(msg.spaceId);
      const stale = room?.peers.get(msg.peerId);
      // Identity is bound to a secret only its owner knows. Knowing someone's id (everyone in the room
      // does) is not enough to take their place.
      if (stale && stale.key !== msg.key) return refuse(ws, "taken");
      if (!room) {
        if (rooms.size >= MAX_ROOMS) return refuse(ws, "busy", 1013);
        // First peer in a space is its creator/host.
        room = { hostId: msg.peerId, locked: false, peers: new Map() };
        rooms.set(msg.spaceId, room);
      }
      // A locked room turns newcomers away; anyone already in it (reconnect, refresh, same identity) is fine.
      if (!stale && room.locked) return refuse(ws, "locked", 1008);
      // A full room turns newcomers away. Someone already in it is never counted twice or locked out.
      if (!stale && MAX_PEERS > 0 && room.peers.size >= MAX_PEERS) {
        send(ws, { type: "full", max: MAX_PEERS });
        ws.close();
        if (room.peers.size === 0) rooms.delete(msg.spaceId);
        console.log(`[${msg.spaceId}] ${msg.peerId} turned away: room is full (${MAX_PEERS})`);
        return;
      }
      spaceId = msg.spaceId;
      peerId = msg.peerId;
      clearTimeout(joinTimer);

      // Same browser session coming back after a dropped socket: re-attach silently, nobody is told.
      const resumed = !!stale && !!msg.session && stale.session === msg.session;
      if (stale) {
        clearTimeout(stale.timer);
        if (stale.ws !== ws && stale.ws.readyState === stale.ws.OPEN) {
          // The same identity opened in another tab took over: tell the old one so it does not fight back.
          if (!resumed) send(stale.ws, { type: "replaced" });
          stale.ws.close();
        }
      }

      const existing = [...room.peers.entries()]
        .filter(([id]) => id !== peerId)
        .map(([id, p]) => ({ peerId: id, name: p.name }));

      room.peers.set(peerId, { ws, name: msg.name, session: msg.session, key: msg.key, timer: null });

      send(ws, { type: "joined", hostId: room.hostId, peers: existing, resumed, max: MAX_PEERS, locked: room.locked });
      if (!resumed) {
        for (const [id, p] of room.peers) {
          if (id !== peerId) send(p.ws, { type: "peer-joined", peerId, name: msg.name });
        }
      }
      console.log(`[${spaceId}] ${peerId} ${resumed ? "resumed" : "joined"} (${room.peers.size} peers)`);
      return;
    }

    if (!spaceId) return; // everything below needs a completed join
    const room = rooms.get(spaceId);
    const me = room?.peers.get(peerId);
    if (!room || me?.ws !== ws) return;

    if (msg.type === "leave") {
      // A deliberate leave is announced at once; no grace period.
      removePeer(spaceId, peerId);
      return;
    }

    if (msg.type === "lock") {
      // Members decide who is let in next. (Who counts as host is decided by the signed event log, which
      // the server cannot read, so any member may toggle; it only ever affects NEW arrivals.)
      room.locked = !!msg.locked;
      for (const p of room.peers.values()) send(p.ws, { type: "lock-state", locked: room.locked });
      return;
    }

    if (msg.type === "signal") {
      const target = room.peers.get(msg.to);
      if (target) send(target.ws, { type: "signal", from: peerId, payload: msg.payload, gen: msg.gen });
    }
  });

  ws.on("close", () => {
    const p = rooms.get(spaceId)?.peers.get(peerId);
    if (!p || p.ws !== ws) return; // already replaced by a newer socket
    clearTimeout(p.timer);
    p.timer = setTimeout(() => removePeer(spaceId, peerId), GRACE_MS);
  });
});

// Graceful shutdown: tell every client the socket is going away, then stop accepting.
function shutdown() {
  for (const ws of wss.clients) ws.close(1001, "server shutting down");
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.on("uncaughtException", (err) => console.error("uncaught:", err));
process.on("unhandledRejection", (err) => console.error("unhandled:", err));

server.listen(PORT, "0.0.0.0", () => console.log(`Deca on http://0.0.0.0:${PORT} (ws at any path)`));
