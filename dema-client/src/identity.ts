// Self-certifying identity. Your id IS the first 16 hex chars of the SHA-256 of your public key, and
// every event you write is signed with the matching private key. So nobody can write an event "as"
// you (or as the host) without your private key: a forged author fails verification everywhere.
// Needs WebCrypto Ed25519 (Chrome 113+, Safari 17+, Firefox 129+) on https or localhost.

const enc = new TextEncoder();
export const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

export async function idFromPub(pubB64: string) {
  return hex(await crypto.subtle.digest("SHA-256", unb64(pubB64) as BufferSource)).slice(0, 16);
}

export type Identity = {
  peerId: string;
  /** Public key (base64), attached to every event so anyone can verify it. */
  pub: string;
  /** A separate secret the signaling server uses so nobody can take over this id's connection. Never shared with peers. */
  secret: string;
  sign: (text: string) => Promise<string>;
};

const KEY = "deca.identity";

type Saved = { jwk: JsonWebKey; pub: string; secret: string };

async function fromSaved(saved: Saved): Promise<Identity> {
  const priv = await crypto.subtle.importKey("jwk", saved.jwk, { name: "Ed25519" } as never, false, ["sign"]);
  return {
    peerId: await idFromPub(saved.pub),
    pub: saved.pub,
    secret: saved.secret,
    sign: async (text) => b64(await crypto.subtle.sign({ name: "Ed25519" } as never, priv, enc.encode(text))),
  };
}

/** Per-tab identity: created on first visit, kept in sessionStorage (so a refresh is still you). */
export async function loadIdentity(): Promise<Identity> {
  if (!globalThis.crypto?.subtle) throw new Error("no-webcrypto");
  let saved: Saved | null = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
  } catch {
    saved = null;
  }
  if (!saved?.jwk || !saved.pub || !saved.secret) {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" } as never, true, ["sign", "verify"])) as CryptoKeyPair;
    saved = {
      jwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
      pub: b64(await crypto.subtle.exportKey("raw", pair.publicKey)),
      secret: hex(crypto.getRandomValues(new Uint8Array(16))),
    };
    try {
      sessionStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      // not persisted: a refresh would become a new person, which is acceptable
    }
  }
  return fromSaved(saved);
}

// ---- coming back to the same room as the same person -------------------------------------------------------------------------
// The identity above belongs to a tab, so closing the tab and opening the link again made a new person (a second "Ann", the old
// one shown offline). A device now also remembers, per room, who it was there: opening the same room again on the same browser
// picks that identity up, so the member returns instead of duplicating and a changed name simply renames them (the log keeps the
// latest name, so earlier messages show it too). It is per room (no identity follows you between rooms), forgotten after a week,
// and only for the last few rooms. Two tabs open on the same room at once are two people: a lock decides which tab may take it.
const ROOMS_KEY = "deca.rooms";
const TAB_ROOM = "deca.identity.room";
const MAX_ROOMS = 20;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const held = new Set<string>();

/**
 * True when this tab now holds the claim on this room's remembered identity (always true where Web Locks do not exist). A tab that was
 * just closed can take a moment to let go of its claim, so a taken claim is asked for again for a second and a half before it is
 * believed: that way closing a tab and opening the link again straight away is still the same person, while a tab that is really open
 * costs the newcomer only that short wait.
 */
async function claim(roomId: string): Promise<boolean> {
  if (held.has(roomId) || !navigator.locks) return true;
  for (let tries = 0; tries < 7; tries++) {
    const got = await new Promise<boolean>((resolve) => {
      void navigator.locks.request(`deca-identity:${roomId}`, { ifAvailable: true }, (lock) => {
        if (!lock) return void resolve(false);
        held.add(roomId);
        resolve(true);
        return new Promise<void>(() => undefined); // held until this tab closes
      });
    });
    if (got) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

type Remembered = Record<string, { at: number; id: Saved }>;
const readRooms = (): Remembered => {
  try {
    const all = JSON.parse(localStorage.getItem(ROOMS_KEY) ?? "{}") as Remembered;
    const now = Date.now();
    return Object.fromEntries(Object.entries(all).filter(([, v]) => v && now - v.at < MAX_AGE_MS && v.id?.jwk && v.id.pub && v.id.secret));
  } catch {
    return {};
  }
};
const writeRooms = (rooms: Remembered) => {
  try {
    const newest = Object.entries(rooms).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ROOMS);
    localStorage.setItem(ROOMS_KEY, JSON.stringify(Object.fromEntries(newest)));
  } catch {
    // storage is full or blocked: the room works, it just will not recognise this device next time
  }
};

/** The identity to use in this room: the one this device used here before if there is one, otherwise this tab's own (remembered for next time). */
export async function identityForRoom(roomId: string, current: Identity): Promise<Identity> {
  try {
    if (sessionStorage.getItem(TAB_ROOM) === roomId) {
      void claim(roomId); // a refresh: still this tab's room, and keep others off it
      return current;
    }
    const rooms = readRooms();
    const mine = await claim(roomId);
    const known = rooms[roomId];
    if (mine && known) {
      sessionStorage.setItem(KEY, JSON.stringify(known.id));
      sessionStorage.setItem(TAB_ROOM, roomId);
      known.at = Date.now();
      writeRooms(rooms);
      return await fromSaved(known.id);
    }
    sessionStorage.setItem(TAB_ROOM, roomId);
    if (mine) {
      const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Saved | null;
      if (saved) writeRooms({ ...rooms, [roomId]: { at: Date.now(), id: saved } });
    }
  } catch {
    // no storage here: behave as before, one identity per tab
  }
  return current;
}
