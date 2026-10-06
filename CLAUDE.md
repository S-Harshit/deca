# Deca

Browser-only "rooms you carry in a link": chat, files, calls, music, games, all peer to peer over WebRTC. A small Node server only introduces peers. **`docs/SPEC.md` is the source of truth** for behaviour; keep it in step with any change.

## Layout
- `dema-client/`: Vite + React + TypeScript (`src/`). Core files: `mesh.ts` (WebRTC + signaling), `space.ts` (state, sync, features), `log.ts` (event types + `derive()`), `identity.ts` / `signing.ts` (Ed25519), `components/`.
- `dema-server/server.js`: signaling + static hosting + `/games` + `/ice`. Plain Node, one dependency (`ws`).
- `scripts/deca.sh`: `./deca.sh up|down|status|logs` builds, starts the server and a Cloudflare quick tunnel (developer script, needs bash).
- `scripts/start.mjs` + `Start Deca.command` / `Start Deca.bat` + `START-HERE.md`: the launcher for non-technical people (plain Node, no dependencies, Mac/Windows/Linux). `scripts/package.mjs` builds `deca-ready.zip` (pre-built app, 0.2 MB). Keep user-facing messages in plain words; test changes from a fresh copy with no `node_modules`/`dist`.

## Commands
```
cd dema-client && npx tsc -b && npx eslint src && npm run build   # must all be clean
./deca.sh up        # serves the BUILT client from dema-client/dist, so rebuild after client changes
cd dema-client && npm run dev   # https dev server (HTTP=1 for plain http); proxies /ws /ice /games to :8080
```
The server serves `dist/` from disk, so a rebuild is live immediately; changes to `server.js` need `./deca.sh down && ./deca.sh up`.

`npm run build:static` (repo root) builds the no-server site (`VITE_STATIC=1`) into `dist-static/`; keep fetches relative (`import.meta.env.BASE_URL`) so it works under a sub-path. Codes in connect-by-code mode are signed and need host approval: never accept a code or relayed `sig` without `verifyText`.

## Adding a sidebar panel
Register it with `registerWidget()` (`src/widgets.tsx`; see the bottom of `App.tsx` for the three built-ins) and put a `<SlotToggle />` first in its `<h3>` so it gets the fold arrow. Plans for third-party plugins are in `docs/PLUGINS.md`: keep new shared features expressible with its primitives (last-writer-wins state, signed events, signals) rather than adding another one-off control message like `music`.

## Connect-by-code mode
A room can run with no signaling server: `localSignal.ts` is an in-browser stand-in for `server.js` that `Mesh` talks to through a socket-like surface (`Sock` in `mesh.ts`); it relays connection messages over open links and only turns a message into a hand-carried code when no link can carry it. When changing `mesh.ts` signaling, keep the server path and this one working (`bycode.cjs`-style tests: no WebSocket, no `/ice`). Dialogs rendered inside the sidebar must use a portal (the phone drawer's transform moves `position: fixed` children off-screen).

## Rules that are easy to break
- **Events are signed and verified.** Never add an event path that skips `verifyEvent`, and never trust `author`/`by` fields from the wire. New event types go in `EventType`, the `TYPES` set in `log.ts`, and a validity rule in `derive()`.
- **Non-event control messages** (`music`, `media`, `links`, ...) are not signed: validate and sanitise them on receipt (`music.ts` `sanitize`).
- **Server limits are deliberate** (`MAX_PAYLOAD`, `MAX_PER_IP`, `JOINS_PER_MIN`, token bucket, `MAX_PEERS`...). Do not loosen them to make a test pass. Every socket needs an `error` listener or an oversize frame crashes the process.
- **Live-only effects** (coin, rock-paper-scissors, air horn) fire only for events that arrive live (`fresh` in `space.ts`); history sync must never replay a sound or animation.
- **Theme CSS is scoped.** Prefer new class names; a clash once put a 420 px circle in the header (`.ring`). After any layout CSS change, check the header and a running call.
- **Video waits for the data channel** (`syncTracks` only attaches tracks to open links), and tiles show only for connected peers.
- **Games** are static folders in `dema-server/games/<id>/`. Only `snake`, `platformer`, and `freedoom` (without its `.wad`) are tracked; everything else there is git-ignored on purpose. Never commit or fetch copyrighted game assets (the FullScreenMario remake is under a DMCA takedown).

## Testing
Tests live in `tests/` (see `tests/README.md`): unit tests in `unit/`, Playwright browser tests in `browser/`. `cd tests && npm install && node run.mjs [quick|unit|browser|<words>]` (the root also has `npm test`). The runner starts the server from the BUILT client (`dema-client/dist`), so rebuild the client first. Browser suites run **one at a time** (one server, per-address limits by design). When testing the UI, assert on behaviour and measure layout; do not rely on screenshots alone. Add a test for each feature or bug fix, in the file for its topic, and keep `docs/SPEC.md` saying what is verified.

## Conventions
- Keep comments to the *why*; no emojis in code. TypeScript is strict (`noUnusedLocals`, `erasableSyntaxOnly`: no constructor parameter properties).
- The page needs a secure context (https or localhost) for camera and for signing keys.
- Prefer small, scoped changes; this app has had visual regressions from broad CSS edits.
