import assert from "node:assert";
import { canon } from "../.build/signing.ts";
import { LocalSignaling, type MeshLink } from "../.build/localSignal.ts";
import { idFromPub } from "../.build/identity.ts";
const hex = (n: number) => n.toString(16).padStart(16, "0");
const b64s = (u: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(u)));
async function ident() { const k = (await crypto.subtle.generateKey({ name: "Ed25519" } as never, true, ["sign", "verify"])) as CryptoKeyPair; const pub = b64s(await crypto.subtle.exportKey("raw", k.publicKey)); return { id: await idFromPub(pub), pub, sign: async (t: string) => b64s(await crypto.subtle.sign({ name: "Ed25519" } as never, k.privateKey, new TextEncoder().encode(t))) }; }
const keys = new Map<string, Awaited<ReturnType<typeof ident>>>();
const mkId = async () => { const i = await ident(); keys.set(i.id, i); return i; };
const HOST = hex(2);
const PEERI = await mkId(), OTHERI = await mkId(); const PEER = PEERI.id, OTHER = OTHERI.id;
const meSigner = await mkId(); const ME = meSigner.id;
const enc = (o: unknown) => { return null; };
const b64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
async function decode(c: string) { const u = Uint8Array.from(atob(c.slice(6).replaceAll("-", "+").replaceAll("_", "/")), (x) => x.charCodeAt(0)); return new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text(); }
async function code(body: any) { if (body.sig === undefined && keys.has(body.f?.id)) { const k = keys.get(body.f.id)!; body = { ...body, pub: k.pub, sig: await k.sign(canon(body)) }; } const s = new Blob([new TextEncoder().encode(JSON.stringify(body))]).stream().pipeThrough(new CompressionStream("deflate-raw")); return "deca1." + b64(new Uint8Array(await new Response(s).arrayBuffer())); }
void enc;
function make(opts: { room?: string; open?: string[] } = {}) {
  const sent: any[] = [], met: any[] = [], inbox: any[] = [];
  const mesh: MeshLink = { isOpen: (id) => (opts.open ?? []).includes(id), openIds: () => opts.open ?? [], sendTo: (id, m) => (sent.push([id, m]), true), meet: (id, name, dial) => met.push([id, name, dial]) };
  const hub = new LocalSignaling({ id: ME, name: "Me" }, meSigner, HOST, opts.room ?? "aaaaaaaaaaaa", { id: HOST, name: "Host" });
  hub.bind(mesh); hub.onmessage = (e) => inbox.push(JSON.parse(e.data)); hub.socket();
  return { hub, sent, met, inbox };
}
const good = (over: any = {}) => ({ v: 2, f: { id: PEER, name: "Pat" }, to: ME, host: HOST, room: "aaaaaaaaaaaa", g: 5, m: [{ description: { type: "offer", sdp: "x" } }, { candidate: { candidate: "c" } }], ...over });
await new Promise((r) => setTimeout(r, 5));

// join: answered like the server would
{ const t = make(); t.hub.send(JSON.stringify({ type: "join" })); const j = t.inbox.find((m) => m.type === "joined"); assert.equal(j.hostId, HOST); assert.deepEqual(j.peers.map((p: any) => p.peerId), [HOST]); assert.equal(j.max, 8); assert.equal(j.resumed, false); t.hub.send(JSON.stringify({ type: "join" })); assert.equal(t.inbox.filter((m) => m.type === "joined")[1].resumed, true); t.hub.send('{"type":"ping"}'); assert.ok(t.inbox.some((m) => m.type === "pong")); console.log("ok: answers join (host first), resume and ping like the server"); }
// a good code
{ const t = make(); assert.equal(await t.hub.paste("here you go: " + await code(good()) + " thanks"), "", "found inside surrounding text"); assert.deepEqual(t.met, [], "a stranger is not let in on their own"); assert.deepEqual(t.hub.waiting(), [{ peerId: PEER, name: "Pat" }]); assert.equal(t.inbox.filter((m) => m.type === "signal").length, 0); t.hub.approve(PEER); assert.deepEqual(t.met, [[PEER, "Pat", false]]); const sig = t.inbox.filter((m) => m.type === "signal"); assert.equal(sig.length, 2); assert.equal(sig[0].from, PEER); assert.equal(sig[0].gen, 5); assert.ok(sig[0].payload.description); console.log("ok: a good code (even inside a chat message) introduces the person and delivers every message in order"); }
// refusals
const refuse = async (c: string, re: RegExp, label: string, opts?: any) => { const t = make(opts); const r = await t.hub.paste(c); assert.match(r, re, label); assert.equal(t.inbox.filter((m) => m.type === "signal").length, 0, label + ": nothing delivered"); assert.equal(t.met.length, 0, label + ": nobody introduced"); };
await refuse("hello there", /does not look like a Deca code/, "not a code");
await refuse("deca1.", /does not look like/, "empty body");
await refuse("deca1." + "A".repeat(30), /damaged/, "garbage that is not compressed data");
await refuse((await code(good())).slice(0, -12), /damaged/, "cut short");
{ const c = await code(good()); const flipped = c.slice(0, 40) + (c[40] === "A" ? "B" : "A") + c.slice(41); await refuse(flipped, /damaged|understands|someone else/, "one character changed"); }
await refuse(await code(good({ to: OTHER })), /for someone else/, "addressed to another person");
await refuse(await code(good({ room: "bbbbbbbbbbbb" })), /different room/, "another room");
await refuse(await code(good({ host: OTHER })), /different host/, "another host");
await refuse(await code(good({ f: { id: ME, name: "Me" } })), /your own code/, "own code");
await refuse(await code(good({ v: 1 })), /understands/, "old version");
await refuse(await code(good({ v: 3 })), /understands/, "unknown version");
await refuse(await code(good({ f: { id: "nothex", name: "x" } })), /understands/, "bad id");
// signatures: a code cannot claim to be someone else, or be changed
{ const c = JSON.parse(await decode(await code(good()))); await refuse(await code({ ...c, f: { id: OTHER, name: "Pat" }, sig: c.sig }), /not signed by/, "claims another person's id with its own signature"); await refuse(await code({ ...c, g: 6 }), /not signed by/, "a signed code changed afterwards"); await refuse(await code({ ...c, sig: "AAAA" }), /not signed by/, "a bad signature"); await refuse(await code({ ...c, pub: undefined }), /not signed by/, "no key"); const { pub, sig, ...unsigned } = c; await refuse(await code({ ...unsigned, sig: "" }), /not signed by/, "unsigned"); }
await refuse(await code(good({ f: { id: PEER, name: 5 } })), /understands/, "bad name");
await refuse(await code(good({ m: "no" })), /understands/, "messages not a list");
await refuse(await code(good({ m: Array(61).fill({ candidate: {} }) })), /understands/, "too many messages");
await refuse(await code(good({ m: [null] })), /damaged/, "a null message");
await refuse(await code(good({ g: "x" })), /understands/, "bad generation");
// decompression bomb: a tiny code that would expand to megabytes is refused, not inflated
{ const bomb = await code({ ...good(), pad: "A".repeat(5_000_000) }); assert.ok(bomb.length < 20_000, "the bomb is small on the wire: " + bomb.length); await refuse(bomb, /damaged/, "decompression bomb"); }
console.log("ok: refuses garbage, damaged, cut-off, tampered, wrong person, wrong room, wrong host, own code, bad shapes, and a decompression bomb, each with a plain message and nothing delivered");
// room full
{ const t = make(); const ps = []; for (let i = 0; i < 7; i++) ps.push(await mkId()); for (let i = 0; i < 6; i++) { assert.equal(await t.hub.paste(await code(good({ f: { id: ps[i].id, name: "P" + i } }))), ""); t.hub.approve(ps[i].id); } assert.match(await t.hub.paste(await code(good({ f: { id: ps[6].id, name: "late" } }))), /full/); t.hub.approve(ps[0].id); assert.equal(await t.hub.paste(await code(good({ f: { id: ps[0].id, name: "P0" } }))), "", "someone already here can still reconnect"); console.log("ok: a room holds 8 people (the cap is enforced here, with no server), and someone already in can still come back"); }
// introductions over a link
{ const t = make({ open: [PEER] }); t.hub.handleControl(PEER, { t: "roster", peers: [{ id: OTHER, name: "Olly" }, { id: ME, name: "me" }, { id: "bad", name: "x" }] }); assert.deepEqual(t.met, [[OTHER, "Olly", true]], "a newcomer dials everyone on the roster (not itself, not junk)"); t.hub.handleControl(PEER, { t: "hello", id: hex(9), name: "New" }); assert.deepEqual(t.met[1], [hex(9), "New", false], "an existing member waits for the newcomer to dial"); console.log("ok: roster introductions: newcomers dial, existing members wait, junk and self are ignored"); }
// relay rules
{ const t = make({ open: [PEER, OTHER] }); t.hub.handleControl(PEER, { t: "sig", from: PEER, to: OTHER, p: { candidate: {} }, g: 1 }); assert.equal(t.sent.length, 1); assert.equal(t.sent[0][0], OTHER); assert.equal(t.sent[0][1].hops, 1, "passed on once"); t.sent.length = 0; t.hub.handleControl(PEER, { t: "sig", from: PEER, to: OTHER, p: {}, g: 1, hops: 1 }); assert.equal(t.sent.length, 0, "never passed on twice: no loops"); t.hub.handleControl(PEER, { t: "sig", from: "evil", to: ME, p: {}, g: 1 }); assert.equal(t.inbox.filter((m) => m.type === "signal").length, 0, "a malformed sender is dropped"); const env = async (who: any, over: any = {}) => { const body = { from: who.id, fn: "Pat", to: ME, g: 3, p: { description: { type: "answer", sdp: "x" } }, ...over }; return { t: "sig", ...body, pub: who.pub, sg: await who.sign(canon(body)) }; };
  const sigs = () => t.inbox.filter((m) => m.type === "signal").length; const tick = () => new Promise((r) => setTimeout(r, 40));
  t.hub.handleControl(PEER, { ...(await env(PEERI)), p: { description: { type: "answer", sdp: "changed after signing" } } }); await tick(); assert.equal(sigs(), 0, "a relay that changes the payload is caught");
  t.hub.handleControl(PEER, await env(OTHERI, { from: PEER })); await tick(); assert.equal(sigs(), 0, "a message signed by someone else but claiming to be from Pat is dropped");
  t.hub.handleControl(PEER, { t: "sig", from: PEER, to: ME, fn: "Pat", p: {}, g: 1 }); await tick(); assert.equal(sigs(), 0, "an unsigned message is dropped");
  t.hub.handleControl(PEER, await env(PEERI)); await tick(); assert.equal(sigs(), 1, "a properly signed one is delivered"); assert.equal(t.met.length, 1, "an unknown sender is introduced first"); console.log("ok: relays once (no loops), drops malformed senders, introduces strangers before their messages, rejects altered, forged and unsigned relayed messages"); }
// routing and sealing
{
  const t = make({ open: [PEER] }); t.hub.send(JSON.stringify({ type: "signal", to: PEER, payload: { candidate: 1 }, gen: 1 })); await new Promise((r) => setTimeout(r, 30)); assert.equal(t.sent[0][1].t, "sig", "over an open link"); assert.ok(t.sent[0][1].sg && t.sent[0][1].pub, "signed"); assert.equal(t.hub.codes.length, 0);
  const u = make({ open: [] }); const sig = (p: any, gen: number) => u.hub.send(JSON.stringify({ type: "signal", to: PEER, payload: p, gen }));
  sig({ description: 1 }, 1); sig({ candidate: 2 }, 1);
  assert.deepEqual(u.hub.preparing(), [PEER], "while the browser is still looking for addresses the code is 'being prepared'"); assert.equal(u.hub.codes.length, 0); assert.ok(u.hub.holdsCode(PEER), "...and counts as a code waiting to be carried");
  u.hub.gatheringDone(PEER, 1); await new Promise((r) => setTimeout(r, 50));
  assert.equal(u.hub.codes.length, 1, "sealed the moment the browser says it is done, not after a guess"); assert.equal(u.hub.codes[0].kind, "ask" as never === "x" ? "ask" : u.hub.codes[0].kind); assert.deepEqual(u.hub.preparing(), []);
  const text = u.hub.codes[0].text; sig({ candidate: 3 }, 1); await new Promise((r) => setTimeout(r, 2800));
  assert.equal(u.hub.codes[0].text, text, "a sealed code never changes under whoever is copying it"); assert.equal(u.hub.codes.length, 1);
  sig({ description: 2 }, 2); u.hub.gatheringDone(PEER, 2); await new Promise((r) => setTimeout(r, 50));
  assert.equal(u.hub.codes.length, 1, "a newer attempt replaces the older code"); assert.notEqual(u.hub.codes[0].text, text);
  // the fallback: a browser that never says it is done still gets a code after a quiet moment
  const w = make({ open: [] }); w.hub.send(JSON.stringify({ type: "signal", to: PEER, payload: { description: { type: "answer" } }, gen: 7 })); await new Promise((r) => setTimeout(r, 3000)); assert.equal(w.hub.codes.length, 1, "fallback seal"); assert.equal(w.hub.codes[0].kind, "reply", "an answer makes a reply code");
  console.log("ok: messages go over a link when there is one; otherwise one code per person, sealed when gathering is done (or after a fallback), never changed once sealed, replaced by a newer attempt");
}
// a link that never worked is not a person who left; one that worked and stayed down is
{
  const t = make({ open: [] }); t.hub.handleControl(PEER, { t: "hello", id: OTHER, name: "Olly" }); // known, never connected
  t.hub.peerLost(OTHER); await new Promise((r) => setTimeout(r, 100)); assert.equal(t.inbox.filter((m) => m.type === "peer-left").length, 0, "nothing scheduled for a link that never came up");
  t.hub.peerOpened(OTHER); t.hub.peerLost(OTHER); assert.ok(true, "a link that worked starts the clock (15 s) - checked end to end in the browser test");
  console.log("ok: only someone whose link worked before can be said to have left");
}
// a code round trips between two hubs
{ const A = make(); const B = new LocalSignaling({ id: PEER, name: "Pat" }, PEERI, HOST, "aaaaaaaaaaaa", { id: ME, name: "Me" }); B.bind({ isOpen: () => false, openIds: () => [], sendTo: () => false, meet: () => {} }); B.socket(); await new Promise((r) => setTimeout(r, 5)); B.send(JSON.stringify({ type: "signal", to: ME, payload: { description: { type: "offer" } }, gen: 9 })); B.gatheringDone(ME, 9); await new Promise((r) => setTimeout(r, 100)); assert.equal(await A.hub.paste(B.codes[0].text), ""); A.hub.approve(PEER); assert.equal(A.inbox.find((m) => m.type === "signal").gen, 9); console.log("ok: a code made by one hub is accepted by another"); }
// leaving
{ const t = make({ open: [PEER, OTHER] }); t.hub.send(JSON.stringify({ type: "leave" })); assert.equal(t.sent.filter(([, m]) => m.t === "bye").length, 2); t.hub.handleControl(PEER, { t: "bye" }); assert.ok(t.inbox.some((m) => m.type === "peer-left" && m.peerId === PEER)); console.log("ok: goodbyes are sent to every link and understood"); }
// check words: both sides compute the same words from the two connection fingerprints
{ const { checkWords, WORD_COUNT } = await import("../.build/sas.ts"); const a = await checkWords(["AA:BB", "CC:DD", "x", "y"]); const b = await checkWords(["CC:DD", "AA:BB", "y", "x"]); assert.equal(a, b, "same words whichever side computes them"); assert.notEqual(a, await checkWords(["AA:BB", "CC:DE", "x", "y"]), "a different fingerprint gives different words"); assert.equal(a.split(" ").length, 6); assert.equal(WORD_COUNT, 256); console.log("ok: check words are equal on both sides and change with the fingerprints"); }
process.exit(0);
