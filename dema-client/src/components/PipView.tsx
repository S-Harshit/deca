import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Snapshot, Space, Tile } from "../space";

function Video({ tile }: Readonly<{ tile: Tile }>) {
  const el = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (el.current && el.current.srcObject !== tile.stream) {
      el.current.srcObject = tile.stream;
      void el.current.play().catch(() => undefined);
    }
  }, [tile.stream]);
  return <video ref={el} autoPlay playsInline muted={tile.local} style={{ width: "100%", height: "100%", objectFit: tile.kind === "screen" ? "contain" : "cover", background: "#000", display: "block" }} />;
}

const btn: React.CSSProperties = { padding: "4px 10px", fontSize: 12 };

export function PipView({ space, onBack }: Readonly<{ space: Space; onBack: () => void }>) {
  const snap: Snapshot = useSyncExternalStore(space.subscribe, space.getSnapshot);
  const name = (id: string) => (id === snap.me ? "You" : (snap.state.members.get(id)?.name ?? "someone"));
  const spot = snap.tiles.find((t) => t.kind === "screen");
  const rest = snap.tiles.filter((t) => t !== spot);
  const shown = [...(spot ? [spot] : []), ...rest];
  const since = useRef(snap.state.visible.filter((e) => e.type === "chat").length);
  const unread = Math.max(0, snap.state.visible.filter((e) => e.type === "chat").length - since.current);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "inherit" }}>
      <div style={{ flex: 1, minHeight: 0, display: "grid", gap: 4, padding: 4, gridTemplateColumns: spot ? "1fr" : "repeat(auto-fit, minmax(130px, 1fr))", gridAutoRows: "1fr" }}>
        {shown.length === 0 && <p style={{ margin: "auto", opacity: 0.7, fontSize: 13 }}>Nobody on camera yet</p>}
        {shown.slice(0, spot ? 2 : 6).map((t) => (
          <div key={t.key} style={{ position: "relative", minHeight: 0, borderRadius: 6, overflow: "hidden", background: "#000" }}>
            {t.cam || t.kind === "screen" ? <Video tile={t} /> : <Video tile={t} />}
            {!t.cam && t.kind !== "screen" && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "#111", color: "#fff", fontSize: 22 }}>{(name(t.peerId)[0] ?? "?").toUpperCase()}</div>}
            <span style={{ position: "absolute", left: 4, bottom: 4, background: "#000a", color: "#fff", fontSize: 11, padding: "1px 6px", borderRadius: 4 }}>
              {name(t.peerId)}
              {t.kind === "screen" ? " · screen" : ""}
              {!t.mic && t.kind === "camera" ? " · muted" : ""}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, padding: "4px 6px", alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--border)" }}>
        {snap.inCall ? (
          <>
            <button style={btn} aria-label={snap.micOn ? "Mute microphone" : "Unmute microphone"} onClick={() => space.toggleMic()}>
              {snap.micOn ? "Mic on" : "Mic off"}
            </button>
            <button style={btn} aria-label={snap.camOn ? "Turn off camera" : "Turn on camera"} onClick={() => void space.toggleCam()}>
              {snap.camOn ? "Camera on" : "Camera off"}
            </button>
            <button style={{ ...btn, background: "var(--danger)", color: "#fff", borderColor: "var(--danger)" }} aria-label="Leave call" onClick={() => space.stopCamera()}>
              Leave
            </button>
          </>
        ) : (
          <span style={{ fontSize: 12, opacity: 0.8 }}>Not in the call</span>
        )}
        <button style={{ ...btn, marginLeft: "auto" }} onClick={onBack}>
          Back to Deca{unread ? ` (${unread})` : ""}
        </button>
      </div>
    </div>
  );
}

