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

/** Per-tab identity: created on first visit, kept in sessionStorage (so a refresh is still you). */
export async function loadIdentity(): Promise<Identity> {
  if (!globalThis.crypto?.subtle) throw new Error("no-webcrypto");
  let saved: { jwk: JsonWebKey; pub: string; secret: string } | null = null;
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
  const priv = await crypto.subtle.importKey("jwk", saved.jwk, { name: "Ed25519" } as never, false, ["sign"]);
  return {
    peerId: await idFromPub(saved.pub),
    pub: saved.pub,
    secret: saved.secret,
    sign: async (text) => b64(await crypto.subtle.sign({ name: "Ed25519" } as never, priv, enc.encode(text))),
  };
}
