import { useEffect, useRef, useState } from "react";
import { SlotToggle } from "../slot";
import { ExportDialog } from "./ExportDialog";
import { ImportDialog } from "./ImportDialog";
import { ConnectByCode } from "./ConnectByCode";
import { setCodeDialog, useCodeDialog } from "../codeDialog";
import type { Space, Snapshot } from "../space";
import { ask } from "../confirm";
import { notify } from "../toast";
import { Avatar } from "./Avatar";
import { Icon } from "./Icons";

function routeLabel(peers: Snapshot["peers"], id: string) {
  const route = peers.find((p) => p.peerId === id)?.route;
  if (route === "direct") return "peer-to-peer";
  if (route === "relay") return "via relay";
  return "connected";
}

export function Members({ space, snap, isHost }: Readonly<{ space: Space; snap: Snapshot; isHost: boolean }>) {
  const { state, me, links, peers, relays } = snap;
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const coding = useCodeDialog();
  const setCoding = setCodeDialog;
  // In a room with no server, a code that needs handing over opens the dialog by itself.
  const codeCount = snap.manual?.codes.length ?? 0;
  const busyCount = codeCount + (snap.manual?.preparing.length ?? 0) + (snap.manual?.requests.length ?? 0); // a code being made also counts: show "getting it ready"
  const seen = useRef(0);
  useEffect(() => {
    if (busyCount > seen.current) setCoding(true);
    seen.current = busyCount;
  }, [busyCount, setCoding]);
  const members = [...state.members.values()].sort((a, b) => Number(b.online) - Number(a.online));
  const online = members.filter((m) => m.online).length;
  // In the room (per signaling) but no data link yet, so they are not in our log.
  const pending = peers.filter((p) => p.state !== "open" && !state.members.get(p.peerId)?.online);

  return (
    <section className="panel" aria-label="Members">
      <h3>
        <SlotToggle /> Members <span className="count" title={snap.capacity ? `A room holds up to ${snap.capacity} people` : undefined}>{snap.settled ? online : "…"}{snap.capacity ? ` / ${snap.capacity}` : ""}</span>
      </h3>
      {!snap.settled && <p className="muted small" role="status">Joining…</p>}
      <ul className="members">
        {members.map((m) => {
          const link = links.get(m.peerId);
          const talking = snap.tiles.some((t) => t.peerId === m.peerId && t.kind === "camera");
          return (
            <li key={m.peerId} className={m.online ? "" : "offline"}>
              <span className={`presence ${m.online ? "on" : ""}`}>
                <Avatar name={m.name} id={m.peerId} />
              </span>
              <div className="who">
                <div className="name">
                  {m.name}
                  {m.peerId === me && <span className="muted"> (you)</span>}
                  {m.peerId === state.hostId && (
                    <span className="badge" title="Host">
                      <Icon name="crown" size={11} /> host
                    </span>
                  )}
                  {talking && <span className="badge live">in call</span>}
                </div>
                <div className="muted small">
                  {!m.online && "offline"}
                  {m.online && m.peerId === me && "online"}
                  {m.online && m.peerId !== me && link === "open" && routeLabel(peers, m.peerId)}
                  {m.online && m.peerId !== me && link !== "open" && snap.manual && !relays.has(m.peerId) && (
                    <span title={peers.find((p) => p.peerId === m.peerId)?.detail ?? "waiting for the codes"}>
                      {peers.find((p) => p.peerId === m.peerId)?.state === "blocked" ? "can't connect directly: see Connect by code, Not connecting?" : "connecting…"}
                    </span>
                  )}
                  {m.online && m.peerId !== me && link !== "open" && (!snap.manual || relays.has(m.peerId)) && (relays.has(m.peerId) ? `chat via ${state.members.get(relays.get(m.peerId)!)?.name ?? "a mutual contact"}` : "connecting…")}
                </div>
              </div>
              {snap.manual && m.online && m.peerId !== me && link !== "open" && !relays.has(m.peerId) && (
                <button className="small-btn" onClick={() => space.retryPeer(m.peerId)} title="The link to them dropped. Make a new code to connect again.">
                  Reconnect
                </button>
              )}
              {isHost && m.peerId !== me && m.online && (
                <div className="member-actions">
                  <button className="icon-btn small" aria-label={`Make ${m.name} host`} title="Make host" onClick={() => space.handover(m.peerId)}>
                    <Icon name="crown" size={14} />
                  </button>
                  <button
                    className="icon-btn small danger"
                    aria-label={`Kick ${m.name}`}
                    title="Remove from space"
                    onClick={async () => {
                      const ok = await ask({
                        title: `Remove ${m.name}?`,
                        lines: ["They're disconnected from the space right away."],
                        confirm: "Remove",
                        danger: true,
                      });
                      if (ok) space.kick(m.peerId);
                    }}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {pending.map((p) => (
          <li key={p.peerId}>
            <Avatar name={p.name} id={p.peerId} />
            <div className="who">
              <div className="name">{p.name}</div>
              <div
                className={`small ${p.state === "blocked" ? "error-text" : "muted"}`}
                title={p.state === "blocked" ? "A network between you and them is blocking direct connections (common on mobile data, VPNs and office Wi-Fi). Chat can still reach them through other people; calls and file transfers can't." : p.detail}
              >
                {p.state === "blocked" ? (snap.manual ? "can't connect directly: see Connect by code, Not connecting?" : "can't connect directly") : "connecting…"}
              </div>
            </div>
            {p.state === "blocked" && (
              <button className="small-btn" onClick={() => space.retryPeer(p.peerId)} title="Try to connect again now">
                {snap.manual ? "Reconnect" : "Retry"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {snap.settled && (
      <div className="room-io">
        <button className="ghost small-btn" onClick={() => setExporting(true)} title="Save this room's history to your computer">
          <Icon name="download" size={13} /> Export
        </button>
        {isHost && (
          <button className="ghost small-btn" onClick={() => setImporting(true)} title="Bring an exported room's history into this room">
            <Icon name="upload" size={13} /> Import
          </button>
        )}
      </div>
      )}
      {(snap.manual?.check ?? []).map((c) => (
        <div key={c.peerId} className="code-box">
          <strong>Check words with {c.name}</strong>
          <span className="check-words">{c.words}</span>
          <span className="muted small">Ask {c.name} (in person, by phone, or in another app) which words they see. They must be exactly the same. If not, someone is in the middle.</span>
          <div className="row">
            <button className="small-btn primary" onClick={() => space.confirmWords(c.peerId, true)}>
              They match
            </button>
            <button
              className="small-btn"
              onClick={() => {
                space.confirmWords(c.peerId, false);
                notify("Disconnected. Make a new code and send it another way.", "error");
              }}
            >
              They don't match
            </button>
          </div>
        </div>
      ))}
      {snap.manual && (
        <button className="ghost small-btn room-code" onClick={() => setCoding(true)} title="Bring someone in without a server, by exchanging short codes">
          <Icon name="link" size={13} /> Connect by code{codeCount ? ` (${codeCount})` : ""}
        </button>
      )}
      {coding && <ConnectByCode space={space} snap={snap} onClose={() => setCoding(false)} />}
      {exporting && <ExportDialog space={space} onClose={() => setExporting(false)} />}
      {importing && <ImportDialog space={space} onClose={() => setImporting(false)} />}
    </section>
  );
}
