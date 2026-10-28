// Things the room's tools put straight into the chat: a poll you can vote in without leaving the conversation, and a card for a new
// note that opens the workspace beside the chat.
import type { SpaceEvent } from "../log";
import type { Snapshot, Space } from "../space";
import { tally } from "../tools";
import { openTool } from "../toolsDialog";

export function PollCard({ e, space, snap, mine, who }: Readonly<{ e: SpaceEvent; space: Space; snap: Snapshot; mine: boolean; who: string }>) {
  const p = snap.state.tools.polls.get(String(e.payload.id));
  if (!p) return null;
  const { counts, total } = tally(p);
  const vote = p.votes.get(snap.me);
  return (
    <div className={`feed-card poll-card ${mine ? "mine" : ""}`} data-eid={e.id}>
      <p className="muted small">
        {who} started a poll · {total} {total === 1 ? "vote" : "votes"}
        {p.ended ? " · ended" : ""}
      </p>
      <h4>{p.q}</h4>
      {p.opts.map((o, i) => (
        <button key={i} className={`poll-opt ${vote === i ? "mine" : ""}`} disabled={p.ended} aria-pressed={vote === i} onClick={() => space.vote(p.id, i)}>
          <span className="poll-bar" style={{ width: `${total ? (counts[i] / total) * 100 : 0}%` }} />
          <span className="poll-label">{o}</span>
          <span className="poll-count">{counts[i]}</span>
        </button>
      ))}
      {!p.ended && (p.author === snap.me || snap.state.hostId === snap.me) && (
        <button className="small-btn" onClick={() => space.endPoll(p.id)}>
          End poll
        </button>
      )}
    </div>
  );
}

export function DocCard({ e, snap, who }: Readonly<{ e: SpaceEvent; snap: Snapshot; who: string }>) {
  const d = snap.state.tools.docs.get(String(e.payload.id));
  return (
    <div className="feed-card doc-card" data-eid={e.id}>
      <span className="muted small">
        {who} made a note
      </span>
      <strong>{d?.title ?? String(e.payload.title ?? "Untitled")}</strong>
      {d ? (
        <button className="small-btn" onClick={() => openTool("docs", d.id)}>
          Open
        </button>
      ) : (
        <span className="muted small">(deleted)</span>
      )}
    </div>
  );
}
