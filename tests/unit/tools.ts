// Pages and notes, polls, the board and doors: ownership, limits and what a hostile member cannot do.
import assert from "node:assert";
import { derive, type SpaceEvent } from "../.build/log.ts";
import { LIMITS, portalUrl, tally } from "../.build/tools.ts";

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
  const note = run(ev(BEN, "doc_set", { id: id("2"), kind: "note", title: "Notes", body: "one" }), ev(CAT, "doc_set", { id: id("2"), kind: "note", title: "Notes", body: "one two" }));
  assert.equal(note.tools.docs.get(id("2"))!.body, "one two"); assert.equal(note.tools.docs.get(id("2"))!.editor, CAT); assert.equal(note.tools.docs.get(id("2"))!.owner, BEN, "anyone can edit a note");
  const kind = run(ev(BEN, "doc_set", { id: id("2"), kind: "note", title: "N", body: "x" }), ev(BEN, "doc_set", { id: id("2"), kind: "page", title: "N", body: "<b>x</b>" }));
  assert.equal(kind.tools.docs.get(id("2"))!.kind, "note", "the kind never changes");
  const del = run(ev(BEN, "doc_set", { id: id("3"), kind: "note", title: "N", body: "x" }), ev(CAT, "doc_del", { id: id("3") }));
  assert.ok(del.tools.docs.has(id("3")), "a stranger cannot delete");
  assert.ok(!run(ev(BEN, "doc_set", { id: id("3"), kind: "note", title: "N", body: "x" }), ev(BEN, "doc_del", { id: id("3") })).tools.docs.has(id("3")), "the author can");
  const feed = run(ev(BEN, "doc_set", { id: id("4"), kind: "note", title: "N", body: "x" }), ev(BEN, "doc_set", { id: id("4"), kind: "note", title: "N", body: "y" }));
  assert.equal(feed.visible.filter((e) => e.type === "doc_set").length, 1, "only the creation reaches the feed, not every edit");
  console.log("ok: pages are their author's, notes are everyone's, kinds never change, edits stay out of the feed");
}
// ---- limits and shapes
{
  assert.equal(run(ev(BEN, "doc_set", { id: id("5"), kind: "page", title: "T", body: "x".repeat(LIMITS.pageChars + 1) })).tools.docs.size, 0, "an over-long page is refused");
  assert.equal(run(ev(BEN, "doc_set", { id: id("5"), kind: "note", title: "T", body: "x".repeat(LIMITS.noteChars + 1) })).tools.docs.size, 0);
  assert.equal(run(ev(BEN, "doc_set", { id: "nothex", kind: "note", title: "T", body: "x" })).tools.docs.size, 0, "a bad id");
  assert.equal(run(ev(BEN, "doc_set", { id: id("5"), kind: "script", title: "T", body: "x" })).tools.docs.size, 0, "a bad kind");
  assert.equal(run(ev(OUT, "doc_set", { id: id("5"), kind: "note", title: "T", body: "x" })).tools.docs.size, 0, "someone who never joined cannot add anything");
  const many = Array.from({ length: LIMITS.docs + 10 }, (_, i) => ev(BEN, "doc_set", { id: i.toString(16).padStart(12, "0"), kind: "note", title: "T", body: "x" }));
  assert.equal(run(...many).tools.docs.size, LIMITS.docs, "a room holds a bounded number of documents");
  const muted = derive([...base, ev(HOST, "perms_changed", { chat: false, files: true, music: true }), ev(BEN, "doc_set", { id: id("6"), kind: "note", title: "T", body: "x" })], HOST);
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
// ---- doors
{
  assert.equal(portalUrl("https://deca.example/#/s/abcdef123456"), "https://deca.example/#/s/abcdef123456");
  assert.ok(portalUrl("https://deca.example/#/m/room/seed/host/Ann"));
  for (const bad of ["javascript:alert(1)", "https://deca.example/", "https://deca.example/#/x/abc", "https://user:pw@deca.example/#/s/abcdef", "ftp://x/#/s/abcdef123", "not a url", 5, null, "https://deca.example/#/s/ab"])
    assert.equal(portalUrl(bad as never), null, "refused: " + String(bad));
  const s = run(ev(BEN, "portal_add", { id: id("9"), url: "https://deca.example/#/s/abcdef123456", label: "The other room" }), ev(CAT, "portal_del", { id: id("9") }));
  assert.equal(s.tools.portals.size, 1, "a stranger cannot remove a door");
  assert.equal(run(ev(BEN, "portal_add", { id: id("9"), url: "javascript:alert(1)", label: "x" })).tools.portals.size, 0);
  assert.equal(run(ev(BEN, "portal_add", { id: id("9"), url: "https://deca.example/#/s/abcdef123456", label: "x" }), ev(BEN, "portal_del", { id: id("9") })).tools.portals.size, 0, "the author can");
  console.log("ok: doors only point at Deca rooms, and only their author or the host removes them");
}
process.exit(0);
