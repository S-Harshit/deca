// The room's leaderboard, worked out from the signed "score" events. Nothing is stored separately: it is whatever the log holds,
// so it lives and ends with the room (and an export carries the lines). Scores are reported by each person's own device.
import type { SpaceEvent } from "./log";

export type ScoreRow = { author: string; best: number; plays: number };

/** Best score per person for every game, highest first; ties go to whoever got there first. */
export function leaderboards(events: SpaceEvent[]): Map<string, ScoreRow[]> {
  const byGame = new Map<string, Map<string, ScoreRow & { at: number }>>();
  for (const e of events) {
    if (e.type !== "score") continue;
    const game = String(e.payload.game);
    const value = Number(e.payload.value);
    const rows = byGame.get(game) ?? new Map();
    byGame.set(game, rows);
    const row = rows.get(e.author);
    if (!row) rows.set(e.author, { author: e.author, best: value, plays: 1, at: e.ts });
    else {
      row.plays++;
      if (value > row.best) {
        row.best = value;
        row.at = e.ts;
      }
    }
  }
  const out = new Map<string, ScoreRow[]>();
  for (const [game, rows] of byGame) out.set(game, [...rows.values()].sort((a, b) => b.best - a.best || a.at - b.at).map(({ author, best, plays }) => ({ author, best, plays })));
  return out;
}
