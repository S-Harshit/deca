import { useRef, useState } from "react";
import { Icon } from "./Icons";

export type Game = { id: string; title: string; heavy?: boolean; note?: string; controls?: string[] };

/**
 * EXPERIMENTAL. Plays any static web game from dema-server/games/<id>/ in a frame under the video.
 * Everyone who opens it plays their own copy; nothing about the game is shared or synced.
 * Games run on this site's origin, so only add games you trust.
 */
export function GamesPanel({ games, onClose }: Readonly<{ games: Game[]; onClose: () => void }>) {
  // Never open on a heavy game: start with the first light one (or the first game if all are heavy).
  const [id, setId] = useState((games.find((g) => !g.heavy) ?? games[0]).id);
  const [started, setStarted] = useState<string[]>([]); // heavy games the user chose to start
  const [showKeys, setShowKeys] = useState(false);
  const [nonce, setNonce] = useState(0); // bumping it reloads the frame
  const frame = useRef<HTMLIFrameElement>(null);
  const game = games.find((g) => g.id === id) ?? games[0];

  const waiting = !!game.heavy && !started.includes(game.id);
  const controls = game.controls ?? [];

  const onLoad = () => {
    const el = frame.current;
    try {
      // Esc hands the keyboard back to the chat box, so a game can never trap you.
      el?.contentWindow?.addEventListener("keydown", (e) => {
        if (e.key === "Escape") (document.querySelector(".composer textarea") as HTMLElement | null)?.focus();
      });
    } catch {
      // a game on another origin can't be reached; Esc just won't work inside it
    }
    el?.focus();
  };

  return (
    <section className="game-panel" aria-label={`Game: ${game.title}`}>
      <div className="game-bar">
        <strong>{game.title}</strong>
        {games.length > 1 && (
          <select aria-label="Choose a game" value={game.id} onChange={(e) => setId(e.target.value)}>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        )}
        <span className="muted small hint">{waiting ? "Heavy game: starts when you press Start" : "Click the game to play · Esc returns to chat"}</span>
        <span className="row push-right">
          {controls.length > 0 && (
            <button className={`icon-btn small ${showKeys ? "live" : ""}`} aria-label="Show controls" aria-pressed={showKeys} title="Controls" onClick={() => setShowKeys((v) => !v)}>
              <Icon name="keyboard" size={14} />
            </button>
          )}
          <button className="icon-btn small" aria-label="Restart game" title="Reload" onClick={() => setNonce((n) => n + 1)}>
            <Icon name="rotate" size={14} />
          </button>
          <button className="icon-btn small" aria-label="Game full screen" title="Full screen" onClick={() => void frame.current?.requestFullscreen?.()}>
            <Icon name="maximize" size={14} />
          </button>
          <button className="icon-btn small" aria-label="Close game" title="Close (stops the game and its sound)" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </span>
      </div>
      {showKeys && !waiting && (
        <ul className="game-keys" aria-label="Controls">
          {controls.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      {waiting ? (
        <div className="game-start">
          <h3>{game.title}</h3>
          {game.note && <p className="muted">{game.note}</p>}
          {controls.length > 0 && (
            <ul className="game-keys" aria-label="Controls">
              {controls.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          <button className="primary" onClick={() => setStarted((s) => [...s, game.id])}>
            Start {game.title}
          </button>
        </div>
      ) : (
      <iframe
        key={`${game.id}-${nonce}`}
        ref={frame}
        src={`${import.meta.env.BASE_URL}games/${encodeURIComponent(game.id)}/index.html`}
        title={game.title}
        sandbox="allow-scripts allow-same-origin allow-pointer-lock"
        allow="autoplay; fullscreen; gamepad"
        onLoad={onLoad}
      />
      )}
    </section>
  );
}
