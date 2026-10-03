/* eslint-disable @typescript-eslint/no-explicit-any -- wire messages are dynamic and validated at ingest */
// Pure event-log logic: no DOM, no WebRTC. Everything a space "is" is derived from the log.

export const MAX_FILE = 50 * 1024 * 1024;

import { safeWebUrl } from "./message";

/** Largest score accepted, and how many results one person can add to a room (the log keeps every event). */
export const MAX_SCORE = 1_000_000_000;
const MAX_SCORES_PER_AUTHOR = 200;

export type EventType =
  | "joined"
  | "returned"
  | "left"
  | "chat"
  | "file_offer"
  | "role_changed"
  | "kick"
  | "perms_changed"
  | "space_closed"
  | "coin"
  | "rps"
  | "blame"
  | "archive_added"
  | "page_share"
  | "score"
  | "horn";

export type SpaceEvent = {
  id: string;
  author: string;
  ts: number;
  type: EventType;
  payload: Record<string, any>;
  /** The author's public key and the signature over this event (see signing.ts). */
  pub?: string;
  sig?: string;
};

const TYPES = new Set<string>([
  "joined",
  "returned",
  "left",
  "chat",
  "file_offer",
  "role_changed",
  "kick",
  "perms_changed",
  "space_closed",
  "coin",
  "rps",
  "blame",
  "archive_added",
  "page_share",
  "score",
  "horn",
]);

// crypto.randomUUID needs a secure context; getRandomValues does not.
export const rid = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

export function isEvent(x: any): x is SpaceEvent {
  return (
    !!x &&
    typeof x.id === "string" &&
    x.id.length < 64 &&
    typeof x.author === "string" &&
    typeof x.ts === "number" &&
    TYPES.has(x.type) &&
    typeof x.payload === "object" &&
    x.payload !== null
  );
}

export class EventLog {
  private readonly events = new Map<string, SpaceEvent>();

  /** Returns true if the event was new. */
  add(e: SpaceEvent) {
    if (this.events.has(e.id)) return false;
    this.events.set(e.id, e);
    return true;
  }

  has(id: string) {
    return this.events.has(id);
  }

  ids() {
    return [...this.events.keys()];
  }

  all() {
    return [...this.events.values()];
  }

  /** Events the other side does not have, given the ids it holds (set-union sync). */
  missing(theirIds: string[]) {
    const have = new Set(theirIds);
    return this.all().filter((e) => !have.has(e.id));
  }

  /** The most recent joined/returned event of a peer: identifies their current session. */
  lastJoin(peerId: string) {
    let best: SpaceEvent | undefined;
    for (const e of this.events.values()) {
      if ((e.type === "joined" || e.type === "returned") && e.author === peerId) {
        if (!best || e.ts > best.ts) best = e;
      }
    }
    return best;
  }
}

export const HANDS = ["rock", "paper", "scissors"] as const;
export type Hand = (typeof HANDS)[number];
const BEATS: Record<Hand, Hand> = { rock: "scissors", scissors: "paper", paper: "rock" };

/** "win" if a beats b, "lose" if b beats a, otherwise "draw". */
export function rpsOutcome(a: Hand, b: Hand): "win" | "lose" | "draw" {
  if (a === b) return "draw";
  return BEATS[a] === b ? "win" : "lose";
}

export type Member = { peerId: string; name: string; online: boolean; joinId: string; firstJoin: number };

export type SpaceState = {
  hostId: string;
  members: Map<string, Member>;
  kicked: Set<string>;
  closed: boolean;
  perms: { chat: boolean; files: boolean; music: boolean };
  /** Rock-paper-scissors throws that were answered: each side maps to the other. */
  rpsPairs: Map<string, string>;
  /** The throw in each pair that was the answer (it carries the result). */
  rpsSecond: Set<string>;
  /** Valid events only, in display order. */
  visible: SpaceEvent[];
  /** Read-only history the host added from an export; the data itself travels peer to peer, bound to `sha256`. */
  archives: ArchiveRef[];
};

/** What the host's signed `archive_added` event commits to. */
export type ArchiveRef = {
  /** The id of the log event that added it. */
  id: string;
  aid: string;
  sha256: string;
  bytes: number;
  events: number;
  /** The room it was exported from, and who added it here. */
  from: string;
  by: string;
  at: number;
};

export const MAX_ARCHIVES = 3;
export const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
export const MAX_ARCHIVE_EVENTS = 5000;

/** Someone who is talking is here, whatever a stale "left" said. */
function reviveIfActive(members: Map<string, Member>, peerId: string) {
  const m = members.get(peerId);
  if (m) m.online = true;
}

const byOrder = (a: SpaceEvent, b: SpaceEvent) => a.ts - b.ts || (a.id < b.id ? -1 : 1);

/**
 * Fold the log into state. Admin events (role_changed, kick, perms_changed, space_closed)
 * only count when authored by whoever was host at that point in the ordered log.
 * Authorship is self-claimed (no signatures: WebCrypto is unavailable on plain http), so this
 * is a trust-your-room model, not a security boundary.
 */
export function derive(events: SpaceEvent[], initialHost: string): SpaceState {
  let hostId = initialHost;
  let closed = false;
  let perms = { chat: true, files: true, music: true };
  const members = new Map<string, Member>();
  const scoreCount = new Map<string, number>();
  const kicked = new Set<string>();
  const visible: SpaceEvent[] = [];
  const throws: SpaceEvent[] = [];
  const archives: ArchiveRef[] = [];

  /**
   * Succession: when the host is offline, the longest-standing online member takes over
   * (earliest first join, id as tiebreak). Pure function of the log, so every peer agrees.
   */
  const electIfHostGone = (at: SpaceEvent) => {
    const host = members.get(hostId);
    if (!host || host.online) return;
    const next = [...members.values()]
      .filter((m) => m.online)
      .sort((a, b) => a.firstJoin - b.firstJoin || (a.peerId < b.peerId ? -1 : 1))[0];
    if (!next) return;
    hostId = next.peerId;
    visible.push({
      id: `auto-host:${at.id}`,
      author: next.peerId,
      ts: at.ts,
      type: "role_changed",
      payload: { hostId: next.peerId, auto: true },
    });
  };

  for (const e of [...events].sort(byOrder)) {
    if (closed || kicked.has(e.author)) continue;
    const isHost = e.author === hostId;
    const p = e.payload;

    switch (e.type) {
      case "joined":
      case "returned":
        members.set(e.author, {
          peerId: e.author,
          name: String(p.name ?? e.author).slice(0, 32),
          online: true,
          joinId: e.id,
          firstJoin: members.get(e.author)?.firstJoin ?? e.ts,
        });
        visible.push(e);
        electIfHostGone(e); // e.g. the host left earlier and nobody was online to take over
        break;
      case "left": {
        const m = members.get(p.peerId);
        if (m && m.joinId === p.joinId) {
          m.online = false;
          visible.push(e);
          electIfHostGone(e);
        }
        break;
      }
      case "chat":
        if (typeof p.text === "string" && p.text.length <= 20000 && (isHost || perms.chat)) {
          visible.push(e);
          reviveIfActive(members, e.author);
        }
        break;
      case "file_offer":
        if (
          typeof p.fileId === "string" &&
          !p.fileId.startsWith("arch:") && // reserved for imported history
          typeof p.name === "string" &&
          typeof p.size === "number" &&
          p.size <= MAX_FILE &&
          (isHost || perms.files)
        ) {
          visible.push(e);
          reviveIfActive(members, e.author);
        }
        break;
      case "coin":
        if ((p.result === "heads" || p.result === "tails") && (isHost || perms.chat)) visible.push(e);
        break;
      case "archive_added":
        // Host only, bounded, and each commits to one exact blob by hash so no one can swap its contents.
        if (
          isHost &&
          archives.length < MAX_ARCHIVES &&
          typeof p.aid === "string" && /^[a-f0-9]{12}$/.test(p.aid) &&
          typeof p.sha256 === "string" && /^[a-f0-9]{64}$/.test(p.sha256) &&
          typeof p.bytes === "number" && p.bytes > 0 && p.bytes <= MAX_ARCHIVE_BYTES &&
          typeof p.events === "number" && p.events >= 0 && p.events <= MAX_ARCHIVE_EVENTS &&
          typeof p.from === "string" &&
          !archives.some((a) => a.aid === p.aid)
        ) {
          archives.push({ id: e.id, aid: p.aid, sha256: p.sha256, bytes: p.bytes, events: p.events, from: p.from.slice(0, 40), by: e.author, at: e.ts });
          visible.push(e);
        }
        break;
      case "page_share":
        // "Open this page for everyone": the address is checked here too, so a forged event cannot carry javascript: or a disguised login.
        if (safeWebUrl(p.url) && (isHost || perms.chat)) visible.push(e);
        break;
      case "blame":
        // The target must be someone who has joined; the pick itself is made on the author's device, like the coin.
        if (typeof p.target === "string" && members.has(p.target) && (isHost || perms.chat)) visible.push(e);
        break;
      case "rps":
        if (HANDS.includes(p.throw) && (isHost || perms.chat)) {
          visible.push(e);
          throws.push(e);
        }
        break;
      case "score":
        // A game result from the author's own device (self-reported, like the coin): bounded, and only members count.
        if (/^[a-z0-9_-]{1,40}$/i.test(String(p.game)) && Number.isSafeInteger(p.value) && p.value >= 0 && p.value <= MAX_SCORE && members.has(e.author) && (scoreCount.get(e.author) ?? 0) < MAX_SCORES_PER_AUTHOR) {
          scoreCount.set(e.author, (scoreCount.get(e.author) ?? 0) + 1);
          visible.push(e);
        }
        break;
      case "horn":
        if (isHost) visible.push(e); // only the host can sound it; history shows the line, never replays the sound
        break;
      case "role_changed":
        if (isHost && typeof p.hostId === "string") {
          hostId = p.hostId;
          visible.push(e);
        }
        break;
      case "kick":
        if (isHost && p.peerId !== hostId) {
          kicked.add(p.peerId);
          const m = members.get(p.peerId);
          if (m) m.online = false;
          visible.push(e);
        }
        break;
      case "perms_changed":
        if (isHost) {
          perms = { chat: !!p.chat, files: !!p.files, music: p.music !== false };
          visible.push(e);
        }
        break;
      case "space_closed":
        if (isHost) {
          closed = true;
          visible.push(e);
        }
        break;
    }
  }

  // Pair each answering throw (it names the throw it answers) with its target. Done after the fold so
  // a skewed clock can't make an answer look like it came first; the first valid answer wins.
  const byId = new Map(throws.map((t) => [t.id, t]));
  const rpsPairs = new Map<string, string>();
  const rpsSecond = new Set<string>();
  for (const t of throws) {
    const target = typeof t.payload.vs === "string" ? byId.get(t.payload.vs) : undefined;
    if (!target || target.author === t.author || rpsPairs.has(t.id) || rpsPairs.has(target.id)) continue;
    rpsPairs.set(t.id, target.id);
    rpsPairs.set(target.id, t.id);
    rpsSecond.add(t.id);
  }

  return { hostId, members, kicked, closed, perms, rpsPairs, rpsSecond, visible, archives };
}
