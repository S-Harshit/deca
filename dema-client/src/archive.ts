import type { SpaceEvent } from "./log";
import { MAX_ARCHIVE_EVENTS } from "./log";
import { verifyEvent } from "./signing";

/**
 * Imported history. It is shown read-only above the live conversation and never mixed into the room's
 * log, so an old room's host, kicks, permissions or "closed" can never act on the new one. Only content
 * lines are kept; names come from the old room's join events.
 */
export type ArchiveFile = { fileId: string; name: string; type: string; size: number; sha256: string; present: boolean };
export type ArchiveData = {
  aid: string;
  from: string;
  exportedAt: string;
  exportedBy: string;
  names: Record<string, string>;
  events: SpaceEvent[];
  files: ArchiveFile[];
};

/** The only kinds of line an import brings across. */
export const IMPORTABLE = new Set(["chat", "file_offer", "coin", "rps", "blame", "horn"]);

export const sha256Hex = async (data: BufferSource) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((b) => b.toString(16).padStart(2, "0")).join("");

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** Is this one event a well-formed content line (the same shape rules the live log applies)? */
export function validContent(e: SpaceEvent): boolean {
  const p = e?.payload;
  if (!e || typeof e.id !== "string" || typeof e.author !== "string" || typeof e.ts !== "number" || !Number.isFinite(e.ts) || !p || typeof p !== "object") return false;
  switch (e.type) {
    case "chat":
      return typeof p.text === "string" && p.text.length <= 20000;
    case "file_offer":
      return typeof p.fileId === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(p.fileId) && typeof p.name === "string" && typeof p.size === "number" && p.size >= 0 && p.size <= 50 * 1024 * 1024;
    case "coin":
      return p.result === "heads" || p.result === "tails";
    case "rps":
      return p.throw === "rock" || p.throw === "paper" || p.throw === "scissors";
    case "blame":
      return typeof p.target === "string";
    case "horn":
      return true;
    default:
      return false;
  }
}

/**
 * Parse and fully check archive bytes. `expectedSha` is what the host's signed event committed to: if the
 * bytes do not hash to it, nothing in them is trusted. Every event must also carry a valid signature.
 */
export async function openArchive(bytes: Uint8Array, expectedSha: string): Promise<ArchiveData | null> {
  try {
    if ((await sha256Hex(bytes as BufferSource)) !== expectedSha) return null;
    const d = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ArchiveData>;
    if (!d || !Array.isArray(d.events) || d.events.length > MAX_ARCHIVE_EVENTS) return null;
    const events: SpaceEvent[] = [];
    const seen = new Set<string>();
    for (const e of d.events) {
      if (seen.has(e?.id) || !validContent(e) || !(await verifyEvent(e))) return null;
      seen.add(e.id);
      events.push(e);
    }
    const names: Record<string, string> = {};
    for (const [k, v] of Object.entries(d.names ?? {})) if (typeof v === "string") names[k.slice(0, 40)] = v.slice(0, 32);
    const files: ArchiveFile[] = (Array.isArray(d.files) ? d.files : []).slice(0, 500).map((f) => ({
      fileId: str(f?.fileId, 40),
      name: str(f?.name, 200),
      type: str(f?.type, 100),
      size: typeof f?.size === "number" ? f.size : 0,
      sha256: /^[a-f0-9]{64}$/.test(String(f?.sha256)) ? String(f.sha256) : "",
      present: !!f?.present,
    }));
    return {
      aid: str(d.aid, 12),
      from: str(d.from, 40),
      exportedAt: str(d.exportedAt, 40),
      exportedBy: str(d.exportedBy, 32),
      names,
      events: events.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1)),
      files,
    };
  } catch {
    return null;
  }
}
