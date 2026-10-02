import { idFromPub, unb64, type Identity } from "./identity";
import type { SpaceEvent } from "./log";

const enc = new TextEncoder();

/** Stable JSON (sorted keys, no undefined) so signer and verifier hash exactly the same bytes. */
export function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
}

const signedText = (e: Pick<SpaceEvent, "id" | "author" | "ts" | "type" | "payload">) => canon([e.id, e.author, e.ts, e.type, e.payload]);

export async function signEvent(e: Omit<SpaceEvent, "pub" | "sig">, id: Identity): Promise<SpaceEvent> {
  return { ...e, pub: id.pub, sig: await id.sign(signedText(e)) };
}

/** Check a signature over arbitrary text. Returns the signer's id (derived from the key) if it is valid, otherwise null. */
export async function verifyText(pub: unknown, sig: unknown, text: string): Promise<string | null> {
  if (typeof pub !== "string" || typeof sig !== "string" || pub.length > 64 || sig.length > 100) return null;
  try {
    let key = keys.get(pub);
    if (!key) {
      key = await crypto.subtle.importKey("raw", unb64(pub) as BufferSource, { name: "Ed25519" } as never, false, ["verify"]);
      keys.set(pub, key);
    }
    if (!(await crypto.subtle.verify({ name: "Ed25519" } as never, key, unb64(sig) as BufferSource, enc.encode(text)))) return null;
    let id = authors.get(pub);
    if (!id) authors.set(pub, (id = await idFromPub(pub)));
    return id;
  } catch {
    return null;
  }
}

const keys = new Map<string, CryptoKey>();
const authors = new Map<string, string>();

/** True only if `author` really is the owner of the attached key AND the key signed exactly this event. */
export async function verifyEvent(e: SpaceEvent): Promise<boolean> {
  if (typeof e.pub !== "string" || typeof e.sig !== "string" || e.pub.length > 64 || e.sig.length > 100) return false;
  try {
    let author = authors.get(e.pub);
    if (!author) authors.set(e.pub, (author = await idFromPub(e.pub)));
    if (author !== e.author) return false; // claiming to be someone else
    let key = keys.get(e.pub);
    if (!key) {
      key = await crypto.subtle.importKey("raw", unb64(e.pub) as BufferSource, { name: "Ed25519" } as never, false, ["verify"]);
      keys.set(e.pub, key);
    }
    return await crypto.subtle.verify({ name: "Ed25519" } as never, key, unb64(e.sig) as BufferSource, enc.encode(signedText(e)));
  } catch {
    return false;
  }
}
