// What a room can hold besides chat: pages and notes, polls, and a drawing board. Each is made of small signed
// events; this file folds them into state (derive() in log.ts calls applyTool) and holds every limit, so a hostile member cannot make
// the room heavy. Nothing here is stored anywhere: it lives and ends with the room's log.
import type { SpaceEvent } from "./log";

export const TOOL_TYPES = ["doc_set", "doc_del", "blk_set", "poll_new", "poll_vote", "poll_end", "draw", "draw_clear"] as const;
const SET = new Set<string>(TOOL_TYPES);
export const isToolType = (t: string) => SET.has(t);

export const LIMITS = {
  docs: 40,
  pageChars: 40_000,
  noteChars: 20_000, // all the paragraphs of one note together
  blocks: 400, // paragraphs in one note
  blockChars: 2_000,
  titleChars: 80,
  polls: 20,
  pollQuestion: 200,
  pollOptions: 8,
  optionChars: 80,
  strokes: 1500,
  strokePoints: 300, // x,y pairs per stroke
} as const;

/** Drawing colours, by index (so an event can never carry arbitrary CSS). The last one paints the paper colour: the eraser. */
export const PALETTE = ["#111111", "#d92d20", "#1d4ed8", "#15803d", "#ea8a0c", "#7e22ce", "#6b7280", "#ffffff"];

/** One paragraph of a note. Notes are lists of these, so two people typing in different paragraphs never overwrite each other. */
export type Block = { id: string; key: string; text: string; editor: string; ts: number };
export type Doc = { id: string; kind: "page" | "note"; title: string; /** a page's HTML (empty for a note) */ body: string; /** a note's paragraphs */ blocks: Map<string, Block>; owner: string; editor: string; ts: number; rev: number };
export type Poll = { id: string; q: string; opts: string[]; author: string; ended: boolean; votes: Map<string, number> };
export type Stroke = { id: string; author: string; c: number; w: number; pts: number[] };
export type RoomTools = { docs: Map<string, Doc>; polls: Map<string, Poll>; strokes: Stroke[] };

export const emptyTools = (): RoomTools => ({ docs: new Map(), polls: new Map(), strokes: [] });

const ID = /^[a-f0-9]{12}$/;
const KEY = /^[0-9A-Za-z]{1,24}$/;

/**
 * Apply one event. `ok` says the author is a member who may speak in this room. Returns true when the event should also appear
 * in the feed as a line (only creations do: edits, votes and strokes would flood it).
 */
export function applyTool(t: RoomTools, e: SpaceEvent, ok: boolean, isHost: boolean): boolean {
  if (!ok) return false;
  const p = e.payload;
  switch (e.type) {
    case "doc_set": {
      if (!ID.test(String(p.id)) || (p.kind !== "page" && p.kind !== "note")) return false;
      // A note's text lives in its paragraphs (blk_set); only a page carries a body here.
      const body = p.kind === "page" && typeof p.body === "string" ? p.body : "";
      if (body.length > LIMITS.pageChars || typeof p.title !== "string") return false;
      const title = p.title.slice(0, LIMITS.titleChars) || "Untitled";
      const had = t.docs.get(p.id);
      if (!had) {
        if (t.docs.size >= LIMITS.docs) return false;
        t.docs.set(p.id, { id: p.id, kind: p.kind, title, body, blocks: new Map(), owner: e.author, editor: e.author, ts: e.ts, rev: 1 });
        return true;
      }
      // A page can only be changed by its author (or the host); a note by anyone in the room. The kind never changes.
      if (had.kind !== p.kind || (had.kind === "page" && had.owner !== e.author && !isHost)) return false;
      Object.assign(had, { title, ...(had.kind === "page" ? { body } : {}), editor: e.author, ts: e.ts, rev: had.rev + 1 });
      return false;
    }
    case "doc_del": {
      const d = t.docs.get(String(p.id));
      if (d && (d.owner === e.author || isHost)) t.docs.delete(d.id);
      return false;
    }
    case "blk_set": {
      // One paragraph of a note: the latest event for a paragraph wins, and paragraphs are ordered by `key`, so edits in different
      // paragraphs (or new paragraphs between others) from different people merge exactly.
      const d = t.docs.get(String(p.doc));
      if (!d || d.kind !== "note" || !ID.test(String(p.id)) || typeof p.key !== "string" || !KEY.test(p.key)) return false;
      if (p.del === true) {
        d.blocks.delete(p.id);
        return false;
      }
      if (typeof p.text !== "string" || p.text.length > LIMITS.blockChars) return false;
      const fresh = !d.blocks.has(p.id);
      if (fresh && d.blocks.size >= LIMITS.blocks) return false;
      let total = p.text.length;
      for (const b of d.blocks.values()) if (b.id !== p.id) total += b.text.length;
      if (total > LIMITS.noteChars) return false;
      d.blocks.set(p.id, { id: p.id, key: p.key, text: p.text, editor: e.author, ts: e.ts });
      d.editor = e.author;
      d.ts = e.ts;
      return false;
    }
    case "poll_new": {
      const opts = Array.isArray(p.opts) ? p.opts.filter((o: unknown) => typeof o === "string" && o.trim()).map((o: string) => o.trim().slice(0, LIMITS.optionChars)) : [];
      if (!ID.test(String(p.id)) || t.polls.has(p.id) || t.polls.size >= LIMITS.polls || typeof p.q !== "string" || !p.q.trim()) return false;
      if (opts.length < 2 || opts.length > LIMITS.pollOptions) return false;
      t.polls.set(p.id, { id: p.id, q: p.q.trim().slice(0, LIMITS.pollQuestion), opts, author: e.author, ended: false, votes: new Map() });
      return true;
    }
    case "poll_vote": {
      const poll = t.polls.get(String(p.id));
      if (poll && !poll.ended && Number.isInteger(p.opt) && p.opt >= 0 && p.opt < poll.opts.length) poll.votes.set(e.author, p.opt); // one vote each: the latest counts
      return false;
    }
    case "poll_end": {
      const poll = t.polls.get(String(p.id));
      if (poll && (poll.author === e.author || isHost)) poll.ended = true;
      return false;
    }
    case "draw": {
      const pts = p.pts;
      const good =
        Number.isInteger(p.c) && p.c >= 0 && p.c < PALETTE.length && Number.isInteger(p.w) && p.w >= 1 && p.w <= 24 &&
        Array.isArray(pts) && pts.length >= 2 && pts.length <= LIMITS.strokePoints * 2 && pts.length % 2 === 0 &&
        pts.every((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 1000);
      if (good && t.strokes.length < LIMITS.strokes) t.strokes.push({ id: e.id, author: e.author, c: p.c, w: p.w, pts });
      return false;
    }
    case "draw_clear":
      t.strokes = [];
      return false;
  }
  return false;
}

/** Poll results: votes per option, and the total. */
export function tally(poll: Poll): { counts: number[]; total: number } {
  const counts = poll.opts.map(() => 0);
  for (const o of poll.votes.values()) counts[o]++;
  return { counts, total: poll.votes.size };
}

/** A page is untrusted code from another member: it runs in a frame with no scripts, no network and no way out. */
export function pageDocument(html: string) {
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank">${html}`;
}


/** A note's paragraphs, in order. */
export const noteBlocks = (d: Doc): Block[] => [...d.blocks.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : 1));
/** A note as plain text (for search). */
export const noteText = (d: Doc): string => noteBlocks(d).map((b) => b.text).join("\n");

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/**
 * An ordering key strictly between `a` and `b` (empty means no limit on that side): the trick behind inserting a paragraph between two
 * others without renumbering anything, so two people inserting at once never clash. Keys are short base-62 strings compared as text.
 */
export function between(a = "", b = ""): string {
  let out = "";
  for (let i = 0; ; i++) {
    const lo = i < a.length ? DIGITS.indexOf(a[i]) : 0;
    const hi = b && i < b.length ? DIGITS.indexOf(b[i]) : DIGITS.length;
    if (lo === hi) {
      out += DIGITS[lo];
      continue;
    }
    if (hi - lo > 1) return out + DIGITS[(lo + hi) >> 1];
    out += DIGITS[lo]; // no room at this digit: keep it, and stop being limited by `b`
    b = "";
  }
}
