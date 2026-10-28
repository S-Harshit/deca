// Live text for notes and "anyone can edit" pages. Every character is an element with its own identity (a Yjs sequence CRDT), so two
// people typing in the same word at the same moment both keep their edits and every browser ends with identical text, in whatever
// order the updates arrive. Updates travel over the direct links as small unsigned control messages (like `music`): they are
// validated on receipt (sender must be allowed to speak, size and length are capped) and are never trusted for who wrote what.
// The text lives only in memory and ends with the room. Loaded lazily (dynamic import in space.ts) so rooms without notes never pay for it.
import * as Y from "yjs";

const MAX_UPDATE = 220_000; // characters of base64 in one message
const SLACK = 2_000; // two people can each fill the last of the room at once; a merge may overshoot by a little, never by a lot
const MAX_STATE = 420_000; // bytes of one document's whole encoded state, history included
const LOCAL = Symbol("local");
const REMOTE = Symbol("remote");

const toB64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export type CollabIO = {
  sendTo(peer: string, msg: unknown): void;
  broadcast(msg: unknown): void;
  /** Pass a new update along to peers the sender cannot reach themselves. */
  relay(msg: unknown, from: string): void;
  /** May this direct peer change text in this room (a member, and chat is not muted for them)? */
  can(peer: string): boolean;
  /** Longest text this document may hold; 0 when it is not a shared document. */
  cap(doc: string): number;
  changed(): void;
};

export type TextChange = (delta: { retain?: number; insert?: string | object; delete?: number }[], local: boolean) => void;

export class Collab {
  private docs = new Map<string, Y.Doc>();
  private watchers = new Map<string, Set<TextChange>>();
  private recent = new Map<string, Map<string, number>>(); // doc -> peer -> when they last changed it
  private io: CollabIO;
  constructor(io: CollabIO) {
    this.io = io;
  }

  text(id: string) {
    return this.docs.get(id)?.getText("t").toString() ?? "";
  }

  /** Follow the text of one document. Returns the way to stop. */
  watch(id: string, fn: TextChange) {
    const set = this.watchers.get(id) ?? new Set();
    set.add(fn);
    this.watchers.set(id, set);
    return () => set.delete(fn);
  }

  /** Who changed this document in the last few seconds (direct peers only). */
  typing(id: string, within = 4000) {
    const now = Date.now();
    return [...(this.recent.get(id) ?? [])].filter(([, at]) => now - at < within).map(([peer]) => peer);
  }

  /** Match the set of documents to what the room's log says exists, and ask everyone connected for the text of new ones. */
  ensure(ids: string[]) {
    const want = new Set(ids);
    for (const [id, d] of this.docs)
      if (!want.has(id)) {
        d.destroy();
        this.docs.delete(id);
        this.watchers.delete(id);
        this.recent.delete(id);
      }
    for (const id of want)
      if (!this.docs.has(id)) {
        this.make(id);
        this.io.broadcast({ t: "ysv", d: id, sv: toB64(Y.encodeStateVector(this.docs.get(id)!)) });
      }
  }

  /** A peer just connected: tell them what we hold, and they send back whatever we lack. */
  hello(peer: string) {
    for (const [id, d] of this.docs) this.io.sendTo(peer, { t: "ysv", d: id, sv: toB64(Y.encodeStateVector(d)) });
  }

  /** Replace the text with `next` as the smallest edit (a common start and end are kept), so a concurrent change elsewhere survives. */
  set(id: string, next: string, limit?: number) {
    const d = this.docs.get(id);
    const cap = limit ?? this.io.cap(id);
    if (!d) return false;
    const t = d.getText("t");
    const cur = t.toString();
    if (cur === next) return true;
    if (next.length > cap && next.length > cur.length) return false; // typing more is refused; deleting is always allowed
    let a = 0;
    while (a < cur.length && a < next.length && cur[a] === next[a]) a++;
    let b = 0;
    while (b < cur.length - a && b < next.length - a && cur[cur.length - 1 - b] === next[next.length - 1 - b]) b++;
    d.transact(() => {
      if (cur.length - a - b > 0) t.delete(a, cur.length - a - b);
      if (next.length - a - b > 0) t.insert(a, next.slice(a, next.length - b));
    }, LOCAL);
    return true;
  }

  onMsg(from: string, msg: { t?: string; d?: unknown; sv?: unknown; u?: unknown }) {
    const id = typeof msg?.d === "string" ? msg.d : "";
    const d = this.docs.get(id);
    if (!d || !this.io.can(from)) return;
    try {
      if (msg.t === "ysv" && typeof msg.sv === "string" && msg.sv.length < 4000) {
        this.io.sendTo(from, { t: "yup", d: id, u: toB64(Y.encodeStateAsUpdate(d, fromB64(msg.sv))) });
      } else if (msg.t === "yup" && typeof msg.u === "string" && msg.u.length <= MAX_UPDATE) {
        const u = fromB64(msg.u);
        // Try it on a copy first: an update that would grow the document past its limits is dropped whole.
        const probe = new Y.Doc();
        Y.applyUpdate(probe, Y.encodeStateAsUpdate(d));
        Y.applyUpdate(probe, u);
        const ok = probe.getText("t").length <= this.io.cap(id) + SLACK && Y.encodeStateAsUpdate(probe).length <= MAX_STATE;
        probe.destroy();
        if (!ok) return;
        let touched = false;
        const mark = () => (touched = true);
        d.on("update", mark);
        Y.applyUpdate(d, u, REMOTE);
        d.off("update", mark);
        if (!touched) return; // nothing new: stop here, so a relayed update cannot circle the room
        const who = this.recent.get(id) ?? new Map();
        who.set(from, Date.now());
        this.recent.set(id, who);
        this.io.relay(msg, from);
        this.io.changed();
      }
    } catch {
      /* malformed update from a peer: ignore it */
    }
  }

  private make(id: string) {
    const d = new Y.Doc();
    this.docs.set(id, d);
    d.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin === LOCAL) this.io.broadcast({ t: "yup", d: id, u: toB64(u) });
    });
    d.getText("t").observe((ev) => {
      const local = ev.transaction.origin === LOCAL;
      for (const fn of this.watchers.get(id) ?? []) fn(ev.delta as never, local);
    });
  }
}
