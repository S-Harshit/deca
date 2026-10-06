import assert from "node:assert";
import { signEvent } from "../.build/signing.ts";
import { idFromPub, b64, type Identity } from "../.build/identity.ts";
import { derive, type SpaceEvent } from "../.build/log.ts";
import { buildExport } from "../.build/roomExport.ts";
import { readExport } from "../.build/roomImport.ts";
import { openArchive, sha256Hex } from "../.build/archive.ts";
import { makeZip } from "../.build/zip.ts";

async function mkId(): Promise<Identity> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" } as never, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = b64(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { peerId: await idFromPub(pub), pub, secret: "s".repeat(16), sign: async (t) => b64(await crypto.subtle.sign({ name: "Ed25519" } as never, kp.privateKey, new TextEncoder().encode(t))) };
}
const A = await mkId(), B = await mkId();
const mk = (a: Identity, id: string, ts: number, type: any, payload: any) => signEvent({ id, author: a.peerId, ts, type, payload }, a);
const events: SpaceEvent[] = [
  await mk(A, "e1", 1000, "joined", { name: "Ann" }),
  await mk(B, "e2", 1100, "joined", { name: "Bob" }),
  await mk(A, "e3", 1200, "chat", { text: "hello <b>world</b>" }),
  await mk(B, "e4", 1300, "chat", { text: "```js\nlet a=1\n```" }),
  await mk(A, "e5", 1400, "file_offer", { fileId: "f1", name: "note.txt", size: 5, type: "text/plain" }),
  await mk(A, "e6", 1450, "file_offer", { fileId: "f2", name: "gone.bin", size: 9, type: "application/octet-stream" }),
  await mk(B, "e7", 1500, "blame", { target: A.peerId }),
  await mk(A, "e8", 1600, "coin", { result: "heads" }),
  await mk(A, "e9", 1700, "kick", { peerId: B.peerId }),            // admin lines must not come across
  await mk(A, "e10", 1800, "role_changed", { hostId: B.peerId }),
  await mk(A, "e11", 1900, "space_closed", {}),
  await mk(A, "e12", 1950, "perms_changed", { chat: false, files: false, music: false }),
];
const input = { spaceId: "oldroom", me: { id: A.peerId, name: "Ann" }, hostId: A.peerId, closed: true,
  members: [{ peerId: A.peerId, name: "Ann", firstJoin: 1000, online: true }, { peerId: B.peerId, name: "Bob", firstJoin: 1100, online: true }],
  events, files: [{ fileId: "f1", name: "note.txt", type: "text/plain", size: 5, blob: new Blob(["hello"]) }] };
const { blob } = await buildExport(input, true);
const file = new File([blob], "x.zip");

const p = await readExport(file);
assert.equal(p.summary.messages, 2); assert.equal(p.summary.people, 2);
assert.deepEqual(p.archive.events.map((e) => e.id).sort(), ["e3", "e4", "e5", "e6", "e7", "e8"], "only content lines come across (no joins, kick, host change, close, permissions)");
assert.equal(p.summary.files, 1); assert.equal(p.summary.filesMissing, 1, "f2 was not in the zip");
assert.ok(p.blobs.has("f1") && !p.blobs.has("f2"));
assert.equal(p.archive.names[A.peerId], "Ann"); assert.equal(p.archive.names[B.peerId], "Bob");
assert.equal(p.sha256, await sha256Hex(p.json as BufferSource));
console.log("ok: round trip keeps content, drops admin lines, counts attachments");

// the archive blob re-opens for a peer holding only the host's signed hash
const opened = await openArchive(p.json, p.sha256);
assert.ok(opened && opened.events.length === 6 && opened.aid === p.aid, "peer verifies and opens it");
assert.equal(await openArchive(p.json, "0".repeat(64)), null, "wrong hash: rejected");
const flipped = new Uint8Array(p.json); flipped[flipped.length >> 1] ^= 1;
assert.equal(await openArchive(flipped, p.sha256), null, "one flipped byte: rejected");
// a holder who swaps content but also fixes the hash still fails on signatures
const forged = JSON.parse(new TextDecoder().decode(p.json)); forged.events[0].payload.text = "I never said this";
const fb = new TextEncoder().encode(JSON.stringify(forged));
assert.equal(await openArchive(fb, await sha256Hex(fb as BufferSource)), null, "edited text with a correct hash still fails signature check");
const forged2 = JSON.parse(new TextDecoder().decode(p.json)); forged2.events.push({ ...forged2.events[0], id: "zz", author: "x".repeat(16) });
const fb2 = new TextEncoder().encode(JSON.stringify(forged2)); assert.equal(await openArchive(fb2, await sha256Hex(fb2 as BufferSource)), null, "forged author fails");
const forged3 = JSON.parse(new TextDecoder().decode(p.json)); forged3.events.push(forged3.events[0]);
const fb3 = new TextEncoder().encode(JSON.stringify(forged3)); assert.equal(await openArchive(fb3, await sha256Hex(fb3 as BufferSource)), null, "duplicate ids rejected");
console.log("ok: archive bytes are bound to the host's hash and to every author's signature");

// import-side refusals
const room = JSON.parse(await (await (async () => { const { openZip } = await import("../.build/unzip.ts"); const z = await openZip(file); return new Blob([await z.read(z.entries.get("room.json")!)]); })()).text());
const rebuild = async (mut: (r: any) => void, withFiles = true) => {
  const r = structuredClone(room); mut(r);
  const entries = [{ name: "room.json", data: new TextEncoder().encode(JSON.stringify(r)) }];
  if (withFiles) entries.push({ name: room.files[0].path, data: new TextEncoder().encode("hello") });
  return new File([makeZip(entries)], "t.zip");
};
await assert.rejects(readExport(await rebuild((r) => { r.events[2].payload.text = "tampered"; })), /failed verification/, "edited message refused");
await assert.rejects(readExport(await rebuild((r) => { r.events[2].author = "0".repeat(16); })), /failed verification/, "forged author refused");
await assert.rejects(readExport(await rebuild((r) => { r.format = "other"; })), /failed verification|not a Deca/, "wrong format refused");
await assert.rejects(readExport(new File([new TextEncoder().encode("not a zip at all")], "t.zip")), /not a readable zip/, "non-zip refused");
await assert.rejects(readExport(new File([makeZip([{ name: "other.txt", data: new Uint8Array(3) }])], "t.zip")), /no room\.json/, "zip without room.json refused");
const tamperedFile = await rebuild(() => {}, false);
{ const { zipWith } = { zipWith: (n: string, d: string) => new File([makeZip([{ name: "room.json", data: new TextEncoder().encode(JSON.stringify(room)) }, { name: room.files[0].path, data: new TextEncoder().encode(d) }])], "t.zip") };
  const q = await readExport(zipWith("x", "HELLO")); assert.equal(q.summary.files, 0, "attachment whose bytes do not match the recorded hash is dropped"); assert.equal(q.summary.filesMissing, 2); }
const huge = await rebuild((r) => { for (let i = 0; i < 5100; i++) r.events.push({ ...r.events[2], id: "x" + i }); });
await assert.rejects(readExport(huge), /failed verification|limit/, "oversized refused");
void tamperedFile;
console.log("ok: tampering, wrong files, missing room.json, mismatched attachments and oversize are all refused");

// derive: archive_added rules
const H = A.peerId, M = B.peerId;
const base = [await mk(A, "j1", 1, "joined", { name: "H" }), await mk(B, "j2", 2, "joined", { name: "M" })];
const ref = { aid: "abcdef012345", sha256: "a".repeat(64), bytes: 100, events: 3, from: "old" };
const vis = (evs: SpaceEvent[]) => derive(evs, H).archives.map((a) => a.aid);
assert.deepEqual(vis([...base, await mk(A, "a1", 3, "archive_added", ref)]), ["abcdef012345"], "host can add");
assert.deepEqual(vis([...base, await mk(B, "a1", 3, "archive_added", ref)]), [], "a member cannot add history");
assert.deepEqual(vis([...base, await mk(A, "a1", 3, "archive_added", { ...ref, sha256: "zz" })]), [], "bad hash");
assert.deepEqual(vis([...base, await mk(A, "a1", 3, "archive_added", { ...ref, aid: "../../x" })]), [], "bad id");
assert.deepEqual(vis([...base, await mk(A, "a1", 3, "archive_added", { ...ref, bytes: 99e6 })]), [], "too big");
assert.deepEqual(vis([...base, await mk(A, "a1", 3, "archive_added", { ...ref, events: 99999 })]), [], "too many lines");
assert.deepEqual(vis([...base, await mk(A, "a1", 3, "archive_added", ref), await mk(A, "a2", 4, "archive_added", ref)]), ["abcdef012345"], "same id twice counts once");
const four = await Promise.all([1, 2, 3, 4].map((i) => mk(A, "m" + i, 3 + i, "archive_added", { ...ref, aid: "00000000000" + i })));
assert.equal(vis([...base, ...four]).length, 3, "at most three per room");
assert.deepEqual(vis([...base, await mk(A, "o", 3, "kick", { peerId: H })].concat([])), [], "none by default");
// an archive can never alter the room: nothing about host, perms, members or closed changes
const s = derive([...base, await mk(A, "a1", 3, "archive_added", ref)], H);
assert.equal(s.hostId, H); assert.equal(s.closed, false); assert.equal(s.members.size, 2); assert.deepEqual(s.perms, { chat: true, files: true, music: true });
// live file offers cannot use the reserved prefix
assert.equal(derive([...base, await mk(B, "f", 3, "file_offer", { fileId: "arch:abcdef012345", name: "x", size: 1 })], H).visible.some((e) => e.id === "f"), false, "reserved arch: id rejected");
console.log("ok: archive_added is host-only, bounded, hash-committed, and changes nothing else about the room");
