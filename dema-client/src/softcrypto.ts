// WebCrypto when the page has it (https, localhost), the plain-JS twin when it does not (softEd.ts, loaded on demand).
let need: Promise<boolean> | null = null;
/** True when signing must be done in plain JS: no WebCrypto at all, or one without Ed25519. Worked out once. */
export const needSoft = () =>
  (need ??= (async () => {
    if (!globalThis.crypto?.subtle) return true;
    try {
      await crypto.subtle.generateKey({ name: "Ed25519" } as never, false, ["sign", "verify"]);
      return false;
    } catch {
      return true;
    }
  })());

let mod: Promise<typeof import("./softEd")> | null = null;
export const soft = () => (mod ??= import("./softEd"));

const bytes = (d: BufferSource) => (d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength));

/** SHA-256 of some bytes, with or without WebCrypto. */
export async function sha256(data: BufferSource): Promise<Uint8Array> {
  if (globalThis.crypto?.subtle) return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return (await soft()).sha256(bytes(data));
}
