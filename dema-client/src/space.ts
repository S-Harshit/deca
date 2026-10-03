/* eslint-disable @typescript-eslint/no-explicit-any -- wire messages are dynamic and validated at ingest */
// A Space ties the mesh (transport) to the event log (state): sync, presence, chat,
// files, host actions and media. The UI subscribes to immutable snapshots.

import { isBlankMessage, safeWebUrl } from "./message";
import type { ExportFile, ExportInput } from "./roomExport";
import { derive, EventLog, HANDS, isEvent, MAX_ARCHIVES, MAX_FILE, MAX_SCORE, rid, type ArchiveRef, type EventType, type SpaceEvent, type SpaceState } from "./log";
import { openArchive, sha256Hex, type ArchiveData } from "./archive";
import type { ParsedImport } from "./roomImport";
import { LocalSignaling, type Code } from "./localSignal";
import type { Addresses } from "./localNetwork";
import { Mesh, type PeerInfo } from "./mesh";
import type { Identity } from "./identity";
import { signEvent, verifyEvent } from "./signing";
import { advance, EMPTY_MUSIC, fetchTitle, isNewer, parseVideoId, positionNow, sanitize, type MusicState } from "./music";

const CHUNK = 16 * 1024;
const ANNOUNCE_TIMEOUT_MS = 4000;
/** Images up to this size are fetched automatically so they can show inline. */
const AUTO_IMAGE_MAX = 10 * 1024 * 1024;

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  // Modest capture: every peer connection encodes its own copy, so 720p30 to several peers
  // can bring an older laptop to its knees.
  width: { ideal: 640 },
  height: { ideal: 360 },
  // No `max`: phone cameras often cannot honour a hard cap and the whole request would fail.
  // The cap is applied afterwards, best effort.
  frameRate: { ideal: 24 },
};
const AUDIO_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true };

export type Transfer = {
  status: "requesting" | "receiving" | "done" | "failed";
  name: string;
  size: number;
  received: number;
  type: string;
  url?: string;
};

export type StreamKind = "camera" | "screen";

/** One video surface: a person's camera or a screen share, local or remote. */
export type Tile = {
  key: string;
  peerId: string;
  stream: MediaStream;
  kind: StreamKind;
  mic: boolean;
  cam: boolean;
  local: boolean;
};

type MediaInfo = { kind: StreamKind; mic: boolean; cam: boolean; started?: number };
const hasTrack = (s: MediaStream, kind: "audio" | "video") =>
  s.getTracks().some((t) => t.kind === kind && t.readyState === "live");

function mediaErrorText(err: unknown) {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError") return "Permission was denied. Allow camera/mic access in your browser.";
  if (name === "NotFoundError") return "No camera or microphone was found.";
  if (name === "NotReadableError") return "The camera or microphone is in use by another app.";
  return err instanceof Error ? err.message : String(err);
}

/** Imported history: the host's signed reference, and the data once it has arrived and been checked. */
export type ArchiveView = { ref: ArchiveRef; data: ArchiveData | null };

/** A room with no signaling server: people join by exchanging short codes (see localSignal.ts). */
export type ManualInfo = {
  codes: Code[];
  invite: string;
  preparing: { peerId: string; name: string }[];
  /** What kinds of address each side's code carried, to explain a failure. */
  diag: { peerId: string; name: string; mine?: Addresses; theirs?: Addresses }[];
  /** People who pasted a code and wait to be let in. */
  requests: { peerId: string; name: string }[];
  /** Words to compare with the person (read aloud or by phone) to be sure nobody sits in the middle. */
  check: { peerId: string; name: string; words: string }[];
};

export type Snapshot = {
  connected: boolean;
  ended: null | "kicked" | "closed" | "replaced" | "full" | "locked" | "taken" | "busy";
  /** The host has closed the room to newcomers. */
  locked: boolean;
  /** How many people a space holds (0 = unknown or unlimited). */
  capacity: number;
  /** People we cannot reach directly but can through a mutual contact: peerId -> the contact's peerId. */
  relays: Map<string, string>;
  /** The latest air horn that arrived live (history never replays it). */
  horn: { id: string; by: string } | null;
  me: string;
  state: SpaceState;
  links: Map<string, PeerInfo["state"]>;
  peers: PeerInfo[];
  transfers: Record<string, Transfer>;
  tiles: Tile[];
  inCall: boolean;
  sharing: boolean;
  micOn: boolean;
  camOn: boolean;
  /** When the current call began (earliest participant), in our clock. null = no call. */
  callStartedAt: number | null;
  mediaError: string;
  /** Ids of coin flips that happened live in this session (history never replays as an animation). */
  fresh: ReadonlySet<string>;
  music: MusicState | null;
  /** Local time the music state was received, to work out the current position. */
  musicAt: number;
  archives: ArchiveView[];
  /**
   * We are in the room's history (our own join is in the log). Until then who is here, who is host and whether we are
   * alone are not known yet, and the UI must not guess (it used to flash "you are the only one here").
   */
  settled: boolean;
  /** Set in a "connect by code" room, which has no server: the codes waiting to be handed over, and the invite link to share. */
  manual: ManualInfo | null;
};

type Incoming = { fileId: string; type: string; chunks: ArrayBuffer[]; received: number };

export class Space {
  readonly log = new EventLog();
  private readonly mesh: Mesh;
  private readonly peerId: string;
  private readonly identity: Identity;
  private locked = false;
  /** Per-author event counts for the last second: a peer flooding events is ignored, not rendered. */
  private readonly floods = new Map<string, { n: number; t: number }>();
  private readonly name: string;
  private readonly listeners = new Set<() => void>();
  private readonly localFiles = new Map<string, File>();
  private readonly incoming = new Map<string, Incoming>();
  private readonly serveQueue = new Map<string, Promise<void>>();
  private readonly remote = new Map<string, Map<string, MediaStream>>();
  private readonly info = new Map<string, Map<string, MediaInfo>>();
  private peers: PeerInfo[] = [];
  private transfers: Record<string, Transfer> = {};
  private initialHost = "";
  private connected = false;
  private capacity = 0;
  /** Which peers each of our direct peers says it is connected to (to know who can reach whom). */
  private readonly remoteLinks = new Map<string, Set<string>>();
  private lastLinks = "";
  private horn: { id: string; by: string } | null = null;
  private lastHornAt = 0;
  private announced = false;
  private tornDown = false;
  private announceTimer?: ReturnType<typeof setTimeout>;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private ended: Snapshot["ended"] = null;
  private camera: MediaStream | null = null;
  private screen: MediaStream | null = null;
  private micOn = true;
  private camOn = true;
  private cameraStartedAt = 0;
  private mediaError = "";
  private music: MusicState | null = null;
  private musicAt = 0;
  private readonly fresh = new Set<string>();
  /** Verified imported history we hold (and can hand to others), by archive id. */
  private readonly archives = new Map<string, ArchiveData>();
  /** Attachment hashes the verified archives promise, so a downloaded file can be checked. */
  private readonly archiveHashes = new Map<string, { aid: string; sha256: string }>();
  private readonly archiveTries = new Map<string, { n: number; at: number }>();
  /** Throws seen live, with the local time they arrived (used to decide what a new throw answers). */
  private readonly liveThrows = new Map<string, { author: string; at: number }>();
  private musicTimer?: ReturnType<typeof setInterval>;
  private snapshot: Snapshot;

  readonly spaceId: string;
  private readonly hub: LocalSignaling | null;

  /** `manual`: no signaling server; `seed` is the person whose invite we followed (null for whoever made the room). */
  constructor(spaceId: string, identity: Identity, name: string, manual?: { hostId: string; seed: { id: string; name: string } | null }) {
    this.spaceId = spaceId;
    this.hub = manual ? new LocalSignaling({ id: identity.peerId, name }, { pub: identity.pub, sign: identity.sign }, manual.hostId, spaceId, manual.seed) : null;
    this.hub?.onChange(() => this.refreshSoon());
    this.identity = identity;
    this.peerId = identity.peerId;
    this.name = name;
    this.snapshot = this.build();
    this.mesh = new Mesh(spaceId, identity.peerId, name, identity.secret, {
      onJoined: (hostId, existing, max, locked) => {
        this.capacity = max ?? this.capacity;
        this.locked = !!locked;
        // Set once: if the server restarts it may name a different creator, which must not change who
        // everyone derives as host from the log.
        this.initialHost ||= hostId;
        this.connected = true;
        // Alone in the room: nothing to sync from, announce right away.
        // Otherwise wait for the first sync reply so we can tell joined from returned.
        // (A reconnect also lands here; announce() does nothing the second time.)
        if (!this.announced) {
          if (existing === 0) this.announce();
          else this.announceTimer ??= setTimeout(() => this.announce(), ANNOUNCE_TIMEOUT_MS);
        }
        this.refresh();
      },
      onRefused: (reason) => {
        this.end(reason === "locked" ? "locked" : reason === "taken" ? "taken" : "busy");
        this.refresh();
      },
      onLockState: (locked) => {
        this.locked = locked;
        this.refresh();
      },
      onFull: (max) => {
        this.capacity = max;
        this.end("full");
        this.refresh();
      },
      onReplaced: () => {
        this.end("replaced");
        this.refresh(); // not inside a refresh here, so the screen has to be told
      },
      onPeers: (peers) => {
        this.peers = peers;
        this.announceLinks();
        this.refresh();
      },
      onPeerOpen: (id) => {
        this.mesh.sendTo(id, { t: "sync", ids: this.log.ids() });
        this.mesh.sendTo(id, { t: "links", ids: this.peers.filter((p) => p.state === "open").map((p) => p.peerId).sort() });
        if (this.camera || this.screen) this.mesh.sendTo(id, this.mediaMsg());
        if (this.music) this.mesh.sendTo(id, { t: "music", s: { ...this.music, pos: positionNow(this.music, this.musicAt) } });
        this.autoFetch();
      },
      onPeerGone: (id) => this.linkGone(id),
      onPeerLeft: (id) => this.peerLeft(id),
      onSignalLost: () => {
        this.connected = false;
        this.refresh();
      },
      onControl: (from, msg) => this.onControl(from, msg),
      onFile: (from, data) => this.onFile(from, data),
      onStream: (id, stream) => {
        let streams = this.remote.get(id);
        if (!streams) this.remote.set(id, (streams = new Map()));
        streams.set(stream.id, stream);
        this.refreshSoon(); // mute/unmute can fire in bursts; don't re-render on each
      },
    }, this.hub ?? undefined);
  }

  // --- React glue ---
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;

  private build(state: SpaceState = derive(this.log.all(), this.initialHost)): Snapshot {
    return {
      connected: this.connected,
      ended: this.ended,
      capacity: this.capacity,
      locked: this.locked,
      relays: this.relayPaths(),
      horn: this.horn,
      me: this.peerId,
      state,
      links: new Map(this.peers.map((p) => [p.peerId, p.state])),
      peers: this.peers,
      transfers: { ...this.transfers },
      tiles: this.tiles(),
      inCall: !!this.camera,
      sharing: !!this.screen,
      micOn: this.micOn,
      camOn: this.camOn,
      callStartedAt: this.callStart(),
      mediaError: this.mediaError,
      fresh: new Set(this.fresh),
      music: this.music,
      musicAt: this.musicAt,
      archives: state.archives.map((ref) => ({ ref, data: this.archives.get(ref.aid) ?? null })),
      settled: state.members.has(this.peerId),
      manual: this.hub ? { codes: [...this.hub.codes], invite: this.hub.inviteLink(location.href.split("#")[0]), preparing: this.hub.preparing().map((id) => ({ peerId: id, name: this.hub!.nameOf(id) })), diag: this.hub.diagnose(), requests: this.hub.waiting(), check: this.hub.checkList() } : null,
    };
  }

  private refresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    const state = derive(this.log.all(), this.initialHost);
    this.enforce(state);
    this.snapshot = this.build(state);
    for (const fn of this.listeners) fn();
    this.fetchArchives(state.archives);
  }

  private refreshSoon() {
    this.refreshTimer ??= setTimeout(() => this.refresh(), 100);
  }

  /** React to kicks / closure that the log now says are in force. */
  private enforce({ kicked, closed }: SpaceState) {
    if (this.ended || this.tornDown) return;
    for (const id of kicked) if (id !== this.peerId) this.mesh.block(id);
    if (closed) this.end("closed");
    else if (kicked.has(this.peerId)) this.end("kicked");
  }

  private end(reason: NonNullable<Snapshot["ended"]>) {
    this.ended = reason;
    this.teardown();
  }

  /** Leave for good: close everything, then drop all UI subscriptions. Safe to call repeatedly. */
  leave() {
    this.teardown();
    this.listeners.clear();
  }

  /** Stops media, timers and every connection; releases file blobs. Idempotent. */
  private teardown() {
    if (this.tornDown) return;
    this.tornDown = true;
    clearTimeout(this.announceTimer);
    clearTimeout(this.refreshTimer);
    clearInterval(this.musicTimer);
    for (const s of [this.camera, this.screen]) s?.getTracks().forEach((t) => t.stop());
    this.camera = this.screen = null;
    this.mesh.close();
    for (const t of Object.values(this.transfers)) if (t.url) URL.revokeObjectURL(t.url);
    this.remote.clear();
    this.info.clear();
    this.incoming.clear();
    this.serveQueue.clear();
    this.localFiles.clear();
  }

  // --- events ---
  /** Write an event: sign it, then add it and send it. Returns its id straight away. */
  private author(type: EventType, payload: Record<string, any>) {
    const id = rid();
    if (type === "rps") this.liveThrows.set(id, { author: this.peerId, at: Date.now() }); // known at once, so a double-click can't throw twice
    const base = { id, author: this.peerId, ts: Date.now(), type, payload };
    void signEvent(base, this.identity)
      .then((event) => {
        this.log.add(event);
        this.noteHorn(event);
        if (type === "coin" || type === "rps" || type === "blame") this.fresh.add(event.id);
        this.mesh.broadcast({ t: "ev", event });
        this.refresh();
      })
      .catch((err) => console.error("could not sign event", err));
    return id;
  }

  /** Flood guard: more than 25 events a second from one author is ignored. */
  private allow(author: string) {
    const now = Date.now();
    const f = this.floods.get(author);
    if (!f || now - f.t > 1000) {
      this.floods.set(author, { n: 1, t: now });
      return true;
    }
    return ++f.n <= 25;
  }

  /** Events from the network are only believed once their signature checks out. */
  private async accept(raw: unknown[]) {
    const todo = raw.slice(0, 5000).filter(isEvent).filter((e) => !this.log.has(e.id));
    const ok = await Promise.all(todo.map((e) => verifyEvent(e)));
    todo.forEach((e, i) => ok[i] && this.log.add(e));
  }

  private async acceptLive(msg: { event?: unknown }, from: string) {
    const e = msg.event;
    if (!isEvent(e) || this.log.has(e.id) || !this.allow(e.author)) return;
    if (!(await verifyEvent(e))) return;
    if (!this.log.add(e)) return; // a copy that arrived a moment earlier already won
    // a flip that arrives live animates; one that comes from a history sync just shows its result
    if (e.type === "coin" || e.type === "rps" || e.type === "blame") this.fresh.add(e.id);
    if (e.type === "rps") this.liveThrows.set(e.id, { author: e.author, at: Date.now() });
    this.noteHorn(e);
    this.relay(msg, from, e.author);
    this.refresh();
    this.autoFetch();
  }

  private announce() {
    if (this.announced || this.ended || this.tornDown) return;
    this.announced = true;
    const back = this.log.lastJoin(this.peerId);
    this.author(back ? "returned" : "joined", { name: this.name });
  }

  /** A link dropped. The peer may still be in the room, so this is not a "left". */
  private linkGone(id: string) {
    this.remoteLinks.delete(id);
    this.remote.delete(id);
    this.info.delete(id);
    this.incoming.delete(id);
    for (const t of Object.values(this.transfers)) if (t.status === "receiving") t.status = "failed";
    this.refresh();
  }

  /** The signaling server confirmed the peer left the room. */
  private peerLeft(id: string) {
    // Deterministic id: every observer authors the same event, so the set union dedupes it.
    const join = this.log.lastJoin(id);
    if (join && !this.ended) {
      const base = {
        id: `left:${id}:${join.id}`,
        author: this.peerId,
        ts: Date.now(),
        type: "left" as const,
        payload: { peerId: id, joinId: join.id },
      };
      void signEvent(base, this.identity)
        .then((event) => {
          if (this.log.add(event)) this.mesh.broadcast({ t: "ev", event });
          this.refresh();
        })
        .catch((err) => console.error("could not sign event", err));
    }
    this.refresh();
  }

  private onControl(from: string, msg: any) {
    switch (msg?.t) {
      case "sync":
        if (Array.isArray(msg.ids)) this.mesh.sendTo(from, { t: "events", events: this.log.missing(msg.ids) });
        break;
      case "events":
        if (Array.isArray(msg.events)) {
          void this.accept(msg.events).then(() => {
            this.announce();
            this.refresh();
            this.autoFetch();
          });
        } else {
          this.announce();
        }
        break;
      case "ev":
        void this.acceptLive(msg, from);
        break;
      case "links":
        if (Array.isArray(msg.ids)) {
          this.remoteLinks.set(from, new Set(msg.ids.filter((x: unknown) => typeof x === "string")));
          this.refresh();
        }
        break;
      case "music": {
        const s = sanitize(msg.s);
        if (!s || !isNewer(s, this.music)) break;
        // Judge the author, not the relay: a newcomer is sent the state by whoever has it.
        const { hostId, perms } = this.snapshot.state;
        if (s.by !== "auto" && s.by !== hostId && !perms.music) break;
        this.setMusic(s, false);
        if (s.by !== "auto") this.relay(msg, from, s.by);
        break;
      }
      case "music-sync": {
        // The DJ's heartbeat: same version, fresh position, so listeners can correct drift.
        const m = this.music;
        if (m && msg.rev === m.rev && msg.by === m.by && Number.isFinite(msg.pos)) {
          this.music = { ...m, pos: Math.max(0, msg.pos) };
          this.musicAt = Date.now();
          this.refresh();
        }
        break;
      }
      case "media":
        if (Array.isArray(msg.streams)) {
          const entries = msg.streams
            .filter((x: any) => typeof x?.id === "string")
            .map((x: any): [string, MediaInfo] => [
              x.id,
              {
                kind: x.kind === "screen" ? "screen" : "camera",
                mic: !!x.mic,
                cam: !!x.cam,
                // they send "how long I've been in the call", which survives differing clocks
                started: Number.isFinite(x.ago) ? Date.now() - x.ago : undefined,
              },
            ]);
          this.info.set(from, new Map(entries));
          this.refresh();
        }
        break;
      case "file-req": {
        const file = this.localFiles.get(msg.fileId);
        if (file) this.serve(from, file, msg.fileId);
        else this.mesh.sendTo(from, { t: "file-missing", fileId: msg.fileId });
        break;
      }
      case "file-missing":
        if (this.transfers[msg.fileId]) this.transfers[msg.fileId].status = "failed";
        this.refresh();
        break;
    }
  }

  // --- chat ---
  private canSpeak(kind: "chat" | "files" | "music") {
    const { hostId, perms } = this.snapshot.state;
    return hostId === this.peerId || perms[kind];
  }

  sendChat(text: string) {
    const t = text.trim();
    if (t && !isBlankMessage(t) && this.canSpeak("chat")) this.author("chat", { text: t.slice(0, 16000) });
  }

  /** Returns an error message, or "" on success. The result is picked on the flipper's device. */
  flipCoin() {
    if (!this.canSpeak("chat")) return "The host has turned chat off";
    this.author("coin", { result: crypto.getRandomValues(new Uint8Array(1))[0] & 1 ? "heads" : "tails" });
    return "";
  }

  private lastScore = 0;
  /** A game in the games panel finished with this score: add it to the room's leaderboard. */
  recordScore(game: string, value: number) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(game) || !Number.isSafeInteger(value) || value <= 0 || value > MAX_SCORE) return;
    if (Date.now() - this.lastScore < 1500) return; // a game that reports twice for one ending, or a loop
    this.lastScore = Date.now();
    this.author("score", { game, value });
  }

  private lastShare = 0;
  /** Open a web page for everyone in the room: they each get one click to open it. Returns an error message, or "". */
  sharePage(input: string) {
    const url = safeWebUrl(input);
    if (!url) return "That is not a web address I can share";
    if (!this.canSpeak("chat")) return "The host has turned chat off";
    if (Date.now() - this.lastShare < 3000) return "Wait a moment before sharing another page";
    this.lastShare = Date.now();
    this.author("page_share", { url });
    return "";
  }

  /** Blame a random person who is here (possibly yourself). Returns an error message, or "". */
  blameSomeone() {
    if (!this.canSpeak("chat")) return "The host has turned chat off";
    const here = [...this.snapshot.state.members.values()].filter((m) => m.online).map((m) => m.peerId);
    if (!here.length) return "Nobody to blame";
    // Rejection sampling, so the pick is not skewed towards the first few people.
    const limit = 0x100000000 - (0x100000000 % here.length);
    let r: number;
    do r = crypto.getRandomValues(new Uint32Array(1))[0];
    while (r >= limit);
    this.author("blame", { target: here[r % here.length] });
    return "";
  }

  /**
   * A random throw, like the coin: nobody can choose, so seeing the other's throw first gives no
   * advantage. A throw answers the oldest unanswered one from someone else in the last 30 seconds.
   * Returns an error message, or "" on success.
   */
  throwRps() {
    if (!this.canSpeak("chat")) return "The host has turned chat off";
    const now = Date.now();
    const answered = this.snapshot.state.rpsPairs;
    const open = [...this.liveThrows].filter(([id, t]) => now - t.at < 30000 && !answered.has(id));
    if (open.some(([, t]) => t.author === this.peerId)) return "You've already thrown. Waiting for someone to answer.";
    const target = open.sort((a, b) => a[1].at - b[1].at)[0];
    const hand = HANDS[crypto.getRandomValues(new Uint8Array(1))[0] % HANDS.length];
    this.author("rps", { throw: hand, ...(target ? { vs: target[0] } : {}) });
    return "";
  }

  /** Tell our direct peers who we are connected to, so they know when someone needs a go-between. */
  private announceLinks() {
    const ids = this.peers.filter((p) => p.state === "open").map((p) => p.peerId).sort();
    const key = ids.join(",");
    if (key === this.lastLinks) return;
    this.lastLinks = key;
    this.mesh.broadcast({ t: "links", ids });
  }

  /**
   * Pass a new event or music change along to direct peers the AUTHOR cannot reach themselves.
   * In a healthy room the author is linked to everyone, so nothing is forwarded; when two people
   * cannot connect directly, anyone who can reach both carries their messages across. Duplicates die
   * at the receiver (events are deduped by id, music by version), so this cannot loop.
   */
  private relay(msg: unknown, from: string, author: string) {
    for (const p of this.peers) {
      if (p.state !== "open" || p.peerId === from || p.peerId === author) continue;
      if (this.remoteLinks.get(author)?.has(p.peerId)) continue; // they hear it straight from the author
      this.mesh.sendTo(p.peerId, msg);
    }
  }

  /** Who we can only reach through someone else (chat and music state; not calls or file transfers). */
  private relayPaths() {
    const out = new Map<string, string>();
    const open = new Set(this.peers.filter((p) => p.state === "open").map((p) => p.peerId));
    for (const m of this.snapshot?.state.members.values() ?? []) {
      if (!m.online || m.peerId === this.peerId || open.has(m.peerId)) continue;
      const via = [...open].find((id) => this.remoteLinks.get(id)?.has(m.peerId));
      if (via) out.set(m.peerId, via);
    }
    return out;
  }

  /**
   * A live air horn from the host makes noise here. Rate-limited on the receiving side too, so
   * neither a spamming host nor a modified browser can blast anyone repeatedly.
   */
  private noteHorn(e: SpaceEvent) {
    if (e.type !== "horn" || e.author !== this.snapshot.state.hostId) return;
    const now = Date.now();
    if (now - this.lastHornAt < 3000) return;
    this.lastHornAt = now;
    this.horn = { id: e.id, by: e.author };
  }

  /** Host only. Returns an error message, or "" on success. */
  soundHorn() {
    if (this.snapshot.state.hostId !== this.peerId) return "Only the host can sound the air horn";
    if (Date.now() - this.lastHornAt < 3000) return "Give it a few seconds";
    this.author("horn", {});
    return "";
  }

  /** Host only (the toggle is only shown to the host): close the room to newcomers, or reopen it. */
  setLocked(locked: boolean) {
    this.locked = locked; // show it straight away; the server's confirmation will agree
    this.mesh.setLock(locked);
    this.refresh();
  }

  /** Try to reach someone again right now (the "Retry" button on a person who won't connect). */
  approveCode(id: string) {
    this.hub?.approve(id);
  }

  refuseCode(id: string) {
    this.hub?.refuse(id);
  }

  /** The words matched (true), or did not (false: cut that link). */
  confirmWords(id: string, matched: boolean) {
    if (matched) this.hub?.confirmWords(id);
    else this.mesh.block(id);
  }

  /** Keep the silent microphone permission until a link is up (see localNetwork.ts). */
  holdMic(stream: MediaStream | null) {
    this.hub?.hold(stream);
  }

  /** A code someone sent us (a "connect by code" room). Returns an empty string, or what is wrong with it. */
  pasteCode(text: string): Promise<string> {
    return this.hub ? this.hub.paste(text) : Promise.resolve("This room uses a server, so it does not take codes.");
  }

  retryPeer(id: string) {
    this.mesh.retryNow(id);
  }

  // --- host actions (peers ignore them unless authored by the current host) ---
  kick(peerId: string) {
    this.author("kick", { peerId });
  }
  handover(peerId: string) {
    this.author("role_changed", { hostId: peerId });
  }
  setPerms(perms: { chat: boolean; files: boolean; music: boolean }) {
    this.author("perms_changed", perms);
  }
  closeSpace() {
    this.author("space_closed", {});
  }

  // --- imported history ---
  /** Host only. Adds a parsed export to this room as read-only history. Returns an error message, or "". */
  importArchive(parsed: ParsedImport) {
    const { state } = this.snapshot;
    if (this.peerId !== state.hostId) return "Only the host can import history";
    if (state.archives.length >= MAX_ARCHIVES) return `A room can hold ${MAX_ARCHIVES} imports`;
    if (state.archives.some((a) => a.aid === parsed.aid)) return "That export is already imported here";
    const { archive } = parsed;
    this.archives.set(archive.aid, archive);
    this.localFiles.set(`arch:${archive.aid}`, new File([parsed.json as BlobPart], "history.json", { type: "application/json" }));
    for (const f of archive.files) {
      const blob = parsed.blobs.get(f.fileId);
      if (!f.present || !blob || this.transfers[f.fileId]) continue;
      this.archiveHashes.set(f.fileId, { aid: archive.aid, sha256: f.sha256 });
      this.localFiles.set(f.fileId, new File([blob], f.name, { type: f.type }));
      this.transfers[f.fileId] = { status: "done", name: f.name, size: f.size, received: f.size, type: f.type, url: URL.createObjectURL(blob) };
    }
    for (const f of archive.files) if (f.present) this.archiveHashes.set(f.fileId, { aid: archive.aid, sha256: f.sha256 });
    this.author("archive_added", { aid: archive.aid, sha256: parsed.sha256, bytes: parsed.json.length, events: archive.events.length, from: archive.from });
    return "";
  }

  /** Ask a peer for any imported history we have a signed reference for but no data. Cheap to call often. */
  private fetchArchives(refs: ArchiveRef[]) {
    if (this.tornDown) return;
    for (const ref of refs) {
      if (this.archives.has(ref.aid) || this.peerId === ref.by) continue;
      const key = `arch:${ref.aid}`;
      const tries = this.archiveTries.get(ref.aid) ?? { n: 0, at: 0 };
      const busy = this.transfers[key] && this.transfers[key].status !== "failed";
      if (busy || tries.n >= 8 || Date.now() - tries.at < 3000) continue;
      // The importer first, then anyone else who is connected and may hold it.
      const open = this.snapshot.peers.filter((p) => p.state === "open").map((p) => p.peerId);
      const order = [ref.by, ...open.filter((id) => id !== ref.by)].filter((id) => open.includes(id));
      const holder = order[tries.n % Math.max(1, order.length)];
      if (!holder) continue;
      this.archiveTries.set(ref.aid, { n: tries.n + 1, at: Date.now() });
      this.transfers[key] = { status: "requesting", name: "history", size: ref.bytes, received: 0, type: "application/json" };
      if (!this.mesh.sendTo(holder, { t: "file-req", fileId: key })) delete this.transfers[key];
    }
  }

  private async acceptArchive(aid: string, chunks: ArrayBuffer[] | null) {
    const ref = this.snapshot.state.archives.find((a) => a.aid === aid);
    if (!ref || this.archives.has(aid) || !chunks) return this.refresh();
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    const data = await openArchive(bytes, ref.sha256);
    if (!data || data.aid !== aid) return this.refresh(); // wrong or tampered bytes: ignored, and asked for again from someone else
    this.archives.set(aid, data);
    for (const f of data.files) if (f.present) this.archiveHashes.set(f.fileId, { aid, sha256: f.sha256 });
    this.localFiles.set(`arch:${aid}`, new File([bytes as BlobPart], "history.json", { type: "application/json" }));
    this.refresh();
    this.autoFetch();
  }

  /** Fetch an imported attachment from the person who imported it. */
  requestArchiveFile(aid: string, offer: SpaceEvent) {
    const ref = this.snapshot.state.archives.find((a) => a.aid === aid);
    const { fileId, name, size, type } = offer.payload;
    if (!ref || this.transfers[fileId]) return;
    this.transfers[fileId] = { status: "requesting", name, size, received: 0, type: String(type ?? "") };
    if (!this.mesh.sendTo(ref.by, { t: "file-req", fileId })) this.transfers[fileId].status = "failed";
    this.refresh();
  }

  // --- export ---
  /** What this device holds that an export can contain. Files are only those already here (shared by us or loaded). */
  async exportInput(): Promise<ExportInput> {
    const { state } = this.snapshot;
    const files: ExportFile[] = [];
    for (const [fileId, t] of Object.entries(this.transfers)) {
      if (t.status !== "done" || fileId.startsWith("arch:")) continue;
      try {
        const blob = this.localFiles.get(fileId) ?? (t.url ? await (await fetch(t.url)).blob() : null);
        if (blob) files.push({ fileId, name: t.name, type: t.type, size: blob.size, blob });
      } catch {
        // a file that can't be read back is simply left out
      }
    }
    // Imported history is part of what this room holds, so an export keeps it (as plain signed events).
    // Only real, signed log events: succession adds unsigned "X is now host" lines that exist only in the derived view.
    const real = state.visible.filter((e) => this.log.has(e.id));
    const have = new Set(real.map((e) => e.id));
    const members = [...state.members.values()].map((m) => ({ peerId: m.peerId, name: m.name, firstJoin: m.firstJoin, online: m.online }));
    const extra: SpaceEvent[] = [];
    for (const data of this.archives.values()) {
      for (const e of data.events) {
        if (have.has(e.id)) continue;
        have.add(e.id);
        extra.push(e);
        if (!members.some((m) => m.peerId === e.author)) members.push({ peerId: e.author, name: data.names[e.author] ?? e.author, firstJoin: e.ts, online: false });
      }
    }
    const events = extra.length ? [...real, ...extra].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1)) : real;
    return { spaceId: this.spaceId, me: { id: this.peerId, name: this.name }, hostId: state.hostId, closed: state.closed, members, events, files };
  }

  /** Total size of the files an export could include, for the dialog. */
  heldFileStats() {
    let count = 0;
    let bytes = 0;
    for (const [id, t] of Object.entries(this.transfers)) {
      if (t.status === "done" && !id.startsWith("arch:")) {
        count++;
        bytes += t.size;
      }
    }
    return { count, bytes };
  }

  // --- files ---
  /** Returns an error message, or "" on success. */
  offerFile(file: File) {
    if (file.size > MAX_FILE) return `File is over the ${MAX_FILE / 1024 / 1024} MB limit`;
    if (!this.canSpeak("files")) return "The host has disabled file sharing";
    const fileId = rid();
    this.localFiles.set(fileId, file);
    // Our own copy is already here, so images we share preview instantly.
    this.transfers[fileId] = {
      status: "done",
      name: file.name,
      size: file.size,
      received: file.size,
      type: file.type,
      url: URL.createObjectURL(file),
    };
    this.author("file_offer", { fileId, name: file.name, size: file.size, type: file.type });
    return "";
  }

  requestFile(offer: SpaceEvent) {
    const { fileId, name, size, type } = offer.payload;
    if (this.transfers[fileId]) return;
    this.transfers[fileId] = { status: "requesting", name, size, received: 0, type: String(type ?? "") };
    if (!this.mesh.sendTo(offer.author, { t: "file-req", fileId })) this.transfers[fileId].status = "failed";
    this.refresh();
  }

  /** Pull shared images on our own so they render inline, as long as the sender is reachable. */
  private autoFetch() {
    if (this.tornDown) return;
    for (const e of this.snapshot.state.visible) {
      const p = e.payload;
      if (e.type !== "file_offer" || e.author === this.peerId || this.transfers[p.fileId]) continue;
      if (!String(p.type).startsWith("image/") || p.size > AUTO_IMAGE_MAX) continue;
      if (this.snapshot.links.get(e.author) === "open") this.requestFile(e);
    }
    for (const [aid, data] of this.archives) {
      const ref = this.snapshot.state.archives.find((a) => a.aid === aid);
      if (!ref || ref.by === this.peerId || this.snapshot.links.get(ref.by) !== "open") continue;
      for (const f of data.files) {
        if (f.present && f.type.startsWith("image/") && f.size <= AUTO_IMAGE_MAX && !this.transfers[f.fileId]) {
          const offer = data.events.find((e) => e.type === "file_offer" && e.payload.fileId === f.fileId);
          if (offer) this.requestArchiveFile(aid, offer);
        }
      }
    }
  }

  private serve(to: string, file: File, fileId: string) {
    // One transfer at a time per receiver: chunks carry no id, order defines the file.
    const prev = this.serveQueue.get(to) ?? Promise.resolve();
    const next = prev
      .then(async () => {
        await this.mesh.sendFile(to, JSON.stringify({ t: "start", fileId, type: file.type }));
        for (let o = 0; o < file.size; o += CHUNK) {
          await this.mesh.sendFile(to, await file.slice(o, o + CHUNK).arrayBuffer());
        }
        await this.mesh.sendFile(to, JSON.stringify({ t: "end", fileId }));
      })
      .catch(() => undefined);
    this.serveQueue.set(to, next);
  }

  private onFile(from: string, data: string | ArrayBuffer) {
    if (typeof data === "string") {
      const m = JSON.parse(data);
      if (m.t === "start" && this.transfers[m.fileId]) {
        this.incoming.set(from, { fileId: m.fileId, type: String(m.type ?? ""), chunks: [], received: 0 });
        this.transfers[m.fileId].status = "receiving";
        this.refresh();
      } else if (m.t === "end") {
        void this.finishIncoming(from);
      }
      return;
    }

    const inc = this.incoming.get(from);
    const t = inc && this.transfers[inc.fileId];
    if (!inc || !t) return;
    inc.chunks.push(data);
    inc.received += data.byteLength;
    if (inc.received > Math.min(t.size, MAX_FILE)) {
      t.status = "failed";
      this.incoming.delete(from);
      this.refresh();
      return;
    }
    const before = Math.floor((t.received / t.size) * 100);
    t.received = inc.received;
    if (Math.floor((t.received / t.size) * 100) !== before) this.refresh();
  }

  private async finishIncoming(from: string) {
    const inc = this.incoming.get(from);
    const t = inc && this.transfers[inc.fileId];
    this.incoming.delete(from);
    if (!inc || !t) return;
    if (inc.fileId.startsWith("arch:")) {
      delete this.transfers[inc.fileId];
      void this.acceptArchive(inc.fileId.slice(5), inc.received === t.size ? inc.chunks : null);
      return;
    }
    if (inc.received !== t.size) {
      t.status = "failed";
      this.refresh();
      return;
    }
    const blob = new Blob(inc.chunks, { type: inc.type });
    const promised = this.archiveHashes.get(inc.fileId);
    if (promised) {
      // An imported attachment: its bytes must match the hash the host's signed archive promised.
      void sha256Hex(new Uint8Array(await blob.arrayBuffer())).then((h) => {
        if (h === promised.sha256) {
          t.url = URL.createObjectURL(blob);
          t.status = "done";
        } else t.status = "failed";
        this.refresh();
      });
      return;
    }
    t.url = URL.createObjectURL(blob);
    t.status = "done";
    this.refresh();
  }

  // --- music ---
  private setMusic(next: MusicState, broadcast: boolean) {
    this.music = next;
    this.musicAt = Date.now();
    if (broadcast) this.mesh.broadcast({ t: "music", s: next });
    // Whoever last touched the music keeps everyone's clock honest.
    clearInterval(this.musicTimer);
    if (next.playing && next.by === this.peerId) {
      this.musicTimer = setInterval(() => {
        const m = this.music;
        if (m?.playing) this.mesh.broadcast({ t: "music-sync", rev: m.rev, by: m.by, pos: positionNow(m, this.musicAt) });
      }, 10000);
    }
    this.refresh();
  }

  private act(change: (frozen: MusicState) => Partial<MusicState>) {
    if (this.tornDown || !this.canSpeak("music")) return;
    const cur = this.music ?? EMPTY_MUSIC;
    const frozen = { ...cur, pos: positionNow(cur, this.musicAt) }; // freeze the position before changing anything
    this.setMusic({ ...frozen, ...change(frozen), rev: cur.rev + 1, by: this.peerId }, true);
  }

  /** Returns an error message, or "" on success. */
  async musicAdd(input: string) {
    const vid = parseVideoId(input);
    if (!vid) return /[?&]list=/.test(input) ? "That's a playlist link. Paste a video link instead (playlists aren't supported)" : "That doesn't look like a YouTube link";
    if (!this.canSpeak("music")) return "The host has turned music controls off";
    const meta = await fetchTitle(vid);
    if ("error" in meta) return meta.error;
    const track = { vid, title: meta.title, by: this.peerId };
    this.act((s) => (s.cur ? { queue: [...s.queue, track].slice(0, 50) } : { cur: track, playing: true, pos: 0 }));
    return "";
  }
  musicToggle() {
    this.act((s) => (s.cur ? { playing: !s.playing } : {}));
  }
  musicSeek(seconds: number) {
    this.act((s) => (s.cur ? { pos: Math.max(0, seconds) } : {}));
  }
  musicNext() {
    this.act((s) => {
      const [next, ...rest] = s.queue;
      return { cur: next ?? null, queue: rest, playing: !!next, pos: 0 };
    });
  }
  musicRemove(index: number) {
    this.act((s) => ({ queue: s.queue.filter((_, i) => i !== index) }));
  }
  /** A player reached the end of version `rev`. Every peer advances locally, identically. */
  musicEnded(rev: number) {
    if (this.tornDown || !this.music?.cur || this.music.rev !== rev) return;
    this.setMusic(advance(this.music), false);
  }

  // --- media ---
  /** The call began when its earliest participant joined it. No camera streams means no call. */
  private callStart(): number | null {
    const starts: number[] = [];
    if (this.camera) starts.push(this.cameraStartedAt);
    for (const [, streams] of this.info) {
      for (const i of streams.values()) if (i.kind === "camera" && i.started) starts.push(i.started);
    }
    return starts.length ? Math.min(...starts) : null;
  }

  private tiles(): Tile[] {
    const out: Tile[] = [];
    if (this.screen) {
      const key = `${this.peerId}:${this.screen.id}`;
      out.push({ key, peerId: this.peerId, stream: this.screen, kind: "screen", mic: hasTrack(this.screen, "audio"), cam: true, local: true });
    }
    if (this.camera) {
      const key = `${this.peerId}:${this.camera.id}`;
      const mic = this.micOn && hasTrack(this.camera, "audio");
      const cam = this.camOn && hasTrack(this.camera, "video");
      out.push({ key, peerId: this.peerId, stream: this.camera, kind: "camera", mic, cam, local: true });
    }
    const connected = new Set(this.peers.filter((p) => p.state === "open").map((p) => p.peerId));
    for (const [peerId, streams] of this.remote) {
      if (!connected.has(peerId)) continue; // no tile for someone who is still connecting (or keeps failing)
      for (const [id, stream] of streams) {
        if (stream.getTracks().length === 0) continue; // sender stopped it
        const i = this.info.get(peerId)?.get(id);
        out.push({
          key: `${peerId}:${id}`,
          peerId,
          stream,
          kind: i?.kind ?? "camera",
          mic: i?.mic ?? hasTrack(stream, "audio"),
          cam: (i?.cam ?? true) && hasTrack(stream, "video"),
          local: false,
        });
      }
    }
    return out;
  }

  /** What we tell peers about our streams: which is a screen, and whether mic/camera are on. */
  private mediaMsg() {
    const streams = [];
    if (this.camera) {
      streams.push({
        id: this.camera.id,
        kind: "camera",
        mic: this.micOn && hasTrack(this.camera, "audio"),
        cam: this.camOn && hasTrack(this.camera, "video"),
        ago: Date.now() - this.cameraStartedAt,
      });
    }
    if (this.screen) streams.push({ id: this.screen.id, kind: "screen", mic: hasTrack(this.screen, "audio"), cam: true });
    return { t: "media", streams };
  }

  private publish() {
    this.mesh.setLocalStreams([this.camera, this.screen].filter((s): s is MediaStream => !!s));
    this.mesh.broadcast(this.mediaMsg());
    this.refresh();
  }

  /** Join the call: camera + mic, falling back to mic only if there is no usable camera. */
  async startCamera() {
    if (this.tornDown || this.camera) return;
    this.mediaError = "";
    try {
      if (!navigator.mediaDevices) throw new Error("Camera needs a secure context: use https:// or localhost");
      const gum = (c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c);
      let stream: MediaStream | undefined;
      let why = "";
      // Progressively simpler requests: a strict one can fail on phones even with a working camera.
      for (const video of [VIDEO_CONSTRAINTS, true]) {
        try {
          stream = await gum({ video, audio: AUDIO_CONSTRAINTS });
          break;
        } catch (err) {
          why = err instanceof DOMException ? err.name : String(err);
          if (why === "NotAllowedError") break; // the user said no; asking again won't help
        }
      }
      if (!stream) {
        stream = await gum({ audio: AUDIO_CONSTRAINTS });
        this.mediaError = `Camera unavailable (${why}): joined with microphone only.`;
      }
      stream.getVideoTracks().forEach((t) => {
        t.applyConstraints({ frameRate: { max: 24 } }).catch(() => undefined);
        t.contentHint = "motion";
        t.addEventListener("ended", () => this.stopCamera());
      });
      this.camera = stream;
      this.cameraStartedAt = Date.now();
      this.micOn = true;
      this.camOn = stream.getVideoTracks().length > 0;
      this.publish();
      return;
    } catch (err) {
      this.mediaError = mediaErrorText(err);
    }
    this.refresh();
  }

  stopCamera() {
    if (!this.camera) return;
    this.camera.getTracks().forEach((t) => t.stop());
    this.camera = null;
    this.publish();
  }

  /** Screen sharing is independent of the camera, so both can run at once. */
  async startScreen() {
    if (this.tornDown || this.screen) return;
    this.mediaError = "";
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Screen sharing isn't available in this browser");
      const video = { frameRate: { ideal: 10, max: 15 }, width: { max: 1280 }, height: { max: 720 } };
      // Ask for sound too: the picker offers it (a tab, or the whole screen on Windows/ChromeOS) and the person may decline.
      // No voice processing: it would mangle music and film audio. Browsers that reject the option get a video-only share.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, systemAudio: "include" } as DisplayMediaStreamOptions);
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotAllowedError") throw err;
        stream = await navigator.mediaDevices.getDisplayMedia({ video });
      }
      stream.getAudioTracks().forEach((t) => (t.contentHint = "music"));
      stream.getVideoTracks().forEach((t) => {
        t.contentHint = "detail";
        t.addEventListener("ended", () => this.stopScreen()); // the browser's own "Stop sharing"
      });
      this.screen = stream;
      this.publish();
      return;
    } catch (err) {
      // Cancelling the picker is not an error worth showing.
      if (!(err instanceof DOMException && err.name === "NotAllowedError")) this.mediaError = mediaErrorText(err);
    }
    this.refresh();
  }

  stopScreen() {
    if (!this.screen) return;
    this.screen.getTracks().forEach((t) => t.stop());
    this.screen = null;
    this.publish();
  }

  toggleMic() {
    if (!this.camera) return;
    this.micOn = !this.micOn;
    this.camera.getAudioTracks().forEach((t) => (t.enabled = this.micOn));
    this.mesh.broadcast(this.mediaMsg());
    this.refresh();
  }

  toggleCam() {
    if (!this.camera || this.camera.getVideoTracks().length === 0) return;
    this.camOn = !this.camOn;
    this.camera.getVideoTracks().forEach((t) => (t.enabled = this.camOn));
    this.mesh.broadcast(this.mediaMsg());
    this.refresh();
  }
}
