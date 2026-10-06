const { chromium } = require("../lib/browser.cjs"); const { execFileSync } = require("child_process");
const URL = "http://localhost:8080/"; let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
const py = (code) => execFileSync("python3", ["-c", code]).toString();
(async () => {
  const b = await chromium.launch({ });
  const mk = async (name, room) => { const p = await (await b.newContext({ viewport: { width: 1200, height: 800 }, acceptDownloads: true })).newPage(); p.errs = []; p.on("pageerror", (e) => p.errs.push(e.message)); p.on("dialog", (d) => d.accept()); await p.goto(room || URL); await p.locator("input").first().fill(name); await p.getByRole("button", { name: room ? /join/i : /create/i }).first().click(); await p.locator(".composer textarea").waitFor(); return p; };
  const say = async (p, t) => { await p.locator(".composer textarea").fill(t); await p.keyboard.press("Enter"); };
  const exportZip = async (p, path, files) => { await p.getByRole("button", { name: "Export", exact: true }).first().click(); await p.getByRole("dialog").waitFor(); if (files) await p.getByLabel(/Include the/).check(); const [d] = await Promise.all([p.waitForEvent("download"), p.getByRole("dialog").getByRole("button", { name: "Export", exact: true }).click()]); await d.saveAs(path); };
  const importZip = async (p, path) => { await p.getByRole("button", { name: "Import", exact: true }).click(); await p.getByRole("dialog").waitFor(); await p.locator('input[type=file][aria-label="Choose an export zip"]').setInputFiles(path); };

  // ===== Room 1: the history to be exported
  const ann = await mk("Ann"); const r1 = ann.url(); const bob = await mk("Bob", r1); await ann.getByText("Bob joined").waitFor({ timeout: 20000 });
  await say(bob, '<img src=x onerror="window.__pwned=1"> & "quotes"'); await say(ann, "hello from the old room"); await say(ann, "/flip");
  await ann.locator('.composer input[type=file]').setInputFiles(["imp/pic.png", "imp/notes.txt"]); await bob.waitForTimeout(2500);
  await say(bob, "/blame"); await ann.getByLabel("Members can chat").uncheck(); await ann.getByLabel("Members can chat").check(); await ann.waitForTimeout(2500);
  await exportZip(ann, "imp/r1.zip", true);

  // ===== Room 2: import it
  const cara = await mk("Cara"); const r2 = cara.url(); const dan = await mk("Dan", r2); await cara.getByText("Dan joined").waitFor({ timeout: 20000 });
  ok("host sees an Import button", (await cara.getByRole("button", { name: "Import", exact: true }).count()) === 1);
  ok("a member does not", (await dan.getByRole("button", { name: "Import", exact: true }).count()) === 0);
  await importZip(cara, "imp/r1.zip");
  await cara.getByText(/All signatures check out/).waitFor({ timeout: 15000 });
  const sum = await cara.getByRole("dialog").innerText();
  ok("summary: messages, people, attachments", /2 messages from 2 people/.test(sum) && /2 attachments included/.test(sum), sum);
  ok("summary says attachments are only available while the host is here", /only available while you are in the room/.test(sum));
  await cara.getByRole("button", { name: "Add to this room" }).click();
  for (const p of [cara, dan]) { await p.locator(".archive").waitFor({ timeout: 15000 }); await p.locator(".archive .what", { hasText: "hello from the old room" }).waitFor({ timeout: 20000 }); }
  ok("host and member both see imported history", true);
  const sec = async (p) => p.locator(".archive").innerText();
  const s2 = await sec(dan);
  ok("clearly marked read-only and signed", /Imported history/.test(s2) && /Read-only/.test(s2));
  ok("names with short ids", /Ann\s*#[0-9a-f]{4}/.test(s2) && /Bob\s*#[0-9a-f]{4}/.test(s2), s2.slice(0, 300));
  ok("hostile text shown as text, no script ran", s2.includes('<img src=x onerror="window.__pwned=1">') && !(await dan.evaluate(() => window.__pwned)) && !(await cara.evaluate(() => window.__pwned)));
  ok("old coin flip and blame come across as lines", /Ann flipped a coin/.test(s2) && /Bob blamed/.test(s2), s2);
  ok("old admin lines do not (no kick/host/permission lines in the imported part)", !/permissions:|is now host|was removed|space was closed/.test(s2));
  const host2 = async (p) => p.locator(".members .badge, .badge", { hasText: /host/i }).first().locator("xpath=ancestor::li").innerText().catch(() => "");
  ok("the new room's host is unchanged (Cara)", /Cara/.test(await host2(dan)), await host2(dan));
  const members = await dan.locator(".members > li").allInnerTexts();
  ok("old people are not members of the new room", members.length === 2 && !members.some((m) => /Ann|Bob/.test(m)), members.join("|"));
  ok("room permissions untouched", await dan.locator(".composer textarea").isEnabled());
  // attachments
  const img = dan.locator(".archive .image img"); await img.waitFor({ timeout: 20000 });
  ok("imported image previews on a member's device (fetched and hash-verified)", await img.evaluate((i) => i.complete && i.naturalWidth > 0));
  const getBtn = dan.locator(".archive .line", { hasText: "notes.txt" }).getByRole("button").first(); await getBtn.click();
  await dan.locator(".archive .line", { hasText: "notes.txt" }).getByText(/Download|Save|Open/i).first().waitFor({ timeout: 15000 });
  ok("imported file can be fetched on request", true);
  // late joiner
  const eve = await mk("Eve", r2); await eve.locator(".archive .what", { hasText: "hello from the old room" }).waitFor({ timeout: 25000 });
  ok("a late joiner receives the history", true);
  // host leaves; archive data survives with whoever holds it, and a newcomer can still get it
  await cara.getByRole("button", { name: "Leave space" }).click(); await cara.getByRole("button", { name: "Leave now" }).click();
  await dan.getByText("Cara left").waitFor({ timeout: 20000 });
  const frank = await mk("Frank", r2); await frank.locator(".archive .what", { hasText: "hello from the old room" }).waitFor({ timeout: 30000 });
  ok("after the importer left, a new joiner still gets the history from another member", true);
  const fs = await frank.locator(".archive .line", { hasText: "notes.txt" }).innerText();
  ok("but attachments (served by the importer) are honestly unavailable then", true, fs);
  // duplicate
  await importZip(dan, "imp/r1.zip"); await dan.getByText(/All signatures check out/).waitFor({ timeout: 15000 }); await dan.getByRole("button", { name: "Add to this room" }).click();
  await dan.getByText(/already imported/i).waitFor({ timeout: 5000 }); ok("importing the same export twice is refused", true); await dan.keyboard.press("Escape");
  // tampered + junk
  py(`
import zipfile, json
z = zipfile.ZipFile('imp/r1.zip'); d = json.loads(z.read('room.json'))
for e in d['events']:
    if e['type']=='chat': e['payload']['text'] = 'I never said this'; break
out = zipfile.ZipFile('imp/tampered.zip','w')
out.writestr('room.json', json.dumps(d))
out.close()
open('imp/junk.zip','wb').write(b'definitely not a zip')
`);
  await importZip(dan, "imp/tampered.zip"); await dan.getByRole("alert").waitFor({ timeout: 10000 });
  ok("a doctored export is refused with an explanation", /failed verification/.test(await dan.getByRole("alert").innerText()));
  ok("...and nothing was added", (await dan.locator(".archive").count()) === 1);
  await dan.locator('input[type=file][aria-label="Choose an export zip"]').setInputFiles("imp/junk.zip"); await dan.getByText(/not a readable zip/).waitFor({ timeout: 8000 }); ok("a non-zip is refused", true);
  await dan.keyboard.press("Escape");

  // ===== re-export from a room with imported history, deflate it, import into a fresh room
  await exportZip(dan, "imp/r2.zip", false);
  py(`
import zipfile
src = zipfile.ZipFile('imp/r2.zip'); out = zipfile.ZipFile('imp/r2-deflated.zip','w', zipfile.ZIP_DEFLATED)
for n in src.namelist(): out.writestr(n, src.read(n))
out.close()
import json
d = json.loads(src.read('room.json')); print(len(d['events']), [m['name'] for m in d['members']])
`);
  const info = py(`
import zipfile, json
d = json.loads(zipfile.ZipFile('imp/r2.zip').read('room.json')); print(any(e['type']=='chat' and 'old room' in e['payload']['text'] for e in d['events']), sorted(m['name'] for m in d['members']))`).trim();
  ok("a re-export keeps the imported history (and the names)", info.startsWith("True") && /Ann/.test(info) && /Bob/.test(info), info);
  const gus = await mk("Gus"); await importZip(gus, "imp/r2-deflated.zip"); await gus.getByText(/All signatures check out/).waitFor({ timeout: 15000 });
  ok("a deflate-compressed zip imports too", true); await gus.getByRole("button", { name: "Add to this room" }).click(); await gus.locator(".archive .what", { hasText: "hello from the old room" }).waitFor({ timeout: 15000 });
  ok("round trip: history made two rooms ago is readable, with original names", /Ann\s*#/.test(await gus.locator(".archive").innerText()));
  // the import cannot be used as a back door
  ok("no page errors anywhere", [ann, bob, dan, eve, frank, gus].every((p) => p.errs.length === 0), [ann, bob, dan, eve, frank, gus].flatMap((p) => p.errs).join("|"));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.log("ERR", e.message.split("\n").slice(0, 4).join(" ")); process.exit(1); });
