// Live text for notes and open pages: concurrent typing converges, nothing typed is lost, and a hostile or muted sender cannot get past
// the limits. Peers are wired together in memory; messages are delivered in any order the test chooses.
import assert from "node:assert";
import { Collab, type CollabIO } from "../.build/collab.ts";

type Wire = { from: string; to: string; msg: any };
const queue: Wire[] = [];
const peers = new Map<string, Collab>();
const allowed = new Set<string>();
let cap = 100;
const make = (name: string) => {
  const io: CollabIO = {
    sendTo: (to, msg) => void queue.push({ from: name, to, msg }),
    broadcast: (msg) => { for (const p of peers.keys()) if (p !== name) queue.push({ from: name, to: p, msg }); },
    relay: () => {},
    can: (p) => allowed.has(p),
    cap: () => cap,
    changed: () => {},
  };
  const c = new Collab(io);
  peers.set(name, c);
  allowed.add(name);
  return c;
};
const deliver = (shuffle = false) => {
  while (queue.length) {
    const w = shuffle ? queue.splice(Math.floor(Math.random() * queue.length), 1)[0] : queue.shift()!;
    peers.get(w.to)?.onMsg(w.from, w.msg);
  }
};

const A = make("A"), B = make("B"), C = make("C");
for (const c of [A, B, C]) c.ensure(["doc"]);
deliver();

// typing in the same spot at the same moment: both survive, all converge
A.set("doc", "hello world"); deliver();
assert.equal(B.text("doc"), "hello world");
A.set("doc", "hello brave world"); B.set("doc", "hello big world"); C.set("doc", "oh hello world");
deliver();
const merged = A.text("doc");
assert.equal(B.text("doc"), merged); assert.equal(C.text("doc"), merged);
for (const w of ["brave", "big", "oh"]) assert.ok(merged.includes(w), `kept ${w}: ${merged}`);
console.log("ok: three people editing the same place at once keep everything and agree");

// random edits, delivered in a random order
{
  const rnd = (n: number) => Math.floor(Math.random() * n);
  for (let round = 0; round < 60; round++) {
    for (const c of [A, B, C]) {
      const t = c.text("doc");
      const at = rnd(t.length + 1);
      const next = Math.random() < 0.35 && t.length > 3 ? t.slice(0, at) + t.slice(at + 2) : t.slice(0, at) + "xyz".slice(0, 1 + rnd(3)) + t.slice(at);
      c.set("doc", next.slice(0, cap));
    }
    deliver(true);
    assert.equal(A.text("doc"), B.text("doc")); assert.equal(B.text("doc"), C.text("doc"));
  }
  console.log("ok: 180 random concurrent edits, delivered out of order, always converge");
}

// a latecomer asks for what it lacks
{
  const D = make("D"); D.ensure(["doc"]); D.hello("A"); deliver();
  assert.equal(D.text("doc"), A.text("doc"));
  console.log("ok: someone who joins later is brought up to date");
}

// limits and who may speak
{
  const E = make("E"); E.ensure(["doc"]); deliver();
  const before = A.text("doc");
  const evil = make("X"); evil.ensure(["doc"]); allowed.delete("X");
  evil.set("doc", "y".repeat(90), 10_000); deliver();
  assert.equal(A.text("doc"), before, "an update from someone not allowed to speak is ignored");
  allowed.add("X"); evil.set("doc", "z".repeat(9000), 10_000); deliver();
  assert.equal(A.text("doc"), before, "an update past the length limit is refused whole");
  assert.equal(A.set("doc", "q".repeat(5000)), false, "a local edit past the limit is refused too");
  A.onMsg("B", { t: "yup", d: "doc", u: "!!not base64!!" }); A.onMsg("B", { t: "yup", d: "nope", u: "AAAA" }); A.onMsg("B", { t: "ysv", d: "doc", sv: 5 as never });
  assert.equal(A.text("doc"), before, "garbage does not throw or change anything");
  console.log("ok: muted senders, over-long updates and malformed messages are all refused");
}
process.exit(0);
