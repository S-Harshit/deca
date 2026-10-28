// "Share a file as a link", peer to peer. The sharer's browser stays connected in a tiny room of its own (id "d" + the link's token),
// and whoever opens the link joins it, asks for the file, and it streams straight from the sharer's browser to theirs and saves itself.
// Nothing is uploaded or stored anywhere, so the link works only while the sharer's tab stays open. The room is not the chat room: a guest
// never sees it, and the guest page can do nothing except ask for this one file.
import { rid } from "./log";
import { Mesh } from "./mesh";

export const DROP_MAX = 200 * 1024 * 1024; // held in memory while it travels, so a phone is not asked for more than this
const CHUNK = 16 * 1024;
export const dropRoom = (token: string) => `d${token}`;

export type Guest = { sent: number; state: "sending" | "done" | "failed" };
const NOOP = () => {};

export class DropHost {
  readonly token = rid();
  readonly file: File;
  guests = new Map<string, Guest>();
  finished = 0;
  private mesh: Mesh;
  private queue = new Map<string, Promise<void>>();
  private subs = new Set<() => void>();

  constructor(file: File) {
    this.file = file;
    this.mesh = new Mesh(dropRoom(this.token), rid(), "sharer", rid(), {
      onJoined: NOOP,
      onPeers: NOOP,
      onPeerOpen: NOOP,
      onPeerGone: (id) => {
        if (this.guests.get(id)?.state === "sending") this.guests.set(id, { sent: this.guests.get(id)!.sent, state: "failed" });
        this.changed();
      },
      onPeerLeft: NOOP,
      onSignalLost: NOOP,
      onReplaced: NOOP,
      onRefused: NOOP,
      onLockState: NOOP,
      onFull: NOOP,
      onControl: (from, msg) => {
        if (msg?.t === "drop-get") this.serve(from);
      },
      onFile: NOOP,
      onStream: NOOP,
    });
  }

  link() {
    return `${location.href.split("#")[0]}#/d/${this.token}`;
  }

  subscribe(fn: () => void) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  private changed() {
    this.subs.forEach((f) => f());
  }

  private serve(to: string) {
    // One transfer at a time per guest: chunks carry no id, order defines the file.
    const prev = this.queue.get(to) ?? Promise.resolve();
    this.queue.set(
      to,
      prev
        .then(async () => {
          this.guests.set(to, { sent: 0, state: "sending" });
          this.changed();
          this.mesh.sendTo(to, { t: "drop-meta", name: this.file.name, size: this.file.size, type: this.file.type });
          // the file channel opens a moment after the control one: wait for it rather than fail
          for (let tries = 0; ; tries++) {
            try {
              await this.mesh.sendFile(to, JSON.stringify({ t: "start" }));
              break;
            } catch (err) {
              if (tries > 40) throw err;
              await new Promise((r) => setTimeout(r, 150));
            }
          }
          let last = 0;
          for (let o = 0; o < this.file.size; o += CHUNK) {
            await this.mesh.sendFile(to, await this.file.slice(o, o + CHUNK).arrayBuffer());
            this.guests.set(to, { sent: Math.min(this.file.size, o + CHUNK), state: "sending" });
            if (o - last > this.file.size / 50) {
              last = o;
              this.changed();
            }
          }
          await this.mesh.sendFile(to, JSON.stringify({ t: "end" }));
          this.guests.set(to, { sent: this.file.size, state: "done" });
          this.finished++;
          this.changed();
        })
        .catch(() => {
          this.guests.set(to, { sent: this.guests.get(to)?.sent ?? 0, state: "failed" });
          this.changed();
        }),
    );
  }

  stop() {
    this.mesh.close();
    drops.delete(this.token);
    notifyDrops();
  }
}

// The shares of this tab, whichever room (or none) is open: they live until stopped or the tab closes.
const drops = new Map<string, DropHost>();
const dropSubs = new Set<() => void>();
const notifyDrops = () => dropSubs.forEach((f) => f());
let snapshot: DropHost[] = [];
export const startDrop = (file: File) => {
  const d = new DropHost(file);
  drops.set(d.token, d);
  d.subscribe(notifyDrops);
  notifyDrops();
  return d;
};
export const subscribeDrops = (f: () => void) => {
  dropSubs.add(f);
  return () => dropSubs.delete(f);
};
/** A new array only when the set changes, so React can compare it. */
export const getDrops = () => {
  const now = [...drops.values()];
  if (now.length !== snapshot.length || now.some((d, i) => d !== snapshot[i])) snapshot = now;
  return snapshot;
};

/** A name that is safe to save under: no folders, no control characters, not too long. */
export const safeName = (n: unknown) =>
  [...String(n ?? "file")]
    .filter((c) => c.charCodeAt(0) >= 32 && !'\\/:*?"<>|'.includes(c)) // no folders, no control characters
    .join("")
    .replace(/^\.+/, "")
    .slice(0, 120) || "file";

export type GuestState = { phase: "looking" | "receiving" | "done" | "gone" | "toobig" | "failed"; name: string; size: number; received: number; url: string | null };

/** The other end: join the share's room, ask for the file, collect it, and offer it for saving. */
export function receiveDrop(token: string, on: (s: GuestState) => void) {
  let state: GuestState = { phase: "looking", name: "", size: 0, received: 0, url: null };
  const set = (p: Partial<GuestState>) => on((state = { ...state, ...p }));
  let chunks: ArrayBuffer[] = [];
  let from = "";
  let host = ""; // only the room's first member (the sharer) is believed: another guest cannot hand over a file
  let going = false;
  const mesh = new Mesh(dropRoom(token), rid(), "guest", rid(), {
    onJoined: (hostId) => {
      host = hostId;
    },
    onPeers: NOOP,
    onPeerOpen: (id) => {
      if (id === host) mesh.sendTo(id, { t: "drop-get" });
    },
    onPeerGone: (id) => {
      if (id === from && state.phase === "receiving") set({ phase: "failed" });
    },
    onPeerLeft: NOOP,
    onSignalLost: NOOP,
    onReplaced: NOOP,
    onRefused: () => set({ phase: "gone" }),
    onLockState: NOOP,
    onFull: () => set({ phase: "gone" }),
    onControl: (id, msg) => {
      if (msg?.t !== "drop-meta" || going || id !== host) return;
      const size = Number(msg.size);
      if (!Number.isFinite(size) || size < 0) return;
      going = true;
      from = id;
      if (size > DROP_MAX) return set({ phase: "toobig", name: safeName(msg.name), size });
      set({ phase: "receiving", name: safeName(msg.name), size, received: 0 });
    },
    onFile: (id, data) => {
      if (id !== from || state.phase !== "receiving") return;
      if (typeof data === "string") {
        let m: { t?: string } = {};
        try {
          m = JSON.parse(data);
        } catch {
          return;
        }
        if (m.t === "end") {
          if (state.received !== state.size) return set({ phase: "failed" });
          // octet-stream: the file is saved, never shown by the browser, whatever it claims to be
          const url = URL.createObjectURL(new Blob(chunks, { type: "application/octet-stream" }));
          chunks = [];
          set({ phase: "done", url });
          save(url, state.name);
        }
        return;
      }
      chunks.push(data);
      const received = state.received + data.byteLength;
      if (received > state.size) return set({ phase: "failed" });
      set({ received });
    },
    onStream: NOOP,
  });
  // Nobody answered: the sender closed their tab (or the link is wrong).
  const giveUp = setTimeout(() => {
    if (state.phase === "looking") set({ phase: "gone" });
  }, 25000);
  return {
    save: () => state.url && save(state.url, state.name),
    close: () => {
      clearTimeout(giveUp);
      mesh.close();
      if (state.url) URL.revokeObjectURL(state.url);
    },
  };
}

function save(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
