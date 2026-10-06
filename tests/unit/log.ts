import assert from "node:assert";
import { EventLog, derive, type SpaceEvent } from "../.build/log.ts";

const ev = (id: string, author: string, ts: number, type: any, payload: any = {}): SpaceEvent => ({ id, author, ts, type, payload });

// two peers with divergent logs converge via set-union sync
const A = new EventLog(), B = new EventLog();
A.add(ev("1", "A", 1, "joined", { name: "Ann" }));
A.add(ev("2", "A", 3, "chat", { text: "hi" }));
B.add(ev("1", "A", 1, "joined", { name: "Ann" }));
B.add(ev("3", "B", 2, "joined", { name: "Bob" }));
A.missing(B.ids()).forEach((e) => B.add(e));
B.missing(A.ids()).forEach((e) => A.add(e));
assert.deepEqual(A.ids().sort(), B.ids().sort());
assert.equal(A.ids().length, 3);

// duplicate deterministic 'left' from two observers dedupes
const left = ev("left:B:3", "A", 5, "left", { peerId: "B", joinId: "3" });
assert.equal(A.add(left), true);
assert.equal(A.add({ ...left, author: "C" }), false);

let s = derive(A.all(), "A");
assert.equal(s.members.get("B")!.online, false);
assert.equal(s.members.get("A")!.online, true);

// returned starts a new session; stale left (old joinId) is ignored
A.add(ev("4", "B", 6, "returned", { name: "Bob" }));
A.add(ev("left:B:3-late", "C", 7, "left", { peerId: "B", joinId: "3" }));
s = derive(A.all(), "A");
assert.equal(s.members.get("B")!.online, true);

// admin events: only host counts
A.add(ev("5", "B", 8, "kick", { peerId: "A" }));           // B is not host: ignored
A.add(ev("6", "A", 9, "perms_changed", { chat: false, files: true }));
A.add(ev("7", "B", 10, "chat", { text: "muted" }));        // chat off, B not host: hidden
A.add(ev("8", "A", 11, "chat", { text: "host can" }));
s = derive(A.all(), "A");
assert.equal(s.kicked.size, 0);
assert.ok(!s.visible.some((e) => e.id === "7"));
assert.ok(s.visible.some((e) => e.id === "8"));

// handover then new host can kick old host's target; old host loses power
A.add(ev("9", "A", 12, "role_changed", { hostId: "B" }));
A.add(ev("10", "A", 13, "kick", { peerId: "B" }));         // A no longer host: ignored
A.add(ev("11", "B", 14, "kick", { peerId: "A" }));
s = derive(A.all(), "A");
assert.equal(s.hostId, "B");
assert.ok(s.kicked.has("A") && !s.kicked.has("B"));

// oversize file offer rejected
const C = new EventLog();
C.add(ev("f", "A", 1, "file_offer", { fileId: "x", name: "big", size: 60 * 1024 * 1024 }));
assert.equal(derive(C.all(), "A").visible.length, 0);

console.log("log tests passed");

// ---- succession ----
{
  const L = new EventLog();
  L.add(ev("a", "A", 1, "joined", { name: "A" }));
  L.add(ev("b", "B", 2, "joined", { name: "B" }));
  L.add(ev("c", "C", 3, "joined", { name: "C" }));
  assert.equal(derive(L.all(), "A").hostId, "A");
  L.add(ev("left:A:a", "B", 4, "left", { peerId: "A", joinId: "a" }));   // host leaves
  let s = derive(L.all(), "A");
  assert.equal(s.hostId, "B", "longest-standing online member becomes host");
  assert.ok(s.visible.some((e) => e.type === "role_changed" && e.payload.hostId === "B"));
  L.add(ev("a2", "A", 5, "returned", { name: "A" }));                     // old host returns
  assert.equal(derive(L.all(), "A").hostId, "B", "returning ex-host does not reclaim");
  L.add(ev("k1", "A", 6, "kick", { peerId: "C" }));                        // A no longer host
  assert.equal(derive(L.all(), "A").kicked.size, 0);
  L.add(ev("k2", "B", 7, "kick", { peerId: "C" }));                        // B is host
  assert.ok(derive(L.all(), "A").kicked.has("C"));
  // cascade: B leaves too -> A (older than C, C kicked) becomes host
  L.add(ev("left:B:b", "A", 8, "left", { peerId: "B", joinId: "b" }));
  assert.equal(derive(L.all(), "A").hostId, "A");
  // same log on two peers => same host (determinism)
  const M = new EventLog(); [...L.all()].reverse().forEach((e) => M.add(e));
  assert.equal(derive(M.all(), "A").hostId, derive(L.all(), "A").hostId);
  // everyone gone, then someone joins -> they become host
  const N = new EventLog();
  N.add(ev("a", "A", 1, "joined", {}));
  N.add(ev("left:A:a", "X", 2, "left", { peerId: "A", joinId: "a" }));
  N.add(ev("d", "D", 3, "joined", {}));
  assert.equal(derive(N.all(), "A").hostId, "D");
  console.log("succession tests passed");
}
