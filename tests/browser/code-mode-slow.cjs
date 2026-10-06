const { chromium } = require("../lib/browser.cjs");
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
const URL = "http://localhost:8080/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(label, args, humanDelay, expectConnect, sabotage = false) {
  console.log(`\n=== ${label}`);
  const b = await chromium.launch({ args });
  const mk = async (link) => { const p = await (await b.newContext({ viewport: { width: 1300, height: 850 } })).newPage(); await p.addInitScript(() => { window.__bad = []; window.__t0 = performance.now(); new MutationObserver(() => { if (/can't connect directly/.test(document.body?.innerText || "")) window.__bad.push(Math.round(performance.now() - window.__t0)); }).observe(document, { childList: true, subtree: true, characterData: true }); }); await p.goto(link || URL); return p; };
  const dialog = (p) => p.getByRole("dialog", { name: "Connect by code" });
  const A = await mk(); await A.locator("input").first().fill("Ann"); await A.getByRole("button", { name: "No server? Connect by code" }).click(); await A.getByRole("button", { name: "Create a space (no server)" }).click(); await A.locator(".composer textarea").waitFor();
  const B = await mk(`${URL}${await A.evaluate(() => location.hash)}`); if (sabotage) await B.addInitScript(() => { const o = RTCPeerConnection.prototype.setRemoteDescription; RTCPeerConnection.prototype.setRemoteDescription = function (d) { if (d?.sdp) d = { type: d.type, sdp: d.sdp.replace(/a=ice-pwd:.+/g, "a=ice-pwd:" + "x".repeat(24)) }; return o.call(this, d); }; }); if (sabotage) await B.reload(); await B.locator("input").first().fill("Bob"); const tJoin = Date.now(); await B.getByRole("button", { name: "Join space (no server)" }).click();
  await dialog(B).waitFor({ timeout: 15000 });
  const codeB = await dialog(B).locator("textarea[readonly]").inputValue(); const ready = Date.now() - tJoin;
  ok(`Bob's code is ready quickly (${ready} ms)`, ready < 4000, ready);
  // ---- one task at a time
  ok("with a code to send, the paste box is NOT shown", !(await dialog(B).getByLabel("Paste a code").isVisible()));
  ok("the code and a Copy button are", (await dialog(B).locator("textarea[readonly]").isVisible()) && (await dialog(B).getByRole("button", { name: "Copy code" }).isVisible()));
  await dialog(B).getByRole("button", { name: "I have sent it: next" }).click();
  ok("after 'I have sent it: next' the code is hidden and the paste box asks for Ann's reply", !(await dialog(B).locator("textarea[readonly]").isVisible()) && /paste Ann's reply code/.test(await dialog(B).innerText()));
  await dialog(B).getByRole("button", { name: "Show my code again" }).click();
  ok("'Show my code again' brings the code back, paste box hidden", (await dialog(B).locator("textarea[readonly]").inputValue()) === codeB && !(await dialog(B).getByLabel("Paste a code").isVisible()));
  await sleep(4000); ok("the code does not change while someone is copying it", (await dialog(B).locator("textarea[readonly]").inputValue()) === codeB);
  console.log(`   ...a person now carries the code for ${humanDelay / 1000} s`); await sleep(humanDelay);
  // ---- Ann pastes
  await A.getByRole("button", { name: "Paste their code" }).click(); await dialog(A).getByLabel("Paste a code").fill(codeB); await dialog(A).getByRole("button", { name: "Connect" }).click(); { const y = dialog(A).getByRole("button", { name: "Let them in" }); try { await y.waitFor({ timeout: 2000 }); await y.click(); } catch {} }
  await dialog(A).locator("textarea[readonly]").waitFor({ timeout: 10000 });
  ok("Ann sees only the reply code to send back, no paste box", !(await dialog(A).getByLabel("Paste a code").isVisible()) && /Last step: send this reply back to Bob/.test(await dialog(A).innerText()));
  ok("...and no 'I have sent it' button (nothing more to paste)", (await dialog(A).getByRole("button", { name: "I have sent it: next" }).count()) === 0);
  const reply = await dialog(A).locator("textarea[readonly]").inputValue();
  console.log(`   ...and carries the reply back for ${humanDelay / 1000} s`); await sleep(humanDelay);
  // ---- Bob pastes the reply
  let toPaste = reply;
  await dialog(B).getByRole("button", { name: "I have sent it: next" }).click(); await dialog(B).getByLabel("Paste a code").fill(toPaste);
  await B.evaluate(() => { window.__bad = []; window.__t0 = performance.now(); }); const tPaste = Date.now();
  await dialog(B).getByRole("button", { name: "Connect" }).click();
  if (expectConnect) {
    await B.waitForFunction(() => (document.querySelector(".members")?.closest("section")?.querySelector("h3")?.innerText || "").includes("2 / "), null, { timeout: 30000 });
    ok(`connected ${((Date.now() - tPaste) / 1000).toFixed(1)} s after the last paste`, true);
    const bad = await B.evaluate(() => window.__bad); ok(`it NEVER said "can't connect directly" while connecting (even after ${humanDelay / 1000 * 2} s of human delay)`, bad.length === 0, JSON.stringify(bad));
  } else {
    await B.waitForFunction(() => /can't connect directly/.test(document.body.innerText), null, { timeout: 90000 }).catch(() => {});
    const msg = await B.locator(".members").innerText();
    ok("when the network really fails it says so (Ann stays listed, she did not 'leave')", /Ann/.test(msg) && /can't connect directly: see Connect by code/.test(msg), msg.replace(/\s+/g, " ").slice(0, 200));
    ok("...with a Reconnect button", (await B.locator(".members").getByRole("button", { name: "Reconnect" }).count()) >= 1);
    await sleep(25000); ok("...and still there 25 s later (a link that never worked is not someone who left)", /Ann/.test(await B.locator(".members").innerText()) && (await B.locator(".members").getByRole("button", { name: "Reconnect" }).count()) >= 1);
    await B.getByRole("button", { name: /Connect by code/ }).first().click(); await dialog(B).waitFor();
    ok("...and the help is in the dialog under Not connecting?", (await dialog(B).locator("summary", { hasText: "Not connecting?" }).count()) === 1);
    await dialog(B).locator("summary").click(); ok("it lists the likely causes (VPN, same computer, Reconnect)", /VPN/.test(await dialog(B).innerText()) && /same computer/.test(await dialog(B).innerText()));
  }
  await b.close();
}
(async () => {
  await run("a slow human: 30 s to carry each code (this is what failed for you: the label used the code's age)", [], 30000, true);
  await run("a network that really cannot connect (forced: browsers may not use UDP, so no path exists)", [], 1000, false, true);
  console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.log("ERR", e.message.split("\n").slice(0, 10).join("\n")); process.exit(1); });
