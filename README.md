# Deca

> **Built entirely by AI.** Every line of code, the tests and the documentation in this repository were written by Claude (Anthropic) working with a human who set the direction and tried the results. Read the code and the security notes in [SPEC.md](docs/SPEC.md) before relying on it for anything sensitive.

A room you carry in a link. Open Deca, create a space, send the link, and you're in a private room with chat, file sharing, video calls, screen share, synced music and small games. It runs peer to peer in the browser (WebRTC). A tiny Node server only introduces people to each other. It never sees messages or files, and it stores nothing.

- **No accounts.** Your identity is a keypair generated in your browser. Every event is signed, so nobody can speak as someone else.
- **Private by default.** Chat, files and calls go directly between browsers. Rooms hold up to 8 people.
- **One process to host.** The Node server also serves the built web app.

## Features

Chat (code blocks with syntax colours, inline image previews) · files up to 50 MB · export a room to a signed zip and import it back later (read-only history) · a personal wallpaper that can tint the accent · video, audio and screen share · music everyone hears together (YouTube links) · host controls (mute chat/files, lock the room, wake everyone up) · coin flip, rock-paper-scissors and a random "blame someone" button · a games panel · themes · automatic reconnect and host succession.

Want to build a panel (a poll, a whiteboard, a game)? See [PLUGINS.md](docs/PLUGINS.md) for the plugin spec. [SPEC.md](docs/SPEC.md) is the full design: concepts, sync model, protocol, security, limits.

## Quick start

**Not technical? Read [START-HERE.md](START-HERE.md).** It is one page: install Node.js once, unzip, double-click `Start Deca`, send the link it shows.

- **Easiest:** download `deca-ready.zip` from the project's Releases page (the app is already built; no install or build step), unzip it, and double-click **`Start Deca.command`** (Mac) or **`Start Deca.bat`** (Windows). Your only prerequisite is [Node.js](https://nodejs.org) 18 or newer, and the start file opens its download page if it is missing.
- **From the source code:** the same two files work in a plain download or clone of this repository. The first run installs and builds everything itself (a few minutes), with a calm progress line instead of build logs.
- **Terminal, any system (Mac, Windows, Linux):** `node scripts/start.mjs` (public link for friends), `node scripts/start.mjs --local` (this computer only), `--port 9000`, `--no-open`.

What the launcher does: sets itself up on first run, starts Deca, downloads the free Cloudflare tunnel program if you do not have it (a plain public download from github.com: normal internet, no GitHub account or login), prints the public link, copies it to your clipboard and opens it. Closing its window stops everything. If the public link cannot be made it says so and keeps working on this computer. A brand-new link can take up to a minute to resolve on some networks; reload if it says "not found". The link changes on every start.

**No server at all?** On the first screen choose **No server? Connect by code**. People join by exchanging a short code each way (copy, paste, send it any way you like), and everyone else in the room is then connected automatically. It works when the usual way is down. It still uses public STUN servers (free) to find your address, and strict networks may still need a relay. Details and limits: [docs/SPEC.md](docs/SPEC.md#connect-by-code-no-signaling-server).

Why a public link and not your local network address? Browsers only allow the camera and the signing keys Deca uses on `https://` or `localhost`, so a plain `http://192.168...` link will not work for other people. Use the tunnel, or put the server behind your own HTTPS (see Hosting).

No computer to leave on? Host it instead (see Hosting): the included `render.yaml` deploys it to Render's free plan from a GitHub repository in a few clicks, and the link is then permanent.

### For developers

Needs **Node 18+**, **bash**, **curl** and **tar** (macOS or Linux; on Windows use WSL) for the older script: `./deca.sh up` (public link), `./deca.sh up local` (this machine only), `./deca.sh down`. Manual start without any script: `cd dema-client && npm ci && npm run build`, then `cd ../dema-server && npm ci && node server.js`. Hot reload: `cd dema-client && npm run dev` (self-signed HTTPS, which the camera needs; `HTTP=1 npm run dev` for plain http). Build the shareable package yourself with `npm run package` (output `deca-ready.zip`); pushing a `v*` tag does it on GitHub (`.github/workflows/release.yml`) and attaches it to the release.

## Configuration

Environment variables for the server (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | listen port |
| `MAX_PEERS` | 8 | people per room (0 = no cap) |
| `GRACE_MS` | 10000 | how long a dropped member can resume |
| `ICE_SERVERS` | Google STUN | JSON list of STUN/TURN servers; add a TURN service for strict networks |
| `ALLOWED_ORIGINS` | any | comma-separated origins allowed to open the WebSocket |
| `MAX_PAYLOAD` | 64 KB | largest signaling message |
| `MAX_SOCKETS` / `MAX_ROOMS` | 4000 / 1000 | global caps |
| `MAX_PER_IP` / `JOINS_PER_MIN` | 40 / 60 | per-address limits |
| `MSG_BURST` / `MSG_PER_SEC` | 250 / 100 | per-socket message rate |
| `JOIN_TIMEOUT_MS` | 5000 | a socket that doesn't join a room in time is closed |

## Free hosting without a backend

`npm run build:static` makes `dist-static/`, a plain folder of files that works on GitHub Pages, Vercel, Netlify or any static host. In that build people join by exchanging codes ("connect by code"), so nothing needs a server. For GitHub Pages, set Settings, Pages, Source to "GitHub Actions" and push to `main` (`.github/workflows/pages.yml` does the rest). For Vercel, import the repository (`vercel.json` is included). Codes are signed, newcomers need the host's approval, and members can compare check words. Details in [SPEC.md](docs/SPEC.md#connect-by-code-no-signaling-server).

## Hosting

Any host that runs one Node process and supports WebSockets works. `render.yaml` is a ready blueprint for Render's free tier. Fly.io, Railway and Koyeb are similar, and a home machine behind a tunnel works too. The server is small (tens of MB of RAM idle) and media never passes through it. See the hosting and TURN sections of [SPEC.md](SPEC.md#8-running-and-hosting).

## Security

Signed events, per-identity server secrets, size/rate/connection limits, a Content Security Policy on the app, and no stored data. Details are in the Security section of [SPEC.md](docs/SPEC.md). It is designed for small private rooms, not as a hardened public service. Put a CDN or proxy in front if you expose it widely.

## Games

The games panel plays any static web game found in `dema-server/games/<id>/` (needs an `index.html`; optional `game.json` with `title`, `controls`, and `heavy` for games that should wait behind a Start button). Included: Snake, Pixel Hop (an original platformer), and [Freedoom](https://freedoom.github.io) (BSD-licensed; run `dema-server/games/freedoom/get-wad.sh` once to download its 28 MB data file; the engine loads from the EmulatorJS CDN, so it needs internet).

Games run on the app's origin, so only add games you trust. Don't commit games you don't have the rights to; everything under `games/` except the three above is git-ignored.

## Project layout

```
README.md, START-HERE.md   what this is; the plain-words guide for non-technical people
Start Deca.command / .bat  double-click launchers (Mac / Windows)
dema-client/               React + TypeScript + Vite web app
dema-server/               Node signaling server (ws) + static hosting, games/
docs/SPEC.md               design and protocol (the source of truth)
docs/PLUGINS.md            plugin specification (draft)
scripts/start.mjs          the launcher the double-click files run (Mac, Windows, Linux)
scripts/package.mjs        builds deca-ready.zip
scripts/build-static.mjs   builds dist-static/ for GitHub Pages / Vercel (no server)
scripts/deca.sh            developer script: build + run + public tunnel
package.json, render.yaml  npm shortcuts (npm start); one-click hosting recipe for Render
CLAUDE.md                  guidance for AI coding assistants (and a handy dev cheat sheet)
.github/                   release automation
```

Checks: `cd dema-client && npx tsc -b && npx eslint src && npm run build`.

## License

[MIT](LICENSE). Bundled third-party pieces keep their own licenses (Freedoom: BSD, see `dema-server/games/freedoom/LICENSE-Freedoom.txt`).
