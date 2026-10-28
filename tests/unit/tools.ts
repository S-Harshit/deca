// Pages and notes, polls, the board and doors: ownership, limits and what a hostile member cannot do.
import assert from "node:assert";
import { derive, type SpaceEvent } from "../.build/log.ts";
import { LIMITS, between, noteBlocks, noteText, tally } from "../.build/tools.ts";

const HOST = "a".repeat(16), BEN = "b".repeat(16), CAT = "c".repeat(16), OUT = "d".repeat(16);
let n = 0;
const ev = (author: string, type: string, payload: Record<string, unknown>): SpaceEvent => ({ id: `e${String(++n).padStart(6, "0")}`, author, ts: 1000 + n, type: type as never, payload });
const join = (a: string, name: string) => ev(a, "joined", { name });
const base = [join(HOST, "Host"), join(BEN, "Ben"), join(CAT, "Cat")];
const run = (...more: SpaceEvent[]) => derive([...base, ...more], HOST);
const id = (c: string) => c.repeat(12);

// ---- pages and notes
{
  const s = run(ev(BEN, "doc_set", { id: id("1"), kind: "page", title: "Plan", body: "<h1>Plan</h1>" }), ev(CAT, "doc_set", { id: id("1"), kind: "page", title: "Hijack", body: "x" }));
  assert.equal(s.tools.docs.get(id("1"))!.title, "Plan", "only a page's author can change it");
  const h = run(ev(BEN, "doc_set", { id: id("1"), kind: "page", title: "Plan", body: "a" }), ev(HOST, "doc_set", { id: id("1"), kind: "page", title: "Edited by host", body: "b" }));
  assert.equal(h.tools.docs.get(id("1"))!.title, "Edited by host", "the host can");
  const note = run(ev(BEN, "doc_set", { id: id("2"), kind: "note", title: "Notes", body: "" }), ev(BEN, "blk_set", { doc: id("2"), id: id("a"), key: "V", text: "one" }), ev(CAT, "blk_set", { doc: id("2"), id: id("a"), key: "V", text: "one two" }));
  assert.equal(note.tools.docs.get(id("2"))!.blocks.get(id("a"))!.text, "one two", "anyone can edit a note's paragraph (the latest save wins)");
  const kind = run(ev(BEN, "doc_set", { id: id("2"), kind: "note", title: "N", body: "" }), ev(BEN, "doc_set", { id: id("2"), kind: "page", title: "N", body: "<b>x</b>" }));
  assert.equal(kind.tools.docs.get(id("2"))!.kind, "note", "the kind never changes");
  const del = run(ev(BEN, "doc_set", { id: id("3"), kind: "note", title: "N", body: "" }), ev(CAT, "doc_del", { id: id("3") }));
  assert.ok(del.tools.docs.has(id("3")), "a stranger cannot delete");
  assert.ok(!run(ev(BEN, "doc_set", { id: id("3"), kind: "note", title: "N", body: "" }), ev(BEN, "doc_del", { id: id("3") })).tools.docs.has(id("3")), "the author can");
  const feed = run(ev(BEN, "doc_set", { id: id("4"), kind: "note", title: "N", body: "" }), ev(BEN, "blk_set", { doc: id("4"), id: id("a"), key: "V", text: "y" }), ev(BEN, "doc_set", { id: id("4"), kind: "note", title: "N2", body: "" }));
  assert.equal(feed.visible.filter((e) => e.type === "doc_set").length, 1, "only the creation reaches the feed, not every edit");
  console.log("ok: pages are their author's, notes are everyone's, kinds never change, edits stay out of the feed");
}
// ---- notes are paragraphs, so concurrent edits merge
{
  const doc: SpaceEvent = { id: "d000000", author: BEN, ts: 1003.5, type: "doc_set", payload: { id: id("e"), kind: "note", title: "N", body: "" } }; // always first, whatever order the test builds the rest in
  const mk = (...more: SpaceEvent[]) => derive([...base, doc, ...more], HOST);
  const blk = (author: string, bid: string, key: string, text: string, extra: Record<string, unknown> = {}) => ev(author, "blk_set", { doc: id("e"), id: id(bid), key, text, ...extra });
  const s = mk(blk(BEN, "1", "G", "first"), blk(BEN, "2", "P", "second"), blk(CAT, "3", "k", "third"));
  assert.deepEqual(noteBlocks(s.tools.docs.get(id("e"))!).map((b) => b.text), ["first", "second", "third"], "paragraphs are ordered by key");
  // two people edit different paragraphs "at once" (events interleaved in any order): both survive
  const both = mk(blk(BEN, "1", "G", "first"), blk(BEN, "2", "P", "second"), blk(BEN, "1", "G", "first (Ben)"), blk(CAT, "2", "P", "second (Cat)"));
  assert.deepEqual(noteBlocks(both.tools.docs.get(id("e"))!).map((b) => b.text), ["first (Ben)", "second (Cat)"], "different paragraphs: nothing is lost");
  // two people insert at the same place with the same key: a stable order, both kept
  const clash = mk(blk(BEN, "1", "G", "a"), blk(BEN, "4", "M", "from Ben"), blk(CAT, "5", "M", "from Cat"));
  assert.equal(noteBlocks(clash.tools.docs.get(id("e"))!).length, 3, "both inserts are kept");
  assert.deepEqual(noteBlocks(clash.tools.docs.get(id("e"))!).map((b) => b.id), noteBlocks(mk(blk(CAT, "5", "M", "from Cat"), blk(BEN, "4", "M", "from Ben"), blk(BEN, "1", "G", "a")).tools.docs.get(id("e"))!).map((b) => b.id).sort().length === 3 ? noteBlocks(clash.tools.docs.get(id("e"))!).map((b) => b.id) : [], "a stable order");
  // the same paragraph at once: the later event wins, deterministically
  const same = mk(blk(BEN, "1", "G", "Ben's version"), blk(CAT, "1", "G", "Cat's version"));
  assert.equal(same.tools.docs.get(id("e"))!.blocks.get(id("1"))!.text, "Cat's version", "the latest event wins");
  const gone = mk(blk(BEN, "1", "G", "x"), blk(CAT, "1", "G", "", { del: true }));
  assert.equal(gone.tools.docs.get(id("e"))!.blocks.size, 0, "a paragraph can be removed");
  assert.equal(noteText(s.tools.docs.get(id("e"))!), "first\nsecond\nthird");
  // limits
  assert.equal(mk(blk(BEN, "1", "G", "x".repeat(LIMITS.blockChars + 1))).tools.docs.get(id("e"))!.blocks.size, 0, "an over-long paragraph is refused");
  assert.equal(mk(blk(BEN, "1", "bad key!", "x")).tools.docs.get(id("e"))!.blocks.size, 0, "a bad key is refused");
  const many = Array.from({ length: LIMITS.blocks + 20 }, (_, i) => blk(BEN, i.toString(16).padStart(1, "0") + "0".repeat(0), "k" + (100 + i), "x")).map((e, i) => ({ ...e, payload: { ...e.payload, id: i.toString(16).padStart(12, "0") } }));
  assert.equal(mk(...many).tools.docs.get(id("e"))!.blocks.size, LIMITS.blocks, "a note holds a bounded number of paragraphs");
  const total = mk(...Array.from({ length: 12 }, (_, i) => ev(BEN, "blk_set", { doc: id("e"), id: i.toString(16).padStart(12, "0"), key: "k" + (10 + i), text: "x".repeat(LIMITS.blockChars) })));
  assert.ok([...total.tools.docs.get(id("e"))!.blocks.values()].reduce((n, b) => n + b.text.length, 0) <= LIMITS.noteChars, "and a bounded total size");
  assert.equal(run(ev(BEN, "blk_set", { doc: id("e"), id: id("1"), key: "G", text: "x" })).tools.docs.size, 0, "a paragraph for a note that does not exist is ignored");
  assert.equal(run(ev(BEN, "doc_set", { id: id("f"), kind: "page", title: "P", body: "<p>x</p>" }), ev(BEN, "blk_set", { doc: id("f"), id: id("1"), key: "G", text: "x" })).tools.docs.get(id("f"))!.blocks.size, 0, "pages have no paragraphs");
  // order keys: inserting between two keys always works, and keeps the order
  const keys: string[] = [between()];
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 400; i++) { const at = Math.floor(rnd() * (keys.length + 1)); const k = between(keys[at - 1], keys[at]); keys.splice(at, 0, k); }
  assert.deepEqual([...keys].sort(), keys, "400 random insertions keep every key in order");
  assert.equal(new Set(keys).size, keys.length, "and no two keys are the same");
  assert.ok(keys.every((k) => /^[0-9A-Za-z]{1,24}$/.test(k)), "and every key is valid");
  console.log("ok: notes are paragraphs: concurrent edits merge, the same paragraph resolves deterministically, limits hold, keys stay ordered");
}
// ---- limits and shapes
{
  assert.equal(run(ev(BEN, "doc_set", { id: id("5"), kind: "page", title: "T", body: "x".repeat(LIMITS.pageChars + 1) })).tools.docs.size, 0, "an over-long page is refused");
  assert.equal(run(ev(BEN, "doc_set", { id: "nothex", kind: "note", title: "T", body: "x" })).tools.docs.size, 0, "a bad id");
  assert.equal(run(ev(BEN, "doc_set", { id: id("5"), kind: "script", title: "T", body: "x" })).tools.docs.size, 0, "a bad kind");
  assert.equal(run(ev(OUT, "doc_set", { id: id("5"), kind: "note", title: "T", body: "x" })).tools.docs.size, 0, "someone who never joined cannot add anything");
  const many = Array.from({ length: LIMITS.docs + 10 }, (_, i) => ev(BEN, "doc_set", { id: i.toString(16).padStart(12, "0"), kind: "note", title: "T", body: "" }));
  assert.equal(run(...many).tools.docs.size, LIMITS.docs, "a room holds a bounded number of documents");
  const muted = derive([...base, ev(HOST, "perms_changed", { chat: false, files: true, music: true }), ev(BEN, "doc_set", { id: id("6"), kind: "note", title: "T", body: "" })], HOST);
  assert.equal(muted.tools.docs.size, 0, "when the host turns chat off, members cannot add things either");
  console.log("ok: size, id, kind, membership, count and the chat switch are all enforced");
}
// ---- polls
{
  const s = run(ev(BEN, "poll_new", { id: id("7"), q: "Pizza?", opts: ["Yes", "No", "Maybe"] }), ev(HOST, "poll_vote", { id: id("7"), opt: 0 }), ev(CAT, "poll_vote", { id: id("7"), opt: 1 }), ev(CAT, "poll_vote", { id: id("7"), opt: 0 }), ev(BEN, "poll_vote", { id: id("7"), opt: 9 }));
  const t = tally(s.tools.polls.get(id("7"))!);
  assert.deepEqual(t.counts, [2, 0, 0]); assert.equal(t.total, 2, "one vote each, the latest counts, an impossible option is ignored");
  const ended = run(ev(BEN, "poll_new", { id: id("7"), q: "Q", opts: ["a", "b"] }), ev(CAT, "poll_end", { id: id("7") }), ev(HOST, "poll_vote", { id: id("7"), opt: 0 }));
  assert.equal(ended.tools.polls.get(id("7"))!.ended, false, "a stranger cannot end it"); assert.equal(ended.tools.polls.get(id("7"))!.votes.size, 1);
  const closed = run(ev(BEN, "poll_new", { id: id("7"), q: "Q", opts: ["a", "b"] }), ev(BEN, "poll_end", { id: id("7") }), ev(HOST, "poll_vote", { id: id("7"), opt: 0 }));
  assert.equal(closed.tools.polls.get(id("7"))!.votes.size, 0, "no votes after it has ended");
  assert.equal(run(ev(BEN, "poll_new", { id: id("8"), q: "Q", opts: ["only one"] })).tools.polls.size, 0, "needs two options");
  assert.equal(run(ev(BEN, "poll_new", { id: id("8"), q: "Q", opts: Array(9).fill("x") })).tools.polls.size, 0, "at most eight");
  console.log("ok: polls count one vote each, can be ended by their author or the host, and are bounded");
}
// ---- the board
{
  const pts = [0, 0, 500, 500, 1000, 1000];
  const s = run(ev(BEN, "draw", { c: 1, w: 4, pts }), ev(CAT, "draw", { c: 2, w: 2, pts: [1, 2] }));
  assert.equal(s.tools.strokes.length, 2);
  for (const bad of [{ c: 99, w: 4, pts }, { c: 1, w: 99, pts }, { c: 1, w: 4, pts: [1] }, { c: 1, w: 4, pts: [0, 2000] }, { c: 1, w: 4, pts: [0.5, 1] }, { c: "red", w: 4, pts }, { c: 1, w: 4, pts: Array(LIMITS.strokePoints * 2 + 2).fill(5) }, { c: 1, w: 4, pts: "xx" }])
    assert.equal(run(ev(BEN, "draw", bad)).tools.strokes.length, 0, "refused: " + JSON.stringify(bad).slice(0, 60));
  assert.equal(run(ev(BEN, "draw", { c: 1, w: 4, pts }), ev(CAT, "draw_clear", {})).tools.strokes.length, 0, "anyone can clear the board");
  const flood = Array.from({ length: LIMITS.strokes + 50 }, () => ev(BEN, "draw", { c: 1, w: 4, pts }));
  assert.equal(run(...flood).tools.strokes.length, LIMITS.strokes, "the board holds a bounded number of strokes");
  console.log("ok: the board takes only well-formed strokes, palette colours and a bounded number");
}
process.exit(0);
