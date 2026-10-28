// Which pasted YouTube links are a playlist, an automatic mix, a personal list or a plain video.
import assert from "node:assert";
import { isPersonalList, parseMixSeed, parsePlaylistId } from "../.build/yt.ts";

const PL = "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI";
assert.equal(parsePlaylistId(`https://www.youtube.com/playlist?list=${PL}`), PL, "a playlist link");
assert.equal(parsePlaylistId(`youtube.com/playlist?list=${PL}`), PL, "without https");
assert.equal(parsePlaylistId(`https://music.youtube.com/playlist?list=OLAK5uy_kAbCdEfGhIjKlMnOpQrStUvWxYz`), "OLAK5uy_kAbCdEfGhIjKlMnOpQrStUvWxYz", "a YouTube Music album list");
assert.equal(parsePlaylistId(`https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${PL}`), null, "a video inside a playlist plays that one video");
assert.equal(parsePlaylistId("https://youtu.be/dQw4w9WgXcQ?list=" + PL), null, "also a short link");
assert.equal(parsePlaylistId("https://example.com/playlist?list=" + PL), null, "only YouTube");
assert.equal(parsePlaylistId("https://www.youtube.com/playlist?list=short"), null, "a too-short id");
assert.equal(parsePlaylistId("not a link"), null);
assert.equal(parseMixSeed("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&start_radio=1"), "dQw4w9WgXcQ", "an automatic mix started from a song");
assert.equal(parseMixSeed("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVMdQw4w9WgXcQ"), "dQw4w9WgXcQ", "a YouTube Music mix");
assert.equal(parseMixSeed(`https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${PL}`), null, "an ordinary playlist is not a mix");
assert.equal(parseMixSeed("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), null, "a plain video");
assert.equal(parseMixSeed("https://evil.example/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ"), null, "only YouTube");
for (const l of ["RDMMdQw4w9WgXcQ", "RDEMdQw4w9WgXcQ", "LM", "WL"]) assert.ok(isPersonalList(l), `${l} belongs to a signed-in account`);
for (const l of ["RDdQw4w9WgXcQ", "RDAMVMdQw4w9WgXcQ", PL]) assert.ok(!isPersonalList(l), `${l} can be opened by anyone`);
console.log("ok: playlists, automatic mixes, personal lists and plain videos are told apart");
process.exit(0);
