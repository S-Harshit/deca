import type { SpaceEvent } from "./log";
import { verifyEvent } from "./signing";
import { makeZip, type ZipEntry } from "./zip";

export const EXPORT_FORMAT = "deca-room-export";
export const EXPORT_VERSION = 1;
/** Files are held in memory while the archive is built, so stop somewhere sensible. */
export const EXPORT_FILE_CAP = 300 * 1024 * 1024;

export type ExportFile = { fileId: string; name: string; type: string; size: number; blob: Blob };
export type ExportInput = {
  spaceId: string;
  me: { id: string; name: string };
  hostId: string;
  closed: boolean;
  members: { peerId: string; name: string; firstJoin: number; online: boolean }[];
  /** Valid events only, in display order, exactly as received (so the signatures still verify). */
  events: SpaceEvent[];
  files: ExportFile[];
};

export type RoomExport = {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  exportedBy: { id: string; name: string };
  room: { id: string; hostId: string; closed: boolean; firstEvent: string | null; lastEvent: string | null };
  members: { id: string; name: string; firstJoin: string }[];
  events: SpaceEvent[];
  files: { fileId: string; name: string; type: string; size: number; sha256: string; path: string }[];
  note: string;
};

const NOTE =
  "Every event carries the author's public key and signature, so anyone can re-check who wrote what without trusting this file's source. " +
  "It holds only what the exporting person's device received, so anything nobody present ever sent them is absent.";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const iso = (ts: number) => new Date(ts).toISOString();

/** A file name that is safe as a path inside the archive. */
export function safeName(name: string, max = 80) {
  const clean = [...name]
    .map((c) => (c.charCodeAt(0) < 32 ? "_" : c))
    .join("")
    .replaceAll(/[\\/:*?"<>|]/g, "_")
    .replace(/^\.+/, "_")
    .trim();
  return (clean || "file").slice(0, max);
}

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function describe(e: SpaceEvent, name: (id: string) => string): { kind: "msg" | "sys"; who: string; text: string; fileId?: string } {
  const who = name(e.author);
  const p = e.payload;
  switch (e.type) {
    case "chat":
      return { kind: "msg", who, text: String(p.text ?? "") };
    case "file_offer":
      return { kind: "msg", who, text: `shared a file: ${String(p.name ?? "file")} (${size(Number(p.size ?? 0))})`, fileId: String(p.fileId) };
    case "joined":
      return { kind: "sys", who, text: `${who} joined` };
    case "returned":
      return { kind: "sys", who, text: `${who} came back` };
    case "left":
      return { kind: "sys", who, text: `${name(String(p.peerId))} left` };
    case "kick":
      return { kind: "sys", who, text: `${name(String(p.peerId))} was removed` };
    case "role_changed":
      return { kind: "sys", who, text: `${name(String(p.hostId))} is now host` };
    case "coin":
      return { kind: "sys", who, text: `${who} flipped a coin: ${String(p.result)}` };
    case "page_share":
      return { kind: "sys", who, text: `${who} opened a page for everyone: ${String(p.url).slice(0, 200)}` };
    case "archive_added":
      return { kind: "sys", who, text: `${who} added imported history (${String(p.events)} lines)` };
    case "blame":
      return { kind: "sys", who, text: `${who} blamed ${name(String(p.target))}` };
    case "rps":
      return { kind: "sys", who, text: `${who} threw ${String(p.throw)}` };
    case "horn":
      return { kind: "sys", who, text: `${who} sounded the air horn` };
    case "score":
      return { kind: "sys", who, text: `${who} scored ${Number(p.value)} in ${String(p.game).slice(0, 40)}` };
    case "perms_changed":
      return { kind: "sys", who, text: "permissions changed" };
    case "space_closed":
      return { kind: "sys", who, text: "the space was closed" };
    default:
      return { kind: "sys", who, text: e.type };
  }
}

/** A single self-contained page: no scripts, no network, readable offline. */
export function transcriptHtml(data: RoomExport, files: Map<string, string>): string {
  const names = new Map(data.members.map((m) => [m.id, m.name]));
  const name = (id: string) => names.get(id) ?? id;
  const rows = data.events
    .map((e) => {
      const d = describe(e, name);
      const t = esc(new Date(e.ts).toLocaleString());
      if (d.kind === "sys") return `<div class="sys">${esc(d.text)} <span class="t">${t}</span></div>`;
      const href = d.fileId ? files.get(d.fileId) : undefined;
      const body = href ? `${esc(d.text)} (<a href="${esc(href)}">included</a>)` : esc(d.text);
      return `<div class="msg"><b>${esc(d.who)}</b> <span class="t">${t}</span><div class="body">${body}</div></div>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Deca room ${esc(data.room.id)}</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.45}
body{max-width:46rem;margin:2rem auto;padding:0 1rem}
h1{font-size:1.2rem}.meta{color:#888;font-size:.85rem}
.msg{margin:.7rem 0}.body{white-space:pre-wrap;overflow-wrap:anywhere}
.sys{color:#888;font-size:.85rem;text-align:center;margin:.6rem 0}.t{color:#888;font-size:.75rem;font-weight:400}
</style></head><body>
<h1>Deca room ${esc(data.room.id)}</h1>
<p class="meta">Exported ${esc(new Date(data.exportedAt).toLocaleString())} by ${esc(data.exportedBy.name)}. ${data.events.length} events, ${data.members.length} people. The signed original is in room.json.</p>
${rows}
</body></html>`;
}

/** Bundle the room into a zip: room.json (signed, machine-readable), transcript.html, and any files. */
export async function buildExport(input: ExportInput, includeFiles: boolean): Promise<{ blob: Blob; filename: string; fileCount: number }> {
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [];
  const fileMeta: RoomExport["files"] = [];
  const hrefs = new Map<string, string>();
  if (includeFiles) {
    let total = 0;
    for (const f of input.files) {
      if (total + f.size > EXPORT_FILE_CAP) continue;
      total += f.size;
      const data = new Uint8Array(await f.blob.arrayBuffer());
      const path = `files/${safeName(f.fileId, 24)}-${safeName(f.name)}`;
      entries.push({ name: path, data });
      hrefs.set(f.fileId, path);
      fileMeta.push({ fileId: f.fileId, name: f.name, type: f.type, size: data.length, sha256: hex(await crypto.subtle.digest("SHA-256", data as BufferSource)), path });
    }
  }
  const events = input.events;
  const data: RoomExport = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: input.me,
    room: {
      id: input.spaceId,
      hostId: input.hostId,
      closed: input.closed,
      firstEvent: events.length ? iso(events[0].ts) : null,
      lastEvent: events.length ? iso(events[events.length - 1].ts) : null,
    },
    members: input.members.map((m) => ({ id: m.peerId, name: m.name, firstJoin: iso(m.firstJoin) })),
    events,
    files: fileMeta,
    note: NOTE,
  };
  entries.unshift(
    { name: "room.json", data: enc.encode(JSON.stringify(data, null, 2)) },
    { name: "transcript.html", data: enc.encode(transcriptHtml(data, hrefs)) },
  );
  const stamp = data.exportedAt.slice(0, 10);
  return { blob: makeZip(entries), filename: `deca-${safeName(input.spaceId, 24)}-${stamp}.zip`, fileCount: fileMeta.length };
}

/** Check an export's shape and every event's signature. This is also what an import will run first. */
export async function verifyExport(raw: unknown): Promise<{ ok: boolean; events: number; badSignatures: number; problems: string[] }> {
  const problems: string[] = [];
  const d = raw as Partial<RoomExport> | null;
  if (!d || typeof d !== "object" || d.format !== EXPORT_FORMAT) return { ok: false, events: 0, badSignatures: 0, problems: ["not a Deca room export"] };
  if (typeof d.version !== "number" || d.version > EXPORT_VERSION) problems.push(`unsupported version ${String(d.version)}`);
  if (!Array.isArray(d.events)) return { ok: false, events: 0, badSignatures: 0, problems: [...problems, "no events"] };
  let bad = 0;
  const seen = new Set<string>();
  for (const e of d.events) {
    if (!e || typeof e.id !== "string" || seen.has(e.id)) {
      problems.push("malformed or duplicate event");
      continue;
    }
    seen.add(e.id);
    if (!(await verifyEvent(e))) bad++;
  }
  if (bad) problems.push(`${bad} event(s) failed signature verification`);
  return { ok: problems.length === 0, events: d.events.length, badSignatures: bad, problems };
}
