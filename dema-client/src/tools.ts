// What a room can hold besides chat: pages and notes, polls, and a drawing board. Each is made of small signed
// events; this file folds them into state (derive() in log.ts calls applyTool) and holds every limit, so a hostile member cannot make
// the room heavy. Nothing here is stored anywhere: it lives and ends with the room's log.
import type { SpaceEvent } from "./log";

export const TOOL_TYPES = ["doc_set", "doc_del", "poll_new", "poll_vote", "poll_end", "draw", "draw_clear"] as const;
const SET = new Set<string>(TOOL_TYPES);
export const isToolType = (t: string) => SET.has(t);

export const LIMITS = {
  docs: 40,
  pageChars: 40_000,
  noteChars: 20_000,
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

/** A note's text, and an open page's, is shared live (collab.ts) and is not in the log; a closed page's HTML is `body`. */
export type Doc = { id: string; kind: "page" | "note"; title: string; body: string; /** a page anyone may edit */ open: boolean; owner: string; editor: string; ts: number; rev: number };
export type Poll = { id: string; q: string; opts: string[]; author: string; ended: boolean; votes: Map<string, number> };
export type Stroke = { id: string; author: string; c: number; w: number; pts: number[] };
export type RoomTools = { docs: Map<string, Doc>; polls: Map<string, Poll>; strokes: Stroke[] };

export const emptyTools = (): RoomTools => ({ docs: new Map(), polls: new Map(), strokes: [] });

const ID = /^[a-f0-9]{12}$/;

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
      // A note's text is shared live; a page carries its HTML here only while it is closed (author-only).
      const open = p.kind === "page" && p.open === true;
      const body = p.kind === "page" && !open && typeof p.body === "string" ? p.body : "";
      if (body.length > LIMITS.pageChars || typeof p.title !== "string") return false;
      const title = p.title.slice(0, LIMITS.titleChars) || "Untitled";
      const had = t.docs.get(p.id);
      if (!had) {
        if (t.docs.size >= LIMITS.docs) return false;
        t.docs.set(p.id, { id: p.id, kind: p.kind, title, body, open, owner: e.author, editor: e.author, ts: e.ts, rev: 1 });
        return true;
      }
      // A closed page can only be changed by its author (or the host); an open page's title and a note by anyone in the room.
      // Only the author (or host) can open or close a page. The kind never changes.
      const owner = had.owner === e.author || isHost;
      if (had.kind !== p.kind || (had.kind === "page" && !owner && !had.open)) return false;
      Object.assign(had, { title, editor: e.author, ts: e.ts, rev: had.rev + 1 }, had.kind === "page" && owner ? { body, open } : {});
      return false;
    }
    case "doc_del": {
      const d = t.docs.get(String(p.id));
      if (d && (d.owner === e.author || isHost)) t.docs.delete(d.id);
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
