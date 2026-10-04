import { useEffect, useState } from "react";
import { notify } from "../toast";
import type { RoomOptions } from "../log";
import type { Snapshot } from "../space";
import { buildSummary } from "../summary";
import { Avatar } from "./Avatar";
import type { Game } from "./GamesPanel";
import { Icon } from "./Icons";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`;
};

/** "Ends in 12:03", shown to everyone while the host has set an end time. Warns at 5 minutes and 1 minute. */
export function EndsIn({ options }: Readonly<{ options: RoomOptions }>) {
  const [now, setNow] = useState(() => Date.now());
  const left = options.endsAt - now;
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const warned = useState(() => new Set<string>())[0];
  useEffect(() => {
    if (!options.endsAt) return;
    for (const [min, text] of [[5, "5 minutes left in this room"], [1, "1 minute left in this room"]] as const) {
      const key = `${options.endsAt}:${min}`;
      // only when the moment is crossed while watching, not when joining a room that is already inside the window
      if (left <= min * 60000 && left > min * 60000 - 2500 && !warned.has(key)) {
        warned.add(key);
        notify(text);
      }
    }
  }, [left, options.endsAt, warned]);
  if (!options.endsAt) return null;
  return (
    <span className={`pill ends-in ${left <= 60000 ? "soon" : ""}`} role="timer" aria-label="Time left in this room" title="The host set an end time for this room">
      ends in {mmss(left)}
    </span>
  );
}

/** What the room did, on the end screen (when the host switched the summary on). Parts with nothing in them are left out. */
export function RoomSummary({ snap, games }: Readonly<{ snap: Snapshot; games: Game[] }>) {
  const s = buildSummary(snap.state, snap.me, snap.highlights);
  const title = (id: string) => games.find((g) => g.id === id)?.title ?? id;
  const stat = (n: number | string, label: string) => (
    <div className="stat">
      <strong>{n}</strong>
      <span>{label}</span>
    </div>
  );
  return (
    <div className="summary" aria-label="Room summary">
      <div className="stats">
        {stat(s.minutes, s.minutes === 1 ? "minute" : "minutes")}
        {stat(s.people.length, s.people.length === 1 ? "person" : "people")}
        {stat(s.messages, s.messages === 1 ? "message" : "messages")}
      </div>
      <div className="who-chips">
        {s.people.map((p) => (
          <span key={p.id} className="chip">
            <Avatar name={p.name} id={p.id} size={20} />
            {p.name}
          </span>
        ))}
      </div>
      <div className="sum-grid">
        {s.files.length > 0 && (
          <section className="sum-card">
            <h4>
              <Icon name="file" size={14} /> Files shared
            </h4>
            <ul>{s.files.map((f, i) => <li key={i}>{f}</li>)}</ul>
          </section>
        )}
        {s.links.length > 0 && (
          <section className="sum-card">
            <h4>
              <Icon name="link" size={14} /> Pages opened
            </h4>
            <ul>{s.links.map((l) => <li key={l}>{l}</li>)}</ul>
          </section>
        )}
        {s.screens.length > 0 && (
          <section className="sum-card">
            <h4>
              <Icon name="monitor" size={14} /> Screens shared
            </h4>
            <ul>{s.screens.map((x) => <li key={x.name}>{x.name} · {x.count} {x.count === 1 ? "time" : "times"}</li>)}</ul>
          </section>
        )}
        {s.tracks.length > 0 && (
          <section className="sum-card">
            <h4>
              <Icon name="music" size={14} /> Music
            </h4>
            <ul>{s.tracks.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </section>
        )}
        {s.games.map((g) => (
          <section key={g.game} className="sum-card">
            <h4>
              <Icon name="gamepad" size={14} /> {title(g.game)}
              <span className="muted small"> · {g.plays} {g.plays === 1 ? "play" : "plays"}</span>
            </h4>
            <ol className="podium">
              {g.top.map((t, i) => (
                <li key={i}>
                  <span className="rank">{i + 1}</span>
                  <span>{t.name}</span>
                  <b>{t.best.toLocaleString()}</b>
                </li>
              ))}
            </ol>
          </section>
        ))}
        {s.horn.count > 0 && (
          <section className="sum-card">
            <h4>
              <Icon name="bell" size={14} /> Air horn
            </h4>
            <ul>
              <li>
                {s.horn.count} {s.horn.count === 1 ? "time" : "times"}
              </li>
              {s.horn.by.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </section>
        )}
      </div>
      <p className="muted small">Counted from what this device saw. Music and screens are what reached you.</p>
    </div>
  );
}
