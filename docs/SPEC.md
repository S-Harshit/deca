# Deca: local peer-to-peer spaces

A browser-only "room you carry in a link". People join via a link and chat, share files and images, call, and listen to music together. Everything travels peer to peer over WebRTC. A tiny WebSocket server only introduces peers; it never sees content.

Layout of the repo:
- `dema-client/`: Vite + React + TypeScript app (`src/`).
- `dema-server/`: Node signaling server (`server.js`); also serves the built client.
- `scripts/deca.sh`: one command to build, start the server and a public tunnel, and stop them.
- `render.yaml`: free-hosting blueprint.

---

## 1. Concepts

### Space = a shared, append-only event log
Every peer holds a full copy in memory; the UI is a view derived from it (`derive()` in `log.ts`). Nothing is stored anywhere once everyone leaves.

Event: `{ id, author, ts, type, payload }` with a random `id`.

| Type | Payload | Valid when |
|---|---|---|
| `joined` / `returned` | `name` | always (a member's first join / later sessions) |
| `left` | `peerId`, `joinId` | `joinId` matches the member's latest join |
| `chat` | `text` (<= 20,000 chars; the composer sends <= 16,000) | host, or `perms.chat` |
| `file_offer` | `fileId`, `name`, `size` (<= 50 MB), `type` | host, or `perms.files` |
| `coin` | `result`: `heads`/`tails` | host, or `perms.chat` |
| `rps` | `throw`: `rock`/`paper`/`scissors`, optional `vs` (event id it answers) | host, or `perms.chat` |
| `role_changed` | `hostId` | authored by the current host (automatic succession also yields one in the timeline) |
| `kick` | `peerId` | authored by the host, target is not the host |
| `perms_changed` | `chat`, `files`, `music` (missing `music` means on) | host |
| `space_closed` | none | host |
| `blame` | `target` (a peerId that has joined) | host, or `perms.chat` |
| `page_share` | `url` (http or https only, no embedded login, at most 2,000 characters) | host, or `perms.chat` |
| `archive_added` | `aid`, `sha256`, `bytes`, `events`, `from` (see Import) | host only, at most 3 per room |
| `horn` | none | host |

Events from kicked authors, and anything after `space_closed`, are ignored. Display order is `(ts, id)`.

### Host
A *role*, not a data authority. Admin events count only when authored by whoever is host at that point in the ordered log. Every event is **signed** (see Identity), so a member cannot write events as the host or as anyone else; a forged author fails verification on every peer.
- **Handover**: a `role_changed` event.
- **Succession is automatic**: when the host leaves, the longest-standing online member (earliest first join, id as tiebreak) becomes host. It is computed from the log, so every peer agrees; a returning ex-host does not reclaim the role.
- `initialHost` is fixed on first join, so a restarted server naming a different creator cannot change who everyone derives as host.

### Identity
Self-certifying. On first visit each tab makes an Ed25519 key pair (WebCrypto; needs https or localhost and Chrome 113+/Safari 17+/Firefox 129+); the **id is the first 16 hex chars of the SHA-256 of the public key**, kept in `sessionStorage` (so a refresh is still you, and two tabs are two people). Every event carries `pub` and `sig`; peers accept an event only if the id matches the key and the signature covers `[id, author, ts, type, payload]` (canonical JSON). Separately, a random `secret` is sent to the signaling server so nobody can take over your *connection* just by knowing your id. No accounts; the display name is cosmetic and not authenticated.

### Permissions (host-controlled)
`chat`, `files`, `music`. They gate chat, coin, rock-paper-scissors, blame, file sharing and music control. Members' controls are disabled when off.

---

## 2. Sync model

1. When a data channel opens, each side sends the list of event ids it holds; each replies with the events the other is missing (set union).
2. New events are broadcast to direct peers; duplicates are dropped by `id`.
3. **Deterministic ids** where observers must agree: when someone disconnects, every observer authors the same `left:<peer>:<joinEventId>`, and the union dedupes it. Id-set exchange (not version vectors) is what makes that work. Fine for chat-sized logs.
4. **Live-only effects.** Coin flips, rock-paper-scissors throws, blame picks and the air horn animate or sound only when they arrive live (`fresh` set in `space.ts`). Anything that arrives via history sync shows its result silently.
5. **Relay through mutual contacts.** Each peer advertises which peers it is connected to (`links`). A new event or music change is forwarded to direct peers that the *author* cannot reach, so two people who cannot connect directly still exchange chat, coin/rps, music control and history through someone who can reach both. In a healthy room the author is linked to everyone and nothing is forwarded (verified: 5 messages = 10 sends, 0 forwards). Duplicates die at the receiver, so it cannot loop. Not relayed: calls, screen share, file transfers.

---

## 3. Architecture

### Signaling server (`dema-server/server.js`)
Rooms, membership, and relaying offer/answer/ICE. Also serves `dema-client/dist`, `GET /healthz`, and `GET /ice` (ICE server list from the `ICE_SERVERS` env var, default Google STUN).

Messages: `join` (with a per-page-load `session`), `joined` (`hostId`, `peers`, `resumed`, `max`), `peer-joined`, `peer-left`, `leave`, `signal` (relayed with the sender's connection `gen`), `ping`/`pong`, `replaced`, `full`.

Environment: `PORT` (8080), `GRACE_MS` (10000), `MAX_PEERS` (8; 0 = no cap), `ICE_SERVERS` (JSON).

### Client (`dema-client/src`)
| File | Role |
|---|---|
| `mesh.ts` | WebRTC mesh: signaling socket, perfect negotiation, data channels (`ctl` JSON, `file` binary), reconnect/resume, ICE restart, watchdogs, media attach |
| `space.ts` | Ties mesh + log: sync, presence, chat, files, media, music, deciders, horn, relay; exposes immutable snapshots |
| `log.ts` | Event types, validation, `derive()` (state, host succession, rps pairing) |
| `music.ts` | Shared music state, YouTube id parsing, sanitising, deterministic auto-advance |
| `message.ts`, `highlight.ts` | Chat message parsing (fenced code, inline code, links, image links); lazy syntax highlighter |
| `horn.ts` | Synthesised air horn (Web Audio) |
| `theme.ts`, `toast.ts`, `confirm.ts` | Preferences/themes, toasts, in-app confirm dialogs |
| `components/` | Chat, CallStage, MusicPlayer, Members, ThemePanel, Visualizer, Logo, ConfirmHost, ... |

Join flow: the newcomer dials every peer already in the room; link format `/#/s/<spaceId>`. Every pair uses two data channels so a big file never blocks chat.

---

## 4. Features

### Chat
- Enter sends, Shift+Enter adds a line. Messages grouped by author within 5 minutes; links clickable; unread count in the tab title; "new messages" pill when scrolled up; drag-and-drop or paste files and screenshots.
- **Code**: fenced blocks (```` ```lang ````) render monospace with exact whitespace, scroll or wrap toggle, Copy button, collapse past 16 lines, and syntax colours for ~22 languages (highlighter loads on first use). `inline code` supported. HTML is always shown as text.
- **Image links**: a link whose path ends in `.png/.jpg/.gif/.webp/.avif/.bmp/.svg` previews inline (max 4 per message, none inside code). Broken links fall back to the plain link. Preference `Preview image links` (default on): off means click-to-load, because fetching reveals the viewer's IP to the host.

- **Narrow chat**: when the chat is narrow (the column beside a call, or a phone; measured on the chat itself, not the window) the tool buttons (attach, deciders, code) move to a row under the message box instead of sharing its row. Beside a call that took the box from 143 px to about 290 px, so it no longer wraps and grows every few words.
- **Joining**: until your own join is in the room's history (`snapshot.settled`) the UI does not guess: the member count shows "…" with "Joining…", the "You're the only one here" card, Export and Import wait, and nothing host-only appears. Before this a joiner saw the "only one here" card and a count of 0 for a moment.
- **Links**: only plain `http(s)` addresses become links. Each has two small buttons: **open in a small window** (a real browser window for that person only; works for every site, and the opened page gets no handle on Deca) and **open for everyone**.
- **Open a page for everyone** (`page_share`): like screen share without sharing a screen, for "look at this listing". Anyone who may chat can send a link to the room. Everyone gets a bar at the top of the chat ("Bob opened a page for everyone: www.amazon.com/...") with an **Open** button (a small window for them) and Dismiss; each person decides, dismissing is personal, and a newer share replaces the older one in the bar. Someone who joins later sees the latest share if it is under 30 minutes old. It never opens by itself: browsers only allow a window after a click, and nobody should have pages thrown at them. The address is shown plainly and checked (`safeWebUrl`: http/https only, no `user@host` disguise, bounded length; the same check runs when the event is derived, so a forged event cannot carry `javascript:`); an address using look-alike international letters (punycode `xn--`) is flagged. Sending is limited to one share per 3 seconds. Limits: each person sees their own copy of the page (their own login, region and scroll position), and the page is not shown inside Deca because most sites (Amazon included) forbid being framed; seeing the *same* screen needs screen share.
- **Blank messages**: a message with nothing to show (empty, whitespace, or only empty code fences such as the code-block button leaves behind) is not sent, the Send button stays disabled, and one that arrives from an older client is hidden.

### Files and media in chat
- Up to **50 MB**, sent in 16 KB chunks on the `file` channel with backpressure. The receiver pulls.
- **Images** up to 10 MB are fetched automatically and shown inline, with a lightbox (arrows, click to zoom, download, Esc).
- **Videos** are opt-in ("Load video", never automatic), then play inline from a local blob; unsupported formats offer Save.
- Received files stay in browser memory until you leave (no cap yet; a memory cap is a known gap).

### Calls
- Camera + mic, and screen share, are independent and can run together. Mic mute (`track.enabled`, shown to others), camera on/off with avatar fallback, mic-only fallback if the camera fails.
- **Expand chat**: while a call is on, the chat is the narrow column beside the video. A slim bar at the top of the chat ("In a call · 1 on camera") has an **Expand** button that gives the chat the whole area; the video is hidden but keeps playing (audio and tracks continue), and the same button reads **Video** to go back. The video's own timer shows normally; the bar shows one only while the video is hidden, so there are never two. It is never offered while a game is open, and opening a game resets it, because expanding would resize the game's window; the game panel, its column, the chat and the video are pixel-identical either way. Joining or leaving your own call, or the last camera going off, resets it.
- Tiles: spotlight (screen share auto-spotlighted, or pin), full screen per tile (button or double-click). Call timer shared as *elapsed time*, so differing clocks agree.
- **Screen share with sound.** Starting a share asks the browser for audio too (no echo cancellation, noise suppression or gain control, which would mangle music and film sound). The picker decides what is possible: Chrome and Edge offer a tab's audio ("Share tab audio") and, on Windows and ChromeOS, the whole system's; macOS only allows a tab; Safari and most Firefox cases give video only. The sharer may decline; a browser that rejects the option gets a plain share. The tile says "screen with sound" for the sharer and viewers alike, so the sharer can see whether sound is going out. The sharer's own tile is muted (no echo); viewers play it through the tile. The audio track is capped at 96 kbps (voice stays at 32), which adds about that per viewer. Tested with a synthetic screen and tone: with and without sound, label, playback, muted local tile, stop.
- Capture is modest (640x360, ~24 fps; screen <= 1280x720, ~10-15 fps) with per-sender bitrate caps, because a mesh encodes one copy per viewer.
- **Video waits for the direct link.** Local tracks are attached to a peer only after its data channel opens, and a tile is shown only for peers whose link is open. A connection that is still being set up stays small and nothing flickers.
- Comfortable up to ~4 people on video.

### Music (shared listening room)
- Paste a YouTube link; everyone's own embedded player plays the same video in sync. No audio is streamed through the app.
- State `{ rev, by, cur, playing, pos, queue }` travels over the data channels (not the log); highest `(rev, by)` wins. Late joiners are sent the current state; the DJ sends a heartbeat every 10 s to correct drift.
- **Pop out** (header button, wide screens only): the same panel becomes a small draggable window over the page (`.music.float`); dock puts it back. Like maximise it is a restyle, so the video is never remounted.
- A popped-out player ignores the sidebar fold (its fold control is hidden) and keeps a dock button and the add-link box even when nothing is playing, so it can never become unreachable. It docks itself when the window goes narrow (<= 860 px).
- **Replay**: the player remembers the last track played *during this visit* (in memory only: a room is gone when everyone leaves, so a new room starts clean); an empty player offers "Replay: <title>", and a playing one has "Restart this track". Pasting several links (spaces, commas or lines) queues them in order, up to 10. Playlist-only links are refused with a clear message; `watch?v=..&list=..` plays just that video. No third-party track is built in or auto-played (browsers block autoplay, and bundling someone else's video is a licensing risk).
- On devices without the Fullscreen API (iPhone Safari), Maximise falls back to a page-filling overlay (`.soft-max`).
- Layout of the panel: the seek bar (with both clocks) sits on top, then one row with play / restart / next on the left and mute + volume filling the rest. The fold arrow lives inside each panel heading (`slot.tsx`), so it lines up with the title and simply is not rendered while the player is popped out.
- **Maximise** (button in the panel header): full-screens the whole music panel, so play/seek/volume stay available; the player is only restyled (`.music.max`), never remounted, so playback continues. Esc exits.
- Track end: every peer advances locally and identically (`advance()`), nothing is sent.
- A click or pause *inside* the video acts like the Pause button for everyone; without permission the player is put back with a message. (Only changes after a short window following our own commands count as the person's.)
- Per-device: volume, mute, "stop listening". Queue, remove, next, seek.
- The visualiser is decorative: YouTube's iframe does not expose its audio.
- The player stays visible (>= 200 px) per YouTube's terms.

### Deciders
- Menu next to the composer: **Flip a coin** (`/flip`), **Rock paper scissors** (`/rps`) and **Blame someone** (`/blame`).
- **Blame**: picks one person who is online right now, possibly the blamer, using an unbiased random draw on the blamer's device, and posts "<blamer> blamed <name>" from each viewer's point of view ("You blamed Bob", "Ann blamed you", "You blamed yourself"). A live pick cycles through names for about a second and a half, then lands; history, late joiners and reduced-motion users see the result at once. Same permission as the other deciders (host, or members while chat is on). Recorded in exports as a plain line.
- Both results are picked on the thrower's device with `crypto.getRandomValues`. RPS is a random throw, so nobody can pick a winning move after seeing the other's. A throw answers the oldest unanswered throw from someone else in the last 30 s (via `vs`); pairing is computed from the log after the fold, so clock skew cannot matter. You cannot re-roll while yours is waiting. Ties say "throw again".

### Air horn
- Host-only red **Wake up** button (Host controls). Plays a synthesised horn on every device, flashes the screen once (no strobing), and logs a line. 3 s cooldown on the host and a 3 s rate limit on every receiver.
- Loudness is bounded: compressor then a fixed ceiling of 0.5 (-6 dBFS). Measured offline: peak about -8 dBFS, loudest 100 ms about -18 dBFS RMS, 1.7 s, soft attack, clean tail.
- Each person can turn it off for their device (`Play the host's air horn`); the alert still shows. History never replays it.

### Games panel (experimental, may be removed)
A controller button in the top bar (hidden on narrow screens and when there are no games) opens a panel under the video that runs any static web game in a frame. Everyone who opens it plays their own copy; nothing is synced. Esc hands the keyboard back to chat; Reload, Full screen and Close (which stops the game and its sound) are in its header.
- Games are folders in `dema-server/games/<id>/` with an `index.html` (optional `game.json` `{ "title": "..." }`). The server lists them at `/games.json` and serves them at `/games/<id>/...` (traversal-safe). No restart is needed to add one.
- Only the bundled samples are part of the project, both original and MIT: `snake` (~60 lines) and `platformer` (**Pixel Hop**, a side-scrolling platformer with its own character, generated level, coins, slimes, spikes, a goal flag and synthesised sounds; arrow keys/WASD, Space to jump, Shift to run, M mutes, R restarts; it pauses itself when it loses focus). `?bot=1` runs an autopilot, used to prove the level can be finished. `.gitignore` keeps every other folder out of the repo and out of deployments.
- **Freedoom** (`games/freedoom/`): the free, BSD-licensed Freedoom Phase 1 campaign (a complete replacement for Doom's data) on the PrBoom engine inside EmulatorJS (GPL). The engine and its core load from `cdn.emulatorjs.org` at runtime, so it needs internet access; the 28 MB `freedoom1.wad` is git-ignored (run `games/freedoom/get-wad.sh` once, or copy it in). Controls are EmulatorJS's default keys for the PrBoom core, not Doom's own (arrows move/turn, A fires, Z opens/uses, S runs, X+arrows or Q/E strafe, Tab/R change weapon); they are listed in `game.json` and shown in the panel. `game.json` also takes `heavy` (the panel then waits behind a Start button and is never the default game), `note` and `controls`. Local play only, and CPU-heavy next to a call.
- Games run on the app's own origin (sandbox with `allow-same-origin`), so only add games you trust.
- To remove the feature: delete `components/GamesPanel.tsx` and its few lines in `App.tsx`, or just empty the `games/` folder (the button disappears).
- Third-party games carry their own licences. Example: the FullScreenMario remake is under a DMCA takedown (Nintendo, 2016), so it is deliberately not bundled or fetched.

### Host controls
Kick, make host, close space, permission toggles, the horn. All confirmations use in-app dialogs.

### Leaving
Leave opens a dialog that states what it will do (host handover target, space ending if you are alone, call/share ending, files that become undownloadable). Closing the tab warns via the browser only when it matters (in a call, sharing, alone with history, or sharing files others may still want).

### Slash commands (typed in the composer, never sent as chat)
`/flip` and `/rps` (listed in the Deciders menu).

---

## 5. Design and preferences

**Wallpaper** (`wallpaper.ts`, Appearance panel): a personal picture behind the app, kept only on this device (IndexedDB), never shared. It is decoded, shrunk to 1920 px and re-encoded as JPEG (metadata stripped); PNG/JPEG/WebP/GIF/AVIF/BMP up to 20 MB. Dim (0-90%) and blur (0-16 px) keep text readable; the top bar, sidebar, composer and stage turn translucent with a backdrop blur while one is set. **Accent from the picture**: the dominant hue is found from a 48x48 sample (greys and near-black/white ignored; a near-greyscale picture sets nothing), then the accent is its **opposite** (hue + 180), its **same** hue, or off. Lightness is searched per colour until the accent reaches at least 4.6:1 contrast on the theme's panels (the opposite of blue is yellow, which a fixed lightness would make unreadable on light themes). Choosing an accent by hand turns the link off.

**Layout and preferences added later** (all per device, in `deca.prefs`): sidebar width (drag the grip, arrow keys, double-click resets; 220-440 px), foldable sidebar panels (a folded music panel keeps playing), timestamp format (auto / 12h / 24h), and a toggle for the unread count in the tab title.

### Identity
"deca." wordmark and a ten-dot ring logo (deca = ten); keycap-style buttons; IRC-style chat feed (time, coloured name, text; stacked name-over-text in narrow panels via a container query); sticker-style video labels.

### Themes (Appearance panel, preferences in `localStorage` `deca.prefs`)
- Six themes: Midnight, **Graphite (default; lime accent)**, Light, Forest, Rosé, Sunset.
- Accent colour (presets or custom), text size, corner roundness, compact spacing.
- **Home screen**: *Simple* (default, one centred card) or *Classic* (two-column with copy beside the card). Both use the same "room ticket" card: dashed edge, side notches, ROOM TICKET / ADMIT ONE header, barcode, dotted backdrop.
- Toggles: preview image links, play the host's air horn.
- The default theme applies only when no theme attribute is set (`:root:not([data-theme])`), so it can never override an explicit choice.

### Responsive
Three columns (members | video | chat) from 1240 px; stacked below that; members become a slide-in drawer at 860 px; labels collapse to icons at 1100 px. Verified at 390-1600 px with no sideways overflow.

### Accessibility
Icon buttons have accessible names; dialogs use `role="alertdialog"`; the home screen passes WCAG AA text contrast in all themes (disabled primary buttons no longer fade dark text). Known gaps: some in-app text in Light and Rosé is below 4.5:1 (coloured names, a few muted labels, small avatar initials).

---

## Performance (measured)
On one machine (loopback, so these are the app's own costs, not network): a six-person mesh is connected with history synced in about 100-230 ms per join; a chat line reaches everyone in about 7 ms; a 40 MB file moves at about 38 MB/s. Re-deriving room state costs about 3 ms at 60,000 events. Rendering is the part that scales with history: plain chat lines and imported lines are memoised rows, which took a new message from about 150 ms to about 5-15 ms with 4,500 imported lines on screen, and keeps it near 15 ms with 3,200 live rows. A four-person import of 4,500 signed lines verifies in about 0.3 s and reaches a peer in about 1 s. Real-network connection time is dominated by NAT traversal, which is what TURN is for. Default STUN is Google's plus Cloudflare's, so one being unreachable does not slow every first connection.

## 6. Connection resilience

**Quick retry.** A first attempt that has not reached the network (ICE not connected) after 7 s is rebuilt at once, up to twice per person, by the side with the higher id only (so the two do not rebuild together). Often the first try only opens the routers (typical on one home Wi-Fi, where hidden `.local` addresses force a public-address path that needs the router to loop traffic back), and the second goes through. After that the older schedule applies: ICE restarts, then redial with backoff (1x, 2x, 4x). Tested by sabotaging the first attempt: connected by itself in about 7 s. Not applied in connect-by-code rooms, where a person carries the codes.

- **Signaling blips don't read as "left".** The server holds a dropped socket's place for `GRACE_MS`; the browser reconnects by itself (backoff 0.5 s to 10 s, immediately when the network returns or the tab wakes) using a per-page-load `session` id, so it is re-attached silently and healthy peer links are kept. A deliberate Leave is announced at once.
- **Dead sockets are detected.** Client pings every 12 s, abandons a socket silent for 35 s; the server pings too.
- **Server restarts.** Clients reconnect and re-mesh; chat between connected peers never stops. Someone missing from the first room list gets 20 s to reappear before being called gone.
- **ICE restart before rebuild.** A `disconnected`/`failed` path gets up to two ICE restarts on the same connection, then the link is rebuilt.
- **Open watchdog.** A link whose data channel has not opened in 20 s is rebuilt; repeated failures retry with backoff.
- **Stuck people stay visible.** Someone we cannot reach is a stable row ("connecting", then "can't connect directly" after ~25 s) with a **Retry** button; the row does not vanish between attempts. If a newcomer's browser cannot start a connection, the others reach out after 10 s.
- **Connection generations.** Every signal carries the sender's generation, so a fresh connection is never mixed with an old one and stragglers are ignored.
- **Same identity in two tabs**: the newer tab wins; the older is told (`replaced`) and stops with a message instead of fighting back.
- **Relay** (see Sync model) covers pairs that can never connect directly.
- Redundant peer-list updates are skipped to avoid needless re-renders.

## 7. Room cap
Links grow with the square of the room size (n people = n(n-1)/2 links, n-1 per browser), so a space holds at most `MAX_PEERS` people (default 8). The server enforces it: a newcomer to a full room sees "This room is full" with Try again. Anyone already in the room (reconnect, refresh, a tab taking over the same identity) is never counted twice. The Members header shows `online / capacity`.

A sparse mesh for chat (about 8 links each, messages hop) would scale to hundreds; not built.

---

## 8. Running and hosting

### For non-technical people
`scripts/start.mjs` (run by the double-click files `Start Deca.command` and `Start Deca.bat`) is the one-step path: needs only Node 18+, checks it, sets itself up on first run (installs the server's one dependency and builds the client only if `dema-client/dist` is missing, printing a progress line instead of build logs), picks a free port (8080 upward), starts the server, finds or downloads the Cloudflare tunnel program for the system (`cloudflaredAsset()`: macOS and Windows and Linux, x64/arm64/32-bit as available; an unsupported system gets a clear message), waits until the tunnel is actually connected, prints the link, copies it to the clipboard, opens the browser, and stops everything when its window closes. If the tunnel fails it keeps running locally and says so. `scripts/package.mjs` builds `deca-ready.zip` (about 0.2 MB: built client, the server with only `ws`, the tracked games without the large game file, the launchers and `START-HERE.md`), so the first run needs no install or build and starts in about a second. `.github/workflows/release.yml` builds and attaches it to a GitHub release on a `v*` tag. Verified on macOS from a bare copy, including the public link, clean shutdown, tunnel failure and the missing-Node message; the Windows `.bat` and the Windows/Linux code paths are written to the same logic but not run.

### One command
```
./deca.sh up       # build if needed, start server + Cloudflare quick tunnel, print the public URL
./deca.sh down     # graceful stop of both
./deca.sh status | logs
```
State in `.run/`, tunnel binary in `.bin/` (auto-downloaded). Quick-tunnel URLs change on every start. `ICE_SERVERS='[...]' MAX_PEERS=12 ./deca.sh up` passes settings through.

### Dev
```
cd dema-server && node server.js        # :8080 (signaling; also serves dema-client/dist if built)
cd dema-client && npm run dev           # https, self-signed (camera needs a secure context)
# HTTP=1 npm run dev  -> plain http (camera then only works on localhost)
```

### Free hosting without a backend
`node scripts/build-static.mjs` (or `npm run build:static`) writes `dist-static/`: the client built for **connect by code only** (`VITE_STATIC=1`, relative asset paths via `base: "./"`, no `/ws`, no `/ice`, the bundled games copied in with a generated `games.json`; Freedoom's 28 MB data file is downloaded during the build by `get-wad.sh` (needs `bash`, `curl`, `unzip`), and the game is left out with a warning if that fails). It is plain files, so it works on any static host, at a domain root or under a sub-path. GitHub Pages: `.github/workflows/pages.yml` publishes it on push to main (Settings, Pages, Source: GitHub Actions). Vercel/Netlify: import the repository; `vercel.json` sets the build command and output folder. Browsers need https for the signing keys and camera, which both hosts provide. A link to a server room (`#/s/...`) explains that this site has no server. Verified by serving the build under `/deca/`: the page loads, no request goes to the root or to `/ws` or `/ice`, `games.json` and a game load, and the invite keeps the sub-path.

### Free hosting with a server
One Node process serves the built client and the WebSocket. Render free web service via `render.yaml` (sleeps after ~15 min idle); Koyeb, Fly.io, Railway are similar. Zero-cost LAN mode: run the server on a laptop and open its address.

### TURN
STUN alone connects most home networks but not strict firewalls or some mobile carriers (and symmetric-NAT pairs). Set the server's `ICE_SERVERS` env var to a TURN service (Cloudflare Realtime TURN, Metered free tier); clients fetch it from `/ice`, so no rebuild is needed. TURN credentials reach the browser, so prefer short-lived ones for public spaces. Without TURN, unreachable pairs still get chat through the relay.

---

## Export (first step towards keeping a room)
Any member can save the room from the Members panel ("Export room"). Rooms still vanish when everyone leaves; an export is the one deliberate way to keep one, and it is a file on the member's own computer, never uploaded.
- **Contents** (a zip made in the browser, `zip.ts` / `roomExport.ts`): `room.json` (format `deca-room-export` v1: the valid events exactly as received, with every `pub` and `sig`; members; room id, host, timestamps; file list with SHA-256), `transcript.html` (a script-free, self-contained readable page; all text escaped), and optionally `files/` (only files already on this device; capped at 300 MB).
- **Verifiable**: `verifyExport()` re-checks every event's signature, so an edited message or a forged author is detected offline. This is the check a future import must run first. File names are sanitised to safe archive paths.
- **Honest limits**: it holds only what reached the exporting device; nobody else is notified (a client cannot prevent screenshots either, so the dialog says so rather than offering a fake control); live-only effects (coin animations, horn) are recorded as plain lines.
- Exports also carry any imported history the room holds (as ordinary signed events), so history survives export, import, export. Only real signed log events are exported: the unsigned "X is now host" lines that succession adds to the derived view are left out (they would fail verification).
- **Not yet**: per-room persistence beyond an explicit export.

## Import (read-only history)
The host can bring an export's history into a room (Members panel, "Import"). It is shown **above** the live conversation, marked as imported and read-only, and it is never merged into the room's log, so an old room's host, kicks, permissions or "closed" can never act on the new room, and old people never appear as members.
- **Check first** (`roomImport.ts`): the zip is read with limits (2,000 entries, 50 MB per file, 400 MB total, no ZIP64; stored or deflated), and `verifyExport()` must pass: one bad signature refuses the whole import with an explanation. Only content lines come across: chat, file offers, coin, rock-paper-scissors, blame, horn. Joins, leaves, removals, host changes, permission changes and "closed" are dropped. Names come from the old join events and member list, and are shown with a short id because they are self-asserted.
- **How peers get it**: the host authors one signed `archive_added` event committing to the SHA-256 of the archive blob (`archive.ts`: bounded to 8 MB and 5,000 lines, at most 3 per room). The blob itself travels peer to peer over the existing file channel as a hidden file `arch:<id>`, from the importer first and then from anyone who already holds it, so a newcomer can still get it after the importer leaves. Receivers accept the bytes only if they hash to the committed value **and** every event verifies, so a holder cannot alter a word. The reserved `arch:` prefix cannot be used by live file offers.
- **Attachments**: an export may include files (each with a SHA-256). On import a file is kept only if its bytes match the recorded hash; the list in the archive is then covered by the host's signed hash. Members fetch an imported attachment from **the importer only**, and check it against that hash, so attachments are available only while the importer is in the room (imported images preview automatically; other files on request). A file that was not in the export shows as "not included". The original events never carried a file hash, so integrity of an attachment rests on the exported file list, not on the author's signature.
- Importing the same export twice is refused; a line the room already holds is not shown twice. The imported history is exported again with the room (see Export).

## Connect by code (no signaling server)
An extra mode for when there is no server to reach (it is down, you are offline on one network, or you simply do not want one): landing page, **No server? Connect by code**. Nothing else changes: chat, files, calls, music and games work as in any room, and signed events, export and import are identical.

**How it works** (`localSignal.ts`, `manualRoute.ts`, hooks in `mesh.ts`). `Mesh` is written against a signaling server (who is here, relaying offers/answers/ICE, who left). In this mode it is given a small in-browser stand-in for that server, so the connection code is unchanged. The stand-in does the server's three jobs: *who is here* (people it has heard of from an invite link, a code, or an introduction by someone already connected); *relaying connection messages* over an existing link (directly, or through the mutual contact that introduced the two); and, **only when no link can carry a message, packing the messages into a code** (`deca1.` + deflated JSON, about 1,000 characters) that a person copies and sends by any means.
- **Joining**: the person who made the room shares its invite link (`#/m/<room>/<id of whoever shares>/<host id>/<name>`; anyone in the room can share theirs). The newcomer opens it, picks a name, and is shown **a code for the person who invited them**. That person pastes it (Members, **Connect by code**) and gets **a reply code** to send back. That is the only manual exchange: once the two are linked, the newcomer is introduced to everyone else over the existing links and connects to them automatically, with no more codes. Video and screen share renegotiate over the same links, not a server.
- **Leaving**: a goodbye on every link when someone leaves; a link that stays down 15 s means they left. A link that drops with nothing else to carry a new offer shows **Reconnect** next to that person (one fresh code each way); nothing re-dials by itself, so you are not handed a new code every few seconds. After a refresh, the address still holds the invite that was followed, so joining again is one more exchange.
- **The dialog** shows one task at a time: while there is a code to send it is shown on its own (Step 1 of 2 for whoever starts, "Last step" for whoever replies), with **I have sent it: next** revealing the box for the reply; a reply code is shown with no paste box at all. "Getting your code ready" shows while the browser finishes looking for addresses: a code is sealed as soon as it reports it is done (fallbacks: 2.5 s quiet, 7 s total), and a sealed code never changes under whoever is copying it. **Not connecting?** lists the usual causes (VPN or guest Wi-Fi, two browsers on one computer, Reconnect).
- **Same Wi-Fi** (`localNetwork.ts`): browsers hide your Wi-Fi address behind a random `.local` name unless the page has microphone/camera permission. The other device must then look that name up (many routers and phones do not manage it) or fall back to the shared public address (which needs the router to loop traffic back, which many do not). So a code room asks, by default and with a plain explanation on the first screen, for the **microphone once**: the track is switched off and never connected to anything, nothing is recorded, and it is released as soon as the first link is up (or after 3 minutes). With the permission the codes carry the real Wi-Fi addresses and two devices on one Wi-Fi connect straight to each other. Refusing is fine: the exchange still works by the slower routes. The help under **Not connecting?** reads what each code offered (real Wi-Fi addresses, hidden names, internet addresses) and names the likely cause: both hidden means start again with the option ticked; both real and still failing means the Wi-Fi is isolating devices (AP/client isolation, a guest network) or a VPN is in the way. Verified in a browser with the permission granted (real addresses in the codes, connected) and not granted (hidden names, connected via the internet addresses); the permission prompt itself and phones were not available to test.
- **"Can't connect directly"** is only said when the network attempt itself has failed or has run 25 s since the other side's half was applied, and never while this side holds a code that is still waiting to be carried: the other side starts probing as soon as it has the first code, long before a person delivers the reply, so age since creation says nothing. A link that never came up stays listed with **Reconnect**; only someone whose link worked before can be said to have left. No ICE restart is attempted while a code is out (it would change the credentials in the code someone is carrying).
- **Safety of codes** (version 2 codes, hardened after a demonstrated attack: someone holding a code could answer it first, claim another person's id and receive the room's history). A code is **signed** with the sender's identity key (it carries the public key; the id is derived from it, so a code cannot name someone else's id), names the exact person it is for, and is refused if altered. Pasted codes are also bounded (60,000 characters, 300,000 inflated), and checked for version, signature, recipient, room, host, shape and the cap of 8 people, each with a plain message.
- **Who may answer.** A reply is accepted only from the person we asked: a reply from anyone else (even correctly signed) is refused with a message naming who we are waiting for. A request from someone we have never linked with is **not answered until a person presses "Let them in"** (a card in the dialog names them); someone whose link already worked (same key) comes back without asking. Without approval nothing is sent to them: no reply code, no history.
- **Relayed messages are signed.** After the first link, connection messages (offers, answers, candidates) travel over existing links, possibly through a mutual contact. Each carries the sender's signature, checked on arrival, so a relay can neither change one nor say it came from someone else. They are signed and checked one at a time in order, so a candidate never overtakes its offer.
- **Check words.** Once linked, both sides show the same six words (6 of 256, derived from the two DTLS fingerprints, both ids and the room) in Members. Compare them by voice or another channel and press **They match**, or **They don't match** to cut the link. This catches someone sitting between two people on the first exchange. Six words is 48 bits: enough against live interception, though an attacker able to grind fingerprints offline could try to match them before they are compared.
- **Trust, honestly**: a code carries the sender's network addresses and signing key and is only as private as the way it is sent. Someone who reads an ask code can still send their own ask to the host, but cannot be let in unseen, cannot take another person's identity, and is exposed by the check words if they sit in the middle. Without a server nobody can enforce the room lock or the cap centrally: the cap is enforced by each member, and the lock switch is hidden. A member who introduces others can pass on connection messages but cannot alter them; events are signed, so nobody can write as someone else.
- **What it still needs**: public STUN servers (Google, Cloudflare; free, not ours) to find your address through a home router; connections between two networks that block direct links still need a TURN relay, as in any mode. On one network with no STUN, Chrome's habit of hiding your address behind a `.local` name can stop the link, which depends on the network allowing it.
- **Verified**: four browsers joined from copied codes alone (a code each way for the first pair; the others introduced automatically), chat, a video call, a 1 MB file, graceful and abrupt leaves, a dropped link and Reconnect, a refresh, a phone-sized screen, bad and hostile codes; the browsers never opened a WebSocket or asked the server for ICE servers.
- **Not built**: a single-file "room in a file" (a page opened from disk is a secure context in Chrome, so it is possible), QR codes for the codes, and signaling through public relays (link-only joining without a server of our own).

## Hidden commands
Typed in the composer, not listed anywhere in the UI: `/run`, `/run on`, `/run off`: a self-playing endless-runner strip for **this tab only** (nothing is sent, saved or shown to anyone else; a reload clears it). It is drawn entirely in code (`runnerSim.ts` logic, `components/RunnerStrip.tsx` drawing: three lanes in pseudo-3D, trains to dodge, barriers to hop, bars to roll under, coins, a runner in the theme accent), with no outside art or sound, and a Hide button on the strip. It sits directly under the call video in the video's column (or above the chat when there is no call), giving up only its own height (about 24% of the window, 120-220 px). Opening a game turns it off (it stays off when the game closes) and it never alters the game window's geometry. Reduced-motion users get a message and no animation. The autopilot is tested over thousands of simulated minutes with zero crashes (the generator always leaves a path; the sim still recovers if one ever occurred).

## Plugins
A design for third-party panels (the music player is the reference case) is in [PLUGINS.md](PLUGINS.md). Phase 0 is built: sidebar panels register through `widgets.tsx` and fold through `slot.tsx`.

## 9. Limits and non-goals
- No persistence after everyone leaves (log is in memory; IndexedDB would be the path).
- No E2E encryption beyond DTLS. Events are signed; the other control messages are not (see Security).
- Up to `MAX_PEERS` people; ~4 on video.
- Calls, screen share and file transfers need a direct link (not relayed).
- Received files are not memory-capped.
- Moderation beyond kick, message edit/delete: not built.
- Not built: rock-paper-scissors challenges and a leaderboard, signaling-free (QR) pairing, sparse chat mesh.

## 10. Testing
Automated browser tests (Playwright + Chromium, plus WebKit for a phone-sized receiver) and unit tests (Node) were written during development and cover: join/presence, chat, history sync, files (byte-compare), image/video, calls (mute, camera+screen, full screen), music sync, deciders, kick/handover/succession/close, leave dialogs, themes (including a before/after style diff), contrast audits, connection scenarios (leave/rejoin, refresh, link kill, signaling drop, duplicate tab, server restart, room cap, stuck peers, relay), and the horn (permissions, cooldown, per-device mute, measured loudness).

**These scripts currently live in the session's scratch folder, not in this repo.** They are not committed and will be lost when that folder is cleaned; moving them into the project (with their hardcoded paths made configurable) is pending.

## Security
**Signaling server limits** (all environment-tunable): messages <= 64 KB (`MAX_PAYLOAD`); 40 sockets per client address (`MAX_PER_IP`); 60 joins per address per minute (`JOINS_PER_MIN`); per-socket token bucket, 250 burst / 100 per second (`MSG_BURST`, `MSG_PER_SEC`); a socket must `join` within 5 s; `spaceId`/`peerId` must match `[A-Za-z0-9_-]{4,64}`, names <= 32, secret 16-128 chars; at most 4,000 sockets and 1,000 rooms (`MAX_SOCKETS`, `MAX_ROOMS`); optional `ALLOWED_ORIGINS` origin allow-list; socket errors can never crash the process. Room codes are 12 hex chars (48 bits), and join-rate limiting makes guessing impractical.
**Identity and integrity:** connection takeover needs the per-identity secret (a known id is not enough); events are signed and verified (forged host chat, kick, role change and close were tested and rejected); a peer sending more than 25 events/second is ignored; sync batches are capped at 5,000 events.
**Room lock:** any member can lock the room to newcomers (the UI offers it to the host). People already inside, reconnects and same-identity tabs are unaffected.
**HTTP:** header/request timeouts, `nosniff`, `Referrer-Policy: no-referrer`, and a Content Security Policy for the app (not for `/games/`).
**Behind a proxy:** the real client address is read from `cf-connecting-ip` / `x-forwarded-for`. Only expose the server through that proxy (a tunnel or a host's edge), or those headers can be spoofed and the per-address limits evaded.
**Known gaps:** the music, media and link-advertisement control messages are not signed (a member could claim to be the host to bypass the "members can control music" setting, or lie about who they are linked to); someone holding a room link could still fill it with silent connections (mitigated by the lock and by 48-bit codes); state is in one process's memory, so there is no horizontal scaling; no TLS termination of its own (use the tunnel/host); no abuse reporting or moderation beyond kick, lock and the host's controls.
