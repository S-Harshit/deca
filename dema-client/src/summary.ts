// What a room did, for the end screen (only when the host switched the summary on). Worked out from this device's copy of the log,
// plus two things the log does not hold (tracks played and screens shared, which are seen live), so it is "as seen here".
import { isBlankMessage } from "./message";
import { leaderboards } from "./scores";
import type { SpaceState } from "./log";

export type Highlights = { tracks: string[]; screens: { peerId: string; count: number }[] };

export type RoomSummary = {
  minutes: number;
  people: string[];
  messages: number;
  files: string[];
  links: string[];
  games: { game: string; plays: number; top: { name: string; best: number }[] }[];
  horn: { count: number; by: string[] };
  tracks: string[];
  screens: { name: string; count: number }[];
};

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export function buildSummary(state: SpaceState, me: string, highlights: Highlights, now = Date.now()): RoomSummary {
  const name = (id: string) => (id === me ? "You" : (state.members.get(id)?.name ?? "someone"));
  const ev = state.visible;
  const first = ev.reduce((m, e) => Math.min(m, e.ts), now);
  const files = ev.filter((e) => e.type === "file_offer").map((e) => String(e.payload.name ?? "file").slice(0, 80));
  const links = [...new Set(ev.filter((e) => e.type === "page_share").map((e) => host(String(e.payload.url))).filter(Boolean))];
  const boards = leaderboards(ev);
  const plays = new Map<string, number>();
  for (const e of ev) if (e.type === "score") plays.set(String(e.payload.game), (plays.get(String(e.payload.game)) ?? 0) + 1);
  const horns = ev.filter((e) => e.type === "horn");
  const hornBy = new Map<string, number>();
  for (const e of horns) hornBy.set(e.author, (hornBy.get(e.author) ?? 0) + 1);
  return {
    minutes: Math.max(1, Math.round((now - first) / 60000)),
    people: [...state.members.values()].map((m) => (m.peerId === me ? "You" : m.name)),
    messages: ev.filter((e) => e.type === "chat" && !isBlankMessage(String(e.payload.text ?? ""))).length,
    files: files.slice(0, 10),
    links: links.slice(0, 10),
    games: [...boards].map(([game, rows]) => ({ game, plays: plays.get(game) ?? 0, top: rows.slice(0, 3).map((r) => ({ name: name(r.author), best: r.best })) })),
    horn: { count: horns.length, by: [...hornBy].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => `${name(id)} ×${n}`) },
    tracks: highlights.tracks.slice(0, 12),
    screens: highlights.screens.map((s) => ({ name: name(s.peerId), count: s.count })),
  };
}
