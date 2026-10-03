import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { leaderboards } from "../scores";
import type { Snapshot } from "../space";
import type { Game } from "./GamesPanel";

/** The room's leaderboard (hidden: /scores). Best score per person for each game played in this room. */
export function ScoresDialog({ snap, games, onClose }: Readonly<{ snap: Snapshot; games: Game[]; onClose: () => void }>) {
  const boards = leaderboards(snap.state.visible);
  const ids = [...boards.keys()];
  const [pick, setPick] = useState("");
  const game = ids.includes(pick) ? pick : (ids[0] ?? "");
  const title = (id: string) => games.find((g) => g.id === id)?.title ?? id;
  const name = (id: string) => (id === snap.me ? "You" : (snap.state.members.get(id)?.name ?? "someone"));

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const rows = boards.get(game) ?? [];
  return createPortal(
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal scores-modal" role="dialog" aria-modal="true" aria-labelledby="scores-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="scores-title">Leaderboard</h2>
        {ids.length === 0 ? (
          <p className="muted">No scores yet. Open the games panel and play: a finished game adds your score here for everyone in the room.</p>
        ) : (
          <>
            {ids.length === 1 && <h3>{title(game)}</h3>}
            {ids.length > 1 && (
              <select aria-label="Choose a game" value={game} onChange={(e) => setPick(e.target.value)}>
                {ids.map((id) => (
                  <option key={id} value={id}>
                    {title(id)}
                  </option>
                ))}
              </select>
            )}
            <ol className="scores">
              {rows.map((r, i) => (
                <li key={r.author} className={r.author === snap.me ? "me" : ""}>
                  <span className="rank">{i + 1}</span>
                  <span className="who">{name(r.author)}</span>
                  <span className="best">{r.best.toLocaleString()}</span>
                  <span className="muted small plays">
                    {r.plays} {r.plays === 1 ? "play" : "plays"}
                  </span>
                </li>
              ))}
            </ol>
            <p className="muted small">Best score per person in this room. Scores come from each person's own device, so this is for fun, not proof.</p>
          </>
        )}
        <div className="actions">
          <button autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
