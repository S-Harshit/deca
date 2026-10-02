# Deca plugin specification

Status: **design, API version 1 (draft)**. Phase 0 is built (see [Implementation plan](#9-implementation-plan)); the bridge, manifest loader and shared-state API are not. Nothing here changes how existing rooms behave.

A plugin adds a panel to a Deca room: a music player, a poll, a whiteboard, a game, a timer. The music player is the reference case, so every rule below is checked against how music works today.

## 1. Goals and non-goals

Goals
- A plugin author writes a small web app (HTML + JS), not a fork of Deca.
- Everyone in the room runs their own copy of the plugin and the copies stay in sync through a few host-provided primitives. The server still never sees room data.
- A plugin cannot read messages, files, other people's identity keys, or open its own connections to peers.
- The room host stays in control: who may change a plugin's shared state is a host setting, like `perms.music` today.

Non-goals (v1)
- Installing plugins from the internet at runtime. A plugin is installed by whoever runs the server (a folder on disk), the same trust model as `dema-server/games/`.
- Plugins that send or receive audio/video streams, or read files shared in chat.
- A plugin store, payments, or per-user plugin installs.

## 2. Terms

| Term | Meaning |
|---|---|
| **Operator** | Whoever runs the Deca server. Decides which plugins are installed. |
| **Host** | The room's current host (a role in the room, see SPEC.md). Decides which installed plugins are on in their room and who may write to them. |
| **Member** | Anyone in the room, including the host. |
| **Plugin instance** | One running copy of a plugin in one member's browser. |
| **Placement** | Where a plugin draws: `sidebar`, `stage` or `topbar`. |

## 3. Two tiers, one API

| | First-party | Third-party |
|---|---|---|
| Runs as | A React widget inside the app | A web page in a sandboxed `<iframe>` |
| Trust | Reviewed and shipped with Deca | Installed by the operator, treated as hostile |
| API | `registerWidget()` + hooks (`usePluginState`, ...) | `window.deca` over `postMessage` |
| Examples | Members, Host controls, Music | Games, polls, whiteboards |

Both tiers talk to the **same host services** (shared state, events, signals, storage, permissions, theme). A first-party widget calls them directly; a third-party plugin calls them through the bridge in section 6. A plugin that outgrows the sandbox, or needs something the bridge cannot give it, can be promoted to first-party; nothing else about it changes.

Music is first-party because the YouTube player needs a real page origin (a sandboxed frame has an opaque `null` origin, and embedding from it is unreliable) and because it is the trusted reference implementation.

## 4. Packaging and installation

A plugin is a folder in `dema-server/plugins/<id>/`:

```
plugins/
  poll/
    plugin.json      required: the manifest
    index.html       required: the entry page (for placements that draw a UI)
    ...              any static files
```

The server lists installed plugins at `GET /plugins.json` (manifests only, sanitised) and serves files from `/plugins/<id>/...`, exactly as it does for games today. `dema-server/games/<id>/game.json` becomes a plugin with `"kind": "game"` (section 4.2), so games are not a separate mechanism.

An operator removing a folder removes the plugin. There is no runtime upload and no remote install.

### 4.1 Manifest (`plugin.json`)

```json
{
  "id": "poll",
  "name": "Quick poll",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "Ask the room one question.",
  "author": "Jane Doe",
  "license": "MIT",
  "entry": "index.html",
  "placements": ["sidebar"],
  "permissions": ["state", "events"],
  "writeAccess": "members",
  "state": { "maxKeys": 8, "maxBytes": 4096 },
  "externalHosts": [],
  "heavy": false,
  "background": false,
  "controls": ["Click an option to vote"]
}
```

| Field | Rules |
|---|---|
| `id` | `[a-z0-9-]{2,32}`, unique, equals the folder name. Keys the host's saved fold state and the plugin's namespace in storage, state and events. Never reuse an id for something different. |
| `name`, `description`, `author`, `license` | Shown to the host when they enable it. Strings, bounded length (name 40, description 200). Missing `license` is shown as "no license declared". |
| `version` | Semver of the plugin itself. |
| `apiVersion` | Integer major version of this spec. The host runs plugins for its own version and one older; anything else is listed but disabled with a clear reason. |
| `entry` | A path inside the folder. |
| `placements` | Subset of `sidebar`, `stage`, `topbar` (section 5). At least one. |
| `permissions` | Capabilities requested (section 7). Unknown names make the plugin invalid. |
| `writeAccess` | `members` (default) or `host`: the default for who may write shared state. The host can override it per room. |
| `state` | Quotas, capped by the host's hard limits (section 8). |
| `externalHosts` | Hostnames the plugin loads scripts, frames or media from (for example `www.youtube.com`). Shown to the host and listed in the plugin's CSP. Anything not listed is blocked. |
| `heavy` | Same meaning as for games today: the panel waits behind a Start button and is never the default. |
| `background` | `true` if the plugin must keep running while its panel is folded (music). Otherwise the host may suspend it. |
| `controls` | Human-readable key/mouse help, shown in the panel (as for games today). |

The server validates and **sanitises** the manifest (types, lengths, id regex, unknown fields dropped) before listing it, as `listGames()` already does for `game.json`. A manifest that fails validation is skipped and logged, never partially loaded.

### 4.2 Compatibility with games

`game.json` is read as a manifest with defaults `kind: "game"`, `placements: ["stage"]`, `permissions: []`. Existing games keep working unchanged; they simply do not use the API.

## 5. Placements

| Placement | Where | Notes |
|---|---|---|
| `sidebar` | A foldable panel in the sidebar | Gets the fold arrow, the saved fold state, ordering and (if the plugin allows) the pop-out/maximise controls for free, via the widget registry. |
| `stage` | A panel under the video area, like the games panel | One stage plugin at a time. Honours `heavy`. |
| `topbar` | A small chip in the top bar (the "now playing" pill) | Must fit in a pill of at most 260 px wide and one line tall. Its corner radius is set by the host from the user's Corners preference; plugins must not draw their own outer pill. |

The panel chrome (title bar, fold arrow, pop-out, maximise, close) belongs to the host so every plugin looks and behaves alike, and so a popped-out panel can never lose its dock button. The plugin owns only the content area.

## 6. The bridge (`window.deca`)

Third-party plugins load `/plugin-sdk.js` (served by Deca, about 3 KB, no dependencies), which wraps the `postMessage` protocol below in a small promise/event API. A plugin may speak the raw protocol instead.

### 6.1 Transport and isolation

- The host creates the frame with `sandbox="allow-scripts"` and **without** `allow-same-origin`. The plugin therefore runs on an opaque origin: it cannot read Deca's storage, cookies, identity key (which lives in `sessionStorage`) or DOM.
- Plugin pages are also served with `Content-Security-Policy: sandbox allow-scripts; default-src 'self'; connect-src 'none'; frame-src ...` plus the hosts in `externalHosts`. This works even if someone opens the plugin URL directly.
- Extra sandbox flags (`allow-pointer-lock`, `allow-popups`) are granted only for permissions that need them (section 7).
- Messages are JSON `{ v: 1, ch, id?, type, ...body }`. `ch` is a random per-load channel token the host puts in the frame's URL fragment. The host accepts a message only if **both** `event.source` is that frame's window **and** `ch` matches. (Origin cannot be checked: it is `"null"`.)
- Requests carry an `id`; the host answers with `{ v: 1, re: id, ok: true, result }` or `{ ok: false, error: { code, message } }`.
- The host never executes, evals or injects anything the plugin sends. It only stores and relays validated JSON.

### 6.2 Handshake

1. Plugin sends `{ type: "hello", apiVersion: 1 }`.
2. Host replies with:

```json
{
  "apiVersion": 1,
  "plugin": { "id": "poll", "version": "1.0.0" },
  "room": { "id": "ab12cd34ef56", "hostId": "..." },
  "me": { "id": "...", "name": "Jane", "isHost": false, "canWrite": true },
  "members": [{ "id": "...", "name": "Jane", "online": true }],
  "theme": { "--bg": "#151515", "--panel": "#1d1d1d", "--text": "#ececec", "--accent": "#c6f432", "--radius": "8px" },
  "locale": "en-GB",
  "visible": true
}
```

`theme` carries the app's CSS variables so a plugin can match any theme (and the custom accent and corners) by setting them on its `:root`. The host sends `theme`, `members`, `me`, `visible` again whenever they change.

### 6.3 API surface

| Area | Calls | Needs permission |
|---|---|---|
| **State** (section 6.4) | `state.get(key)`, `state.set(key, value)`, `state.delete(key)`, event `state` | `state` |
| **Events** (6.5) | `events.append(type, data)`, `events.list({ since })`, event `event` | `events` |
| **Signals** (6.6) | `signal.send(name, data, { to? })`, event `signal` | `signals` |
| **Storage** (6.7) | `storage.get(key)`, `storage.set(key, value)`, `storage.delete(key)` | `storage` |
| **UI** | `ui.resize(heightPx)`, `ui.toast(text, kind)`, `ui.setBadge(n \| null)`, `ui.setChip({ text, state? })` for `topbar` (text only, no markup) | none |
| **Audio** | `audio.unlock()` | `audio` |
| **Lifecycle** | events `visibility`, `suspend`, `resume`, `destroy` | none |

All values are JSON: objects, arrays, strings, finite numbers, booleans, null; nesting depth at most 6, each string at most 2 KB. Anything else is rejected with `bad_value`.

### 6.4 Shared state (last-writer-wins registers)

For "what is the current value" data: the playing track, the poll question, a timer's end time. This is the mechanism music uses today (`music` messages), generalised.

- A plugin has up to `state.maxKeys` named registers, each a JSON value of at most `state.maxBytes` in total.
- Each write carries `(rev, by)`: `rev` is the writer's last seen revision plus one, and **the highest `(rev, by)` wins**, tie broken by `by`. Every peer applies the same rule, so all converge.
- State is **ephemeral**: it lives in memory and is **not** in the event log. A late joiner is sent the current registers by whoever they connect to first (music does this today). When everyone leaves it is gone, matching the rest of Deca.
- Writes travel over the existing data channels as control messages `{ t: "plugin-state", p, k, rev, by, v }` and are **relayed through mutual contacts** exactly as music is, so two people who cannot connect directly still agree.
- A write is accepted only if the writer may write: the host always may; members only when `writeAccess` allows it for that room (section 7.2). A receiver drops writes from members who may not, which is what `perms.music` does today.
- Time-based state (a playhead, a countdown) is stored as `{ value, atRev }` plus a heartbeat the writer re-sends every 10 s with the same `rev`, and readers compute the position from elapsed local time. The host supplies `time.now()` and `time.since(receivedAt)` helpers so plugins do not depend on synchronised wall clocks. (This is `positionNow()` and `music-sync` today.)
- `by` on a state message is **advisory, not authenticated**: control messages are not signed (SPEC.md, Security). A plugin must never use `by` to decide who is allowed to do something. Use events (6.5) when authorship matters.

### 6.5 Events (signed, durable, ordered)

For "this happened and should be in the room's history": a vote cast, a drawing stroke, a game move that must be attributable.

- `events.append(type, data)` makes a **normal room log event** of type `plugin` with payload `{ plugin: id, type, data }`, signed with the author's key by the host. The plugin never sees the key.
- It goes through the same validity rules as any event: it is ignored when the author is kicked or the room is closed, and gated by plugin write access. `data` is at most 4 KB. History sync, deduplication by id, and `(ts, id)` ordering are inherited.
- `events.list({ since })` returns the plugin's events, oldest first. The `event` notification carries `{ id, author, ts, type, data, fresh }`. **`fresh` is true only when the event arrived live** (the same rule as coin, rock-paper-scissors and the air horn): a plugin must not replay sounds or animations for `fresh: false` events.
- Events are the only way to get a trustworthy `author`, because the signature is verified on every peer before the plugin sees it.
- Because the log is replicated to everyone and held for the life of the room, plugins should keep events small and sparse. The host enforces the rate limit in section 8.

### 6.6 Signals (ephemeral broadcast)

For "right now" traffic that nobody needs later: cursors, typing, emoji reactions.

- `signal.send(name, data)` goes to everyone online (or `to: peerId`). No history, no ordering guarantee, no relay: if you cannot be reached directly, you miss it.
- Not signed; the receiver gets `{ from, name, data }` where `from` is advisory, as with state `by`.
- Tight size and rate limits (section 8).

### 6.7 Storage

Per plugin, per device: a small key-value store the host namespaces under `deca.plugin.<id>.` in `localStorage`, at most 64 KB. It is for preferences (a last-used setting) and survives leaving the room. It never leaves the device. A plugin cannot read another plugin's keys or the app's own.

### 6.8 Lifecycle

| Event | When | Plugin should |
|---|---|---|
| `visibility { visible }` | The panel is shown, folded or covered | Pause animation and polling when `false`. |
| `suspend` | Folded or hidden and `background` is `false` | Stop work; it may be unloaded after a grace period. |
| `resume` | Visible again | Re-read state with `state.get` and continue. |
| `destroy` | Room left, plugin disabled, panel closed | Save to `storage`, release resources. The frame is removed right after. |

A plugin with `background: true` is never suspended and is kept mounted when folded or popped out (a restyle, not a remount), because music must not restart when the panel is folded.

## 7. Permissions

### 7.1 Capabilities (what a plugin may ask for)

| Name | Grants | Notes |
|---|---|---|
| `state` | the shared-state calls | |
| `events` | `events.append` and `events.list` | |
| `signals` | `signal.send` | |
| `storage` | the per-device store | |
| `audio` | `audio.unlock()`; adds `allow` for autoplay in the frame | Browsers still need a click first; the host shows "Tap to start" as music does. |
| `pointer-lock` | adds `allow-pointer-lock` to the sandbox | For games that capture the mouse. |

A plugin cannot ask for: camera, microphone, screen, clipboard, notifications, file access, chat messages, raw WebRTC, or anything outside the table. Adding a capability is a spec change, not a manifest string.

The host shows the plugin's name, author, license, requested capabilities and `externalHosts` when it asks the host to enable it, in plain language ("Can see who is in the room", "Contacts www.youtube.com, which can see your IP address").

### 7.2 Who may write (host-controlled)

Each enabled plugin has one room setting, `writeAccess`: `members` or `host`. It generalises `perms.music`.

- Stored by extending the existing signed `perms_changed` event with `plugins: { [pluginId]: boolean }` (missing means the manifest default). Only the host's event counts, as today.
- Enabling a plugin for the room is likewise a host-signed event, `plugins_changed { enabled: string[] }`, so every peer derives the same set. A plugin that is not enabled receives no messages and is not loaded.
- Reading is always allowed for everyone in the room.
- The room-level master switches (chat, files) are unaffected: a plugin never sends chat messages on a user's behalf.

## 8. Limits and abuse

All enforced by the host on both send and receive, so a hostile plugin or a hostile peer cannot exceed them. They sit alongside, and never replace, the server's own limits (`MAX_PAYLOAD`, per-address caps).

| Limit | Value |
|---|---|
| State registers per plugin | manifest `maxKeys`, host cap 16 |
| State size per plugin | manifest `maxBytes`, host cap 16 KB |
| State writes | 5 per second per plugin per member (burst 10) |
| Event size / rate | 4 KB, 2 per second, 500 per plugin per room |
| Signal size / rate | 1 KB, 20 per second |
| Storage | 64 KB |
| Value depth / string length | 6 / 2 KB |
| Plugins enabled per room | 6 |

A plugin that exceeds a rate limit gets `rate_limited` errors and its excess messages are dropped, never queued. Received messages that fail validation are dropped silently and counted; a peer sending many invalid messages is ignored for the rest of the session.

Resource use: a `heavy` plugin waits behind Start; a plugin running while the tab is hidden, or while a call is up, is the operator's and host's judgement call. The host may suspend a plugin that leaves the visible area and has `background: false`.

## 9. Implementation plan

What exists today and what must change to meet this spec. Written so each phase ships on its own and nothing regresses.

| # | Phase | Status |
|---|---|---|
| 0 | **Widget registry.** Sidebar panels are registered through `registerWidget()` (`widgets.tsx`); the fold arrow and fold state come from `Slot`/`SlotToggle` (`slot.tsx`). Members, Music and Host controls already use it. | **Done** |
| 1 | **Generic state channel.** Replace the music-specific `music` / `music-sync` messages, `rev`/`by` handling and relay in `space.ts` with `plugin-state` keyed by plugin and register, then move music onto it. Add hooks `usePluginState(plugin, key)` for first-party widgets. | Planned |
| 2 | **Manifest loader.** Generalise `listGames()` into a plugin lister (`/plugins.json`, sanitised manifests, games read as `kind: "game"`). Add the host's enable/disable event (`plugins_changed`) and per-plugin write access in `perms_changed`. | Planned |
| 3 | **Bridge and sandbox.** Plugin host component (frame, channel token, validation), `plugin-sdk.js`, quotas, CSP headers for `/plugins/`. First third-party plugin: convert Snake. | Planned |
| 4 | **Events and signals.** The `plugin` event type in `log.ts` (`EventType`, `TYPES`, a validity rule in `derive()`), `fresh` handling, signals channel. First plugin that needs them: a poll. | Planned |
| 5 | **Topbar and stage placements.** Generalise the now-playing chip and the games panel into placements. | Planned |

Music-specific code that phase 1 generalises, so nothing is left behind: `space.ts` (`music`, `musicAt`, `setMusic`, `act`, the `music` and `music-sync` cases, relay of music), `music.ts` (`isNewer`, `positionNow`, `advance`, `sanitize`), `perms.music`, and the "Members can control music" toggle (becomes the generic per-plugin write access, labelled with the plugin's name).

What does **not** generalise and stays music's own: the YouTube IFrame player, queue semantics (`advance`), and the track-end rule ("every peer advances locally and identically"). Those are plugin logic, expressed with the primitives above.

### Compatibility and migration

- Rooms are ephemeral, so moving music onto the generic channel needs no data migration. During a rolling deploy, peers on different versions in one room would not share music; deploy between sessions or accept a brief split.
- `apiVersion` is the contract. Additive changes (new optional calls, new events) keep it; removing or changing a call bumps it, and the host runs the current and previous versions side by side for at least one release.

## 10. Security checklist for plugin authors and reviewers

- Treat everything from `state`, `events` and `signals` as untrusted input: validate shape, clamp numbers, escape text before putting it in the DOM (never `innerHTML` with room data).
- Do not use `by` / `from` for authorisation. Use `events` and their verified `author`.
- Declare every external host you load from. Remember each one learns the viewer's IP address.
- Do not bundle content you do not have the right to redistribute: video, music, game data or fonts. The same policy as games applies (see CLAUDE.md); the Mario remake this project once considered is under a DMCA takedown.
- Keep state small. The log and the registers are copied to every member.

Reviewers: a plugin that needs anything the capability table does not offer should be rejected or promoted to first-party after review, not given a looser sandbox.

## 11. What ambitious plugins would need (not in API v1)

Ideas such as anonymous ballots, hidden-hand card games, shared beat clocks and live captions are the stress test for this spec. They ask for four things v1 does not provide. They are recorded here so v1 is not designed in a way that rules them out.

| Need | Why | Proposed shape (v2) |
|---|---|---|
| **Room clock** | A shared metronome or a synchronised "go" needs every peer to agree on time within a few milliseconds, not seconds. | `time.room()` returns `Date.now()` plus an offset estimated by the host from repeated round trips over the data channel, keeping the lowest-latency samples (the NTP idea). The plugin schedules against it. Output-device latency is not known to the browser, so a plugin must offer a manual offset. |
| **Plugin-scoped keypair** | Anonymous voting and card shuffles need cryptography the plugin controls, but the plugin must never see the member's identity key. | `crypto.pluginKey()` returns a keypair the host derives for (plugin, room) and registers with a signed event, so peers can bind it to the member without the plugin touching the identity key. Needs raw curve operations, so it should be a pure-JS library inside the plugin (WebCrypto cannot do ring signatures). |
| **Private direct messages** | Hidden hands and shuffle steps go to one member only. | Already possible: `signal.send(name, data, { to })` travels over the end-to-end encrypted data channel between the two peers. Signals are never relayed (6.6), which is what keeps them private. A pair that cannot connect directly cannot play hidden-information games; the plugin must say so. |
| **Local media** | Captions need the member's microphone; spatial audio needs remote audio streams. | Not offered to sandboxed plugins (7.1). These stay first-party widgets that use the same state and signal services. |

Not a spec problem, but plugin authors must know: in a peer-to-peer room, **who sent a message is visible to the peer that received it**, so "anonymous" features need the message flooded or relayed so the receiver cannot tell the origin, and they are only as anonymous as the room is large (at most 8 people here).

## 12. Example: a poll

`plugins/poll/plugin.json` as in section 4.1, and `index.html`:

```html
<!doctype html>
<meta charset="utf-8">
<script src="/plugin-sdk.js"></script>
<div id="q"></div><div id="opts"></div>
<script>
deca.ready().then(async (ctx) => {
  Object.entries(ctx.theme).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
  const render = (poll, votes) => {
    q.textContent = poll?.question ?? "No poll yet";
    opts.replaceChildren(...(poll?.options ?? []).map((text, i) => {
      const b = document.createElement("button");
      b.textContent = `${text} (${votes[i] ?? 0})`;          // textContent, never innerHTML
      b.onclick = () => deca.events.append("vote", { option: i });
      return b;
    }));
  };
  let poll = await deca.state.get("poll"), votes = {};
  const tally = (events) => { votes = {}; const seen = new Set(); for (const e of events.reverse()) if (e.type === "vote" && !seen.has(e.author)) { seen.add(e.author); votes[e.data.option] = (votes[e.data.option] ?? 0) + 1; } render(poll, votes); };
  tally(await deca.events.list({}));
  deca.on("state", async () => { poll = await deca.state.get("poll"); render(poll, votes); });
  deca.on("event", async () => tally(await deca.events.list({})));
});
</script>
```

The question and options are shared state (the host, or members if allowed, can change them); each vote is a signed event, so one person cannot vote as another and a person's latest vote is the one that counts.
