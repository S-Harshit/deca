import assert from "node:assert";
import { safeWebUrl } from "../.build/message.ts";
import { derive, type SpaceEvent } from "../.build/log.ts";
// addresses
assert.equal(safeWebUrl("https://www.amazon.com/dp/B000?x=1"), "https://www.amazon.com/dp/B000?x=1");
assert.equal(safeWebUrl("http://example.com"), "http://example.com/");
for (const bad of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "ftp://x.test/f", "mailto:a@b.c", "vbscript:x", "blob:https://x/abc", "//evil.test", "not a url", "", "https://", "https://amazon.com@evil.example/login", "https://user:pw@example.com/", "http://a.b@c.d", 42, null, undefined, {}, "https://" + "a".repeat(2100) + ".com"]) assert.equal(safeWebUrl(bad as never), null, JSON.stringify(bad)?.slice(0, 50));
assert.equal(safeWebUrl("  https://example.com/a  "), "https://example.com/a", "surrounding spaces are fine");
assert.equal(new URL(safeWebUrl("https://аmazon.com/")!).hostname.startsWith("xn--"), true, "a look-alike (Cyrillic a) comes out as punycode, which the UI flags");
console.log("ok: only plain http(s) addresses, no disguised logins, no scripts, bounded length");
// events
const ev = (id: string, author: string, ts: number, type: any, payload: any = {}): SpaceEvent => ({ id, author, ts, type, payload });
const base = [ev("j1", "H", 1, "joined", { name: "Host" }), ev("j2", "M", 2, "joined", { name: "Mem" })];
const shares = (evs: SpaceEvent[]) => derive(evs, "H").visible.filter((e) => e.type === "page_share").map((e) => e.id);
assert.deepEqual(shares([...base, ev("s1", "M", 3, "page_share", { url: "https://www.amazon.com/dp/B000" })]), ["s1"], "a member can share a page");
assert.deepEqual(shares([...base, ev("s1", "H", 3, "page_share", { url: "https://example.com/" })]), ["s1"], "the host can");
for (const bad of ["javascript:alert(1)", "https://amazon.com@evil.example/", "data:text/html,x", 5, undefined]) assert.deepEqual(shares([...base, ev("s1", "M", 3, "page_share", { url: bad })]), [], "forged: " + String(bad));
assert.deepEqual(shares([...base, ev("s1", "M", 3, "page_share", {})]), [], "no url");
const off = ev("p", "H", 2.5, "perms_changed", { chat: false, files: true, music: true });
assert.deepEqual(shares([...base, off, ev("s1", "M", 3, "page_share", { url: "https://example.com/" })]), [], "members cannot share when chat is off");
assert.deepEqual(shares([...base, off, ev("s1", "H", 3, "page_share", { url: "https://example.com/" })]), ["s1"], "the host still can");
assert.deepEqual(shares([...base, ev("k", "H", 2.5, "kick", { peerId: "M" }), ev("s1", "M", 3, "page_share", { url: "https://example.com/" })]), [], "kicked members cannot");
// sharing changes nothing else about the room
const s = derive([...base, ev("s1", "M", 3, "page_share", { url: "https://example.com/" })], "H");
assert.equal(s.hostId, "H"); assert.equal(s.closed, false); assert.equal(s.members.size, 2); assert.deepEqual(s.perms, { chat: true, files: true, music: true });
console.log("ok: page_share follows the chat permission, rejects every forged address, and cannot touch host, members or permissions");
