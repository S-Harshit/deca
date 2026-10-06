import assert from "node:assert";
import { derive, type SpaceEvent } from "../.build/log.ts";
const ev = (id: string, author: string, ts: number, type: any, payload: any = {}): SpaceEvent => ({ id, author, ts, type, payload });
const base = [ev("j1", "H", 1, "joined", { name: "Host" }), ev("j2", "M", 2, "joined", { name: "Mem" })];
const vis = (events: SpaceEvent[]) => derive(events, "H").visible.filter((e) => e.type === "blame").map((e) => e.id);

assert.deepEqual(vis([...base, ev("b1", "M", 3, "blame", { target: "H" })]), ["b1"], "a member can blame the host");
assert.deepEqual(vis([...base, ev("b1", "H", 3, "blame", { target: "H" })]), ["b1"], "blaming yourself is allowed");
assert.deepEqual(vis([...base, ev("b1", "M", 3, "blame", { target: "ghost" })]), [], "unknown target is ignored");
assert.deepEqual(vis([...base, ev("b1", "M", 3, "blame", { target: 42 })]), [], "non-string target is ignored");
assert.deepEqual(vis([...base, ev("b1", "M", 3, "blame", {})]), [], "missing target is ignored");
assert.deepEqual(vis([...base, ev("b1", "M", 3, "blame", { target: { x: 1 } })]), [], "object target is ignored");
assert.deepEqual(vis([...base, ev("b0", "M", 1.5, "blame", { target: "H" })]).length, 1, "target joined earlier in order: fine");
assert.deepEqual(vis([ev("b0", "M", 0, "blame", { target: "H" }), ...base]), [], "blaming before the target joined is ignored");
// chat off: members can't, host can
const off = ev("p", "H", 2.5, "perms_changed", { chat: false, files: true, music: true });
assert.deepEqual(vis([...base, off, ev("b1", "M", 3, "blame", { target: "H" })]), [], "members cannot blame when chat is off");
assert.deepEqual(vis([...base, off, ev("b1", "H", 3, "blame", { target: "M" })]), ["b1"], "host still can");
// kicked author
assert.deepEqual(vis([...base, ev("k", "H", 2.5, "kick", { peerId: "M" }), ev("b1", "M", 3, "blame", { target: "H" })]), [], "kicked members are ignored");
// a forged blame by a non-member author
// like chat/coin/rps today: authorship is proven by the signature, membership by the joined event every peer sends first
assert.deepEqual(vis([...base, ev("b1", "X", 3, "blame", { target: "H" })]), ["b1"], "same rule as the other events");
console.log("blame validity: all ok");
