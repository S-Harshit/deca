// Fixed people for tests that need to know someone's id before the page loads (for example to cut the link between two of them).
// An id is the first 16 hex characters of the SHA-256 of the public key, so a test cannot just invent one: it makes a key pair
// here and puts it in the page's sessionStorage ("deca.identity") before the app starts, which is where the app keeps its own.
const crypto = require("node:crypto");

function make() {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  const raw = Buffer.from(jwk.x, "base64url");
  const id = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  const stored = JSON.stringify({ jwk, pub: raw.toString("base64"), secret: crypto.randomBytes(16).toString("hex") });
  return { id, stored };
}

const cache = new Map();
/** The same person every time within one test run. */
module.exports = { person: (name) => (cache.has(name) ? cache.get(name) : (cache.set(name, make()), cache.get(name))) };
