/* eslint-disable @typescript-eslint/no-explicit-any -- wire messages are dynamic and validated at ingest */
/**
 * "Connect by code": a room with no signaling server at all.
 *
 * `Mesh` is written against a signaling server: it asks to join, is told who is in the room, and hands
 * connection messages (offers, answers, ICE candidates) to the server to relay. This is a small stand-in for that server
 * that lives in the browser, so `Mesh` runs unchanged. It does the same three jobs:
 *
 *  - who is here: the people it has heard of (from an invite link, a code, or an introduction by someone already connected);
 *  - relaying connection messages: over an existing link when there is one (directly, or through a mutual contact);
 *  - and only when no link can carry a message, packing it into a **code** that a person copies and sends by any means.
 *
 * The first link between two people is the only one that needs a code each way. After that, introductions to everyone
 * else travel over the links that already exist. Trust: a code is only as private as the way it is sent, and a person who
 * can see one could answer it first, so share it with the person it is for.
 */

import { countAddresses, stopStream, type Addresses } from "./localNetwork";
import { checkWords } from "./sas";
import { canon, verifyText } from "./signing";

/** What the Mesh needs from us to know about links. */
export interface MeshLink {
  isOpen(id: string): boolean;
  openIds(): string[];
  sendTo(id: string, msg: unknown): boolean;
  meet(id: string, name: string, dialNow: boolean): void;
}

/** `ask`: we are starting the connection (step 1); `reply`: we are answering one (step 2). */
export type Code = { peerId: string; name: string; text: string; at: number; kind: "ask" | "reply" };

const PREFIX = "deca1.";
const HEX16 = /^[0-9a-f]{16}$/;
const MAX_PEOPLE = 8;
const MAX_CODE_CHARS = 60_000;
const MAX_INFLATED = 300_000;
/**
 * A code is sealed as soon as the browser says it has finished looking for addresses. These are the fallbacks if it never says so:
 * quiet for this long, or this long in total.
 */
const SEAL_QUIET_MS = 2500;
const SEAL_MAX_MS = 7000;
/** A link that stays down this long without coming back means the person has left. */
const GONE_AFTER_MS = 15_000;

const b64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inflate with a ceiling, so a tiny hostile code cannot expand into something huge. */
async function inflate(bytes: Uint8Array): Promise<string> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_INFLATED) {
      void reader.cancel();
      throw new Error("too big");
    }
    parts.push(value);
  }
  return new TextDecoder().decode(await new Blob(parts as BlobPart[]).arrayBuffer());
}

type Bundle = { to: string; gen: number; items: unknown[]; started: number; sealed: boolean; timer?: ReturnType<typeof setTimeout> };

export class LocalSignaling {
  // --- the part of WebSocket that Mesh uses ---
  readyState = 0;
  onopen: ((e?: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e?: unknown) => void) | null = null;

  /** Codes waiting to be handed to someone: "send this to Ann". */
  codes: Code[] = [];

  private mesh: MeshLink | null = null;
  private readonly roster = new Map<string, string>();
  /** Who told us about someone: the neighbour to route their connection messages through. */
  private readonly via = new Map<string, string>();
  private readonly out = new Map<string, Bundle>();
  private readonly gone = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly subs = new Set<() => void>();
  /** People whose link has worked at least once: only they can be said to have left. A link that never came up is just a failed attempt. */
  private readonly opened = new Set<string>();
  /** The microphone permission held only so the browser shows its real local address (see localNetwork.ts); released once a link is up. */
  private mic: MediaStream | null = null;
  private micTimer?: ReturnType<typeof setTimeout>;
  /** What kinds of address each side's latest code carried, for the help text. */
  private readonly seen = new Map<string, { mine?: Addresses; theirs?: Addresses }>();
  private joined = false;
  private closed = false;

  /** Someone who pasted a code and is waiting to be let in. Nobody unknown gets a reply code, or any history, without this. */
  private readonly requests = new Map<string, { name: string; code: any }>();
  /** Each side's connection fingerprint for the latest exchange with a person: what the check words are made from. */
  private readonly fps = new Map<string, { mine?: string; theirs?: string }>();
  private readonly words = new Map<string, string>();
  private readonly confirmed = new Set<string>();
  /** Connection messages are signed and checked one at a time, in the order they came, so a candidate never overtakes its offer. */
  private outChain: Promise<void> = Promise.resolve();
  private inChain: Promise<void> = Promise.resolve();

  readonly me: { id: string; name: string };
  readonly hostId: string;
  readonly room: string;
  private readonly signer: { pub: string; sign: (text: string) => Promise<string> };

  constructor(me: { id: string; name: string }, signer: { pub: string; sign: (text: string) => Promise<string> }, hostId: string, room: string, seed: { id: string; name: string } | null) {
    this.signer = signer;
    this.me = me;
    this.hostId = hostId;
    this.room = room;
    if (seed && seed.id !== me.id) this.roster.set(seed.id, seed.name);
  }

  /** Hold the (silent) microphone permission until a link is up, or three minutes. */
  hold(stream: MediaStream | null) {
    this.mic = stream;
    if (stream) this.micTimer = setTimeout(() => this.release(), 180_000);
  }

  private release() {
    clearTimeout(this.micTimer);
    stopStream(this.mic);
    this.mic = null;
  }

  /** For each person we are exchanging codes with: what each side's code offered. */
  diagnose() {
    return [...this.seen].map(([id, v]) => ({ peerId: id, name: this.roster.get(id) ?? id, ...v }));
  }

  bind(mesh: MeshLink) {
    this.mesh = mesh;
  }

  onChange(fn: () => void) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  private changed() {
    for (const f of this.subs) f();
  }

  /** A link someone can send to a friend so they can join through us. */
  inviteLink(base: string) {
    return `${base}#/m/${this.room}/${this.me.id}/${this.hostId}/${encodeURIComponent(this.me.name)}`;
  }

  // ---------------------------------------------------------------- socket surface (Mesh -> us)

  /** Called by Mesh in place of `new WebSocket(...)`. */
  socket() {
    queueMicrotask(() => {
      if (this.closed) return;
      this.readyState = 1;
      this.onopen?.();
    });
    return this;
  }

  send(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case "join":
        this.emit({
          type: "joined",
          hostId: this.hostId,
          peers: [...this.roster].map(([peerId, name]) => ({ peerId, name })),
          max: MAX_PEOPLE,
          locked: false,
          resumed: this.joined,
        });
        this.joined = true;
        break;
      case "signal":
        this.route(String(msg.to), msg.payload, Number(msg.gen));
        break;
      case "ping":
        this.emit({ type: "pong" });
        break;
      case "leave":
        for (const id of this.mesh?.openIds() ?? []) this.mesh?.sendTo(id, { t: "bye" });
        break;
      // "lock" has no meaning without a server: nobody can join without a code from someone already inside
    }
  }

  close() {
    this.release();
    this.closed = true;
    this.readyState = 3;
    for (const b of this.out.values()) clearTimeout(b.timer);
    for (const t of this.gone.values()) clearTimeout(t);
    this.out.clear();
    this.gone.clear();
  }

  private emit(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  // ---------------------------------------------------------------- routing connection messages

  private route(to: string, payload: unknown, gen: number) {
    const mesh = this.mesh;
    if (!mesh) return;
    const v = this.via.get(to);
    const hop = mesh.isOpen(to) ? to : v && mesh.isOpen(v) ? v : null; // directly, or through the person who introduced us
    if (!hop) return this.queue(to, payload, gen); // nobody can carry it: a person will
    // Signed, so a relay can neither change it nor say it came from someone else.
    const body = { from: this.me.id, fn: this.me.name, to, g: gen, p: payload };
    this.outChain = this.outChain
      .then(async () => {
        const sg = await this.signer.sign(canon(body));
        mesh.sendTo(hop, { t: "sig", ...body, pub: this.signer.pub, sg });
      })
      .catch(() => undefined);
  }

  nameOf(id: string) {
    return this.roster.get(id) ?? id;
  }

  /** Can connection messages for this person travel without a human? */
  canReach(id: string) {
    const v = this.via.get(id);
    return !!this.mesh?.isOpen(id) || (!!v && !!this.mesh?.isOpen(v));
  }

  private queue(to: string, payload: unknown, gen: number) {
    let b = this.out.get(to);
    if (b && b.gen === gen && b.sealed) return; // the code is already made and may be in someone's clipboard: do not change it under them
    if (!b || b.gen !== gen) {
      if (b) clearTimeout(b.timer);
      b = { to, gen, items: [], started: Date.now(), sealed: false }; // a newer attempt replaces the older one: its code is no use any more
      this.out.set(to, b);
      this.changed(); // "preparing your code"
    }
    b.items.push(payload);
    clearTimeout(b.timer);
    const bundle = b;
    b.timer = setTimeout(() => void this.seal(bundle), Math.max(0, Math.min(SEAL_QUIET_MS, SEAL_MAX_MS - (Date.now() - b.started))));
  }

  /** The browser has finished looking for addresses for this connection. */
  gatheringDone(id: string, gen: number) {
    const b = this.out.get(id);
    if (b && b.gen === gen && !b.sealed) {
      clearTimeout(b.timer);
      void this.seal(b);
    }
  }

  /** Is a code for this person out there waiting to be carried? Then we are waiting for a human, not for the network. */
  holdsCode(id: string) {
    return this.codes.some((c) => c.peerId === id) || [...this.out.values()].some((b) => b.to === id && !b.sealed);
  }

  /** Who we are still making a code for. */
  preparing(): string[] {
    return [...this.out.values()].filter((b) => !b.sealed).map((b) => b.to);
  }

  private async seal(b: Bundle) {
    if (this.closed || this.out.get(b.to) !== b || b.sealed) return;
    b.sealed = true;
    const body = { v: 2, f: { id: this.me.id, name: this.me.name }, to: b.to, host: this.hostId, room: this.room, g: b.gen, m: b.items };
    // Signed with our identity key: nobody can make a code that claims to be from us, or change one of ours.
    const sig = await this.signer.sign(canon(body));
    const text = PREFIX + b64(await deflate(JSON.stringify({ ...body, pub: this.signer.pub, sig })));
    this.noteFingerprint(b.to, "mine", b.items);
    if (this.closed || this.out.get(b.to) !== b) return;
    this.seen.set(b.to, { ...this.seen.get(b.to), mine: countAddresses(b.items) });
    this.codes = [...this.codes.filter((c) => c.peerId !== b.to), { peerId: b.to, name: this.roster.get(b.to) ?? b.to, text, at: Date.now(), kind: JSON.stringify(b.items[0]).includes('"offer"') ? "ask" : "reply" }];
    this.changed();
  }

  // ---------------------------------------------------------------- messages from neighbours (Mesh -> us)

  /** True if the message was ours. Called for every control message that arrives on a link. */
  handleControl(from: string, msg: any): boolean {
    const mesh = this.mesh;
    if (!mesh || !msg || typeof msg !== "object") return false;
    switch (msg.t) {
      case "sig": {
        if (typeof msg.to !== "string" || typeof msg.from !== "string" || !HEX16.test(msg.from) || !msg.p || typeof msg.p !== "object") return true;
        if (msg.to !== this.me.id) {
          // not for us: pass it on once, to someone we are directly connected to
          if (!msg.hops && mesh.isOpen(msg.to)) mesh.sendTo(msg.to, { ...msg, hops: 1 });
          return true;
        }
        if (msg.from === this.me.id) return true;
        const body = { from: msg.from, fn: msg.fn, to: msg.to, g: msg.g, p: msg.p };
        this.inChain = this.inChain
          .then(async () => {
            if ((await verifyText(msg.pub, msg.sg, canon(body))) !== msg.from) return; // altered, or not from who it says: dropped
            this.learn(msg.from, String(msg.fn ?? msg.from).slice(0, 32), from, false);
            this.emit({ type: "signal", from: msg.from, payload: msg.p, gen: msg.g });
          })
          .catch(() => undefined);
        return true;
      }
      case "roster":
        // we have just connected to someone who knows the room: meet everyone else in it (we dial them, as a newcomer does)
        if (Array.isArray(msg.peers)) for (const p of msg.peers.slice(0, MAX_PEOPLE)) if (p && HEX16.test(p.id) && p.id !== this.me.id) this.learn(p.id, String(p.name ?? p.id).slice(0, 32), from, true);
        return true;
      case "hello":
        // someone new has connected to our neighbour: they will dial us
        if (HEX16.test(msg.id) && msg.id !== this.me.id) this.learn(msg.id, String(msg.name ?? msg.id).slice(0, 32), from, false);
        return true;
      case "bye":
        this.forget(from);
        this.emit({ type: "peer-left", peerId: from });
        return true;
      default:
        return false;
    }
  }

  /** We have heard of someone: remember them, and (if we are the one to dial) start connecting. */
  private learn(id: string, name: string, via: string, dial: boolean) {
    const known = this.roster.has(id);
    if (!known && this.roster.size >= MAX_PEOPLE - 1) return;
    this.roster.set(id, name);
    if (via !== id) this.via.set(id, via);
    if (!known || dial) this.mesh?.meet(id, name, dial);
  }

  private forget(id: string) {
    this.opened.delete(id);
    this.roster.delete(id);
    this.via.delete(id);
    this.codes = this.codes.filter((c) => c.peerId !== id);
    clearTimeout(this.gone.get(id));
    this.gone.delete(id);
    this.changed();
  }

  // ---------------------------------------------------------------- called by Mesh about links

  peerOpened(id: string) {
    this.release(); // a link is up: the microphone permission has done its job
    this.opened.add(id);
    clearTimeout(this.gone.get(id));
    this.gone.delete(id);
    const out = this.out.get(id);
    if (out) clearTimeout(out.timer);
    this.out.delete(id);
    this.codes = this.codes.filter((c) => c.peerId !== id); // connected: the code has done its job
    const mesh = this.mesh;
    if (mesh) {
      const others = mesh.openIds().filter((x) => x !== id);
      // introduce the new link to everyone, and everyone to the new link
      mesh.sendTo(id, { t: "roster", peers: others.map((o) => ({ id: o, name: this.roster.get(o) ?? o })) });
      for (const o of others) mesh.sendTo(o, { t: "hello", id, name: this.roster.get(id) ?? id });
    }
    this.changed();
  }

  peerLost(id: string) {
    if (this.closed || this.gone.has(id) || !this.roster.has(id) || !this.opened.has(id)) return;
    this.gone.set(
      id,
      setTimeout(() => {
        this.gone.delete(id);
        if (this.closed || this.mesh?.isOpen(id)) return;
        this.forget(id);
        this.emit({ type: "peer-left", peerId: id });
      }, GONE_AFTER_MS),
    );
  }

  // ---------------------------------------------------------------- a person pastes a code

  /** Returns an empty string on success, or a message saying what is wrong. */
  async paste(text: string): Promise<string> {
    const found = new RegExp(`${PREFIX.replace(".", "\\.")}([A-Za-z0-9_-]{20,})`).exec(text);
    if (!found || found[0].length > MAX_CODE_CHARS) return "That does not look like a Deca code. Copy the whole code and try again.";
    let c: any;
    try {
      c = JSON.parse(await inflate(unb64(found[1])));
    } catch {
      return "That code is damaged or cut short. Ask for it again.";
    }
    if (c?.v !== 2 || !c.f || !HEX16.test(c.f.id) || typeof c.f.name !== "string" || !Array.isArray(c.m) || c.m.length > 60 || !Number.isFinite(c.g)) return "That is not a code this version understands. Ask them to update and make a new one.";
    // Signed by the key behind the id it names: a code cannot be forged, only passed on or replaced by someone's own.
    const { pub, sig, ...body } = c;
    if ((await verifyText(pub, sig, canon(body))) !== c.f.id) return "That code is not signed by the person it says it is from. Do not use it.";
    if (c.to !== this.me.id) return "This code is for someone else. Ask them to make one for you.";
    if (c.room !== this.room) return "This code is from a different room.";
    if (c.host !== this.hostId) return "This code is from a room with a different host.";
    if (c.f.id === this.me.id) return "That is your own code. Send it to the other person.";
    if (c.m.some((x: unknown) => !x || typeof x !== "object")) return "That code is damaged.";
    const id: string = c.f.id;
    const name = c.f.name.slice(0, 32);
    if (!this.roster.has(id) && this.roster.size >= MAX_PEOPLE - 1) return "The room is full (8 people).";
    const isOffer = c.m.some((x: any) => x.description?.type === "offer");
    if (!isOffer) {
      // A reply: only the person we asked may send one. Someone who has seen our code cannot answer it in their place.
      const asked = this.codes.filter((x) => x.kind === "ask").map((x) => x.peerId);
      if (!asked.includes(id)) {
        const who = asked.length ? this.nameOf(asked[0]) : "";
        return who ? `This reply is from ${name}, but you are waiting for ${who}. Ask ${who} to send it again.` : `You are not waiting for a reply from ${name}.`;
      }
    } else if (!this.opened.has(id)) {
      // A stranger asking to join: nothing happens until a person says yes. (Someone whose link already worked is trusted: same key.)
      this.requests.set(id, { name, code: c });
      this.changed();
      return "";
    }
    this.accept(id, name, c);
    return "";
  }

  /** The part of a code that is let through: remember the person, and hand their connection messages to Mesh. */
  private accept(id: string, name: string, c: any) {
    this.seen.set(id, { ...this.seen.get(id), theirs: countAddresses(c.m) });
    this.noteFingerprint(id, "theirs", c.m);
    this.learn(id, name, id, false);
    this.codes = this.codes.filter((x) => x.peerId !== id); // their reply arrived: the code we gave them is spent
    this.changed();
    for (const payload of c.m) this.emit({ type: "signal", from: id, payload, gen: c.g });
  }

  /** The person said yes to someone who pasted a code. */
  approve(id: string) {
    const r = this.requests.get(id);
    if (!r) return;
    this.requests.delete(id);
    this.accept(id, r.name, r.code);
  }

  refuse(id: string) {
    if (this.requests.delete(id)) this.changed();
  }

  waiting() {
    return [...this.requests].map(([peerId, r]) => ({ peerId, name: r.name }));
  }

  // ---------------------------------------------------------------- check words

  private noteFingerprint(id: string, side: "mine" | "theirs", items: unknown[]) {
    for (const it of items as { description?: { sdp?: unknown } }[]) {
      const m = typeof it?.description?.sdp === "string" ? /a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/.exec(it.description.sdp) : null;
      if (!m) continue;
      const f = { ...this.fps.get(id), [side]: m[1] };
      this.fps.set(id, f);
      if (f.mine && f.theirs) void checkWords([f.mine, f.theirs, this.me.id, id, this.room]).then((w) => {
        if (this.words.get(id) === w) return; // a renegotiation with the same fingerprints: already shown or confirmed
        this.words.set(id, w);
        this.confirmed.delete(id);
        this.changed();
      });
    }
  }

  /** People we are connected to straight from a code exchange, with the words to compare. */
  checkList() {
    return [...this.words].filter(([id]) => this.opened.has(id) && !this.confirmed.has(id)).map(([peerId, words]) => ({ peerId, name: this.nameOf(peerId), words }));
  }

  confirmWords(id: string) {
    this.confirmed.add(id);
    this.changed();
  }
}
