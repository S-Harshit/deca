// The same Ed25519 signatures and SHA-256 hashes the browser's WebCrypto makes, done in plain JavaScript (noble, MIT, audited).
// Loaded only where WebCrypto is missing: a page opened on a plain http address (a phone opening http://192.168.x.x:8080 on the home
// Wi-Fi) has no WebCrypto, and an older browser may lack Ed25519. The keys and signatures are byte-for-byte the same format, so a phone
// using this and a laptop using WebCrypto verify each other's events.
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";

export { sha256 };
export const keygen = () => ed25519.keygen();
export const sign = (message: Uint8Array, secretKey: Uint8Array) => ed25519.sign(message, secretKey);
export const verify = (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) => ed25519.verify(signature, message, publicKey, { zip215: false });
