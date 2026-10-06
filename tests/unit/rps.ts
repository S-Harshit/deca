import assert from "node:assert";
import { derive, rpsOutcome, HANDS } from "../.build/log.ts";
const ev = (id: string, author: string, ts: number, payload: any, type: any = "rps") => ({ id, author, ts, type, payload });
const base = [ev("a", "A", 1, { name: "A" }, "joined"), ev("b", "B", 2, { name: "B" }, "joined"), ev("c", "C", 3, { name: "C" }, "joined")];
const st = (extra: any[]) => derive([...base, ...extra] as any, "A");
// outcome table
for (const [x, y, r] of [["rock", "scissors", "win"], ["scissors", "paper", "win"], ["paper", "rock", "win"], ["rock", "paper", "lose"], ["rock", "rock", "draw"]] as const) assert.equal(rpsOutcome(x, y), r, x + " vs " + y);
for (const h of HANDS) for (const o of HANDS) assert.equal(rpsOutcome(h, o), { win: "lose", lose: "win", draw: "draw" }[rpsOutcome(o, h)], "symmetric");
// basic pair
let s = st([ev("t1", "A", 10, { throw: "rock" }), ev("t2", "B", 12, { throw: "paper", vs: "t1" })]);
assert.equal(s.rpsPairs.get("t1"), "t2"); assert.equal(s.rpsPairs.get("t2"), "t1"); assert.ok(s.rpsSecond.has("t2") && !s.rpsSecond.has("t1"));
// unanswered stays unpaired
s = st([ev("t1", "A", 10, { throw: "rock" })]); assert.equal(s.rpsPairs.size, 0); assert.equal(s.visible.filter((e) => e.type === "rps").length, 1);
// can't answer yourself
s = st([ev("t1", "A", 10, { throw: "rock" }), ev("t2", "A", 11, { throw: "paper", vs: "t1" })]); assert.equal(s.rpsPairs.size, 0);
// two answerers to one throw: one pair only, and the loser of the race stays unpaired
s = st([ev("t1", "A", 10, { throw: "rock" }), ev("t2", "B", 12, { throw: "paper", vs: "t1" }), ev("t3", "C", 13, { throw: "scissors", vs: "t1" })]);
assert.equal(s.rpsPairs.size, 2); assert.equal(s.rpsPairs.get("t1"), "t2"); assert.ok(!s.rpsPairs.has("t3"));
// dangling / forged references
s = st([ev("t2", "B", 12, { throw: "paper", vs: "nope" })]); assert.equal(s.rpsPairs.size, 0);
s = st([ev("m", "A", 5, { text: "hi" }, "chat"), ev("t2", "B", 12, { throw: "paper", vs: "m" })]); assert.equal(s.rpsPairs.size, 0, "can only answer a throw");
// invalid hand is dropped entirely
s = st([ev("t1", "A", 10, { throw: "lizard" })]); assert.equal(s.visible.filter((e) => e.type === "rps").length, 0);
// clock skew: the answer's timestamp is BEFORE the throw it answers (responder's clock an hour behind)
s = st([ev("t1", "A", 3_600_000, { throw: "rock" }), ev("t2", "B", 100, { throw: "paper", vs: "t1" })]); assert.equal(s.rpsPairs.get("t2"), "t1", "pairing doesn't depend on timestamps");
// permissions
s = st([ev("p", "A", 4, { chat: false, files: true, music: true }, "perms_changed"), ev("t1", "A", 10, { throw: "rock" }), ev("t2", "B", 12, { throw: "paper", vs: "t1" })]);
assert.ok(s.visible.some((e) => e.id === "t1") && !s.visible.some((e) => e.id === "t2") && s.rpsPairs.size === 0);
console.log("rock-paper-scissors pairing tests passed");
