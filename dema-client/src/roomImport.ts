import { IMPORTABLE, sha256Hex, validContent, type ArchiveData, type ArchiveFile } from "./archive";
import { MAX_ARCHIVE_BYTES, MAX_ARCHIVE_EVENTS, type SpaceEvent } from "./log";
import { verifyExport, type RoomExport } from "./roomExport";
import { openZip } from "./unzip";

export type ParsedImport = {
  archive: ArchiveData;
  json: Uint8Array;
  aid: string;
  sha256: string;
  /** Attachments that were in the zip and passed their hash check. */
  blobs: Map<string, Blob>;
  summary: { messages: number; people: number; files: number; filesMissing: number; skipped: number; from: string; exportedAt: string; exportedBy: string };
};

const MAX_JSON = 8 * 1024 * 1024;
const fail = (msg: string): never => {
  throw new Error(msg);
};

/** Read an export zip, refuse anything whose signatures do not all verify, and keep only content lines. */
export async function readExport(file: File): Promise<ParsedImport> {
  const zip = await openZip(file).catch((e: Error) => fail(`That is not a readable zip (${e.message}).`));
  const entry = zip.entries.get("room.json") ?? fail("This zip has no room.json, so it is not a Deca room export.");
  if (entry.size > MAX_JSON) fail("room.json is too large to import.");
  let data: RoomExport;
  try {
    data = JSON.parse(new TextDecoder().decode(await zip.read(entry)));
  } catch {
    return fail("room.json could not be read.");
  }
  const check = await verifyExport(data);
  if (!check.ok) fail(`This export failed verification: ${check.problems.join("; ")}. Nothing was imported.`);

  // Names: the old room's join events, then its member list. Both are self-asserted, so lines also show a short id.
  const names: Record<string, string> = {};
  for (const m of data.members ?? []) if (typeof m?.id === "string" && typeof m?.name === "string") names[m.id] = m.name.slice(0, 32);
  for (const e of data.events) if ((e.type === "joined" || e.type === "returned") && typeof e.payload?.name === "string") names[e.author] = e.payload.name.slice(0, 32);

  const kept: SpaceEvent[] = [];
  let skipped = 0;
  for (const e of data.events) {
    if (IMPORTABLE.has(e.type) && validContent(e)) kept.push(e);
    else if (!["joined", "returned", "left"].includes(e.type)) skipped++; // admin lines (kick, host, permissions, close) are not carried over
  }
  if (kept.length > MAX_ARCHIVE_EVENTS) fail(`This export has ${kept.length} lines; the limit is ${MAX_ARCHIVE_EVENTS}.`);

  // Attachments: only those the file_offer lines refer to, only when their bytes match the recorded hash.
  const offers = new Map(kept.filter((e) => e.type === "file_offer").map((e) => [String(e.payload.fileId), e]));
  const blobs = new Map<string, Blob>();
  const files: ArchiveFile[] = [];
  const listed = new Map((Array.isArray(data.files) ? data.files : []).map((f) => [f.fileId, f]));
  for (const [fileId, offer] of offers) {
    const meta = listed.get(fileId);
    const base = { fileId, name: String(offer.payload.name).slice(0, 200), type: String(offer.payload.type ?? "").slice(0, 100), size: Number(offer.payload.size) };
    const ze = meta && typeof meta.path === "string" ? zip.entries.get(meta.path) : undefined;
    let ok = false;
    if (meta && ze && /^[a-f0-9]{64}$/.test(String(meta.sha256))) {
      try {
        const bytes = await zip.read(ze);
        if (bytes.length === ze.size && (await sha256Hex(bytes as BufferSource)) === meta.sha256) {
          blobs.set(fileId, new Blob([bytes as BlobPart], { type: base.type }));
          files.push({ ...base, size: bytes.length, sha256: meta.sha256, present: true });
          ok = true;
        }
      } catch {
        // an unreadable attachment is simply left out
      }
    }
    if (!ok) files.push({ ...base, sha256: "", present: false });
  }

  const unsorted: ArchiveData = {
    aid: "",
    from: String(data.room?.id ?? "").slice(0, 40),
    exportedAt: String(data.exportedAt ?? "").slice(0, 40),
    exportedBy: String(data.exportedBy?.name ?? "").slice(0, 32),
    names,
    events: kept,
    files,
  };
  // The id is derived from the content, so importing the same export twice is recognisably the same thing.
  const body = new TextEncoder().encode(JSON.stringify(unsorted));
  const aid = (await sha256Hex(body as BufferSource)).slice(0, 12);
  const archive = { ...unsorted, aid };
  const json = new TextEncoder().encode(JSON.stringify(archive));
  if (json.length > MAX_ARCHIVE_BYTES) fail("This export is too large to import (over 8 MB of text).");
  const authors = new Set(kept.map((e) => e.author));
  return {
    archive,
    json,
    aid,
    sha256: await sha256Hex(json as BufferSource),
    blobs,
    summary: {
      messages: kept.filter((e) => e.type === "chat").length,
      people: authors.size,
      files: files.filter((f) => f.present).length,
      filesMissing: files.filter((f) => !f.present).length,
      skipped,
      from: archive.from,
      exportedAt: archive.exportedAt,
      exportedBy: archive.exportedBy,
    },
  };
}
