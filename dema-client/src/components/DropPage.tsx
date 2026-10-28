// What someone sees when they open a "share as link" link: it connects to the sharer's browser, and the file saves itself.
import { useEffect, useState } from "react";
import { receiveDrop, type GuestState } from "../drop";
import { Logo } from "./Logo";

const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function DropPage({ token }: Readonly<{ token: string }>) {
  const [s, setS] = useState<GuestState>({ phase: "looking", name: "", size: 0, received: 0, url: null });
  const [again, setAgain] = useState<() => void>(() => () => {});
  useEffect(() => {
    const r = receiveDrop(token, setS);
    setAgain(() => r.save);
    return r.close;
  }, [token]);
  const pct = s.size ? Math.min(100, Math.round((s.received / s.size) * 100)) : 0;
  return (
    <div className="landing dotted drop-page">
      <div className="card hero simple">
        <Logo size={44} />
        <h1>
          {s.phase === "looking" && "Connecting to the sender…"}
          {s.phase === "receiving" && "Receiving a file"}
          {s.phase === "done" && "Saved"}
          {s.phase === "gone" && "Nobody is sharing this any more"}
          {s.phase === "failed" && "The transfer was interrupted"}
          {s.phase === "toobig" && "That file is too large for this device"}
        </h1>
        {(s.phase === "receiving" || s.phase === "done" || s.phase === "toobig") && (
          <p>
            <strong>{s.name}</strong> <span className="muted">({size(s.size)})</span>
          </p>
        )}
        {s.phase === "receiving" && (
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
        {s.phase === "done" && (
          <>
            <p className="muted">It should be in your downloads folder. If it did not start, press the button.</p>
            <button className="primary" onClick={again}>
              Save again
            </button>
          </>
        )}
        {s.phase === "gone" && <p className="muted">The file is sent straight from the sender&apos;s browser, so it works only while they keep their tab open. Ask them to share it again.</p>}
        {s.phase === "failed" && <p className="muted">Open the link again to retry. The sender must still have their tab open.</p>}
        {s.phase === "toobig" && <p className="muted">Try on a computer.</p>}
        <p className="muted small">The file comes directly from the sender&apos;s device: it is not stored on any server. Only open files from people you trust. The sender can see your network address, as in any direct connection.</p>
      </div>
    </div>
  );
}
