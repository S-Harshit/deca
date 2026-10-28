// The links this tab is sharing: copy one, post it in the chat, watch who is downloading, stop sharing.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { getDrops, subscribeDrops, type DropHost } from "../drop";
import { qrSvg } from "../qr";
import type { Space } from "../space";
import { notify } from "../toast";
import { Icon } from "./Icons";

const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function Row({ d, space, onStop }: Readonly<{ d: DropHost; space: Space | null; onStop: () => void }>) {
  const [, tick] = useState(0);
  useEffect(() => {
    const off = d.subscribe(() => tick((n) => n + 1));
    return () => void off();
  }, [d]);
  const [qr, setQr] = useState(false);
  const link = d.link();
  const svg = useMemo(() => (qr ? qrSvg(link) : ""), [qr, link]);
  const active = [...d.guests.values()].filter((g) => g.state === "sending");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      notify("Link copied");
    } catch {
      notify("Select the link and copy it by hand", "error");
    }
  };
  return (
    <li className="drop-row">
      <div className="row">
        <strong className="grow">{d.file.name}</strong>
        <span className="muted small">{size(d.file.size)}</span>
      </div>
      <div className="row">
        <code className="link grow">{link}</code>
        <button className="small-btn" onClick={() => void copy()}>
          <Icon name="copy" size={13} /> Copy
        </button>
      </div>
      <div className="row">
        {space && (
          <button className="small-btn" onClick={() => { space.sendChat(link); notify("Posted in the chat"); }}>
            Post in chat
          </button>
        )}
        <button className="small-btn" onClick={() => setQr(!qr)} aria-expanded={qr}>
          QR code
        </button>
        <button className="small-btn danger" onClick={onStop}>
          Stop sharing
        </button>
        <span className="muted small grow" aria-live="polite">
          {active.length ? `${active.length} downloading now` : ""} {d.finished ? `${d.finished} downloaded` : "nobody yet"}
        </span>
      </div>
      {qr && <div className="qr-box" role="img" aria-label="QR code of the link" dangerouslySetInnerHTML={{ __html: svg }} />}
    </li>
  );
}

export function DropsDialog({ space, onClose }: Readonly<{ space: Space | null; onClose: () => void }>) {
  const drops = useSyncExternalStore(subscribeDrops, getDrops);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return createPortal(
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal drops-modal" role="dialog" aria-modal="true" aria-label="Shared links" onClick={(e) => e.stopPropagation()}>
        <h2>Files shared as links</h2>
        <p className="muted small">
          Anyone with a link, in this room or not, can download the file straight from this browser. Nothing is uploaded, so a link works only while this tab stays open. Stop sharing and it dies at once.
        </p>
        {drops.length === 0 && <p className="muted">Nothing is shared right now.</p>}
        <ul className="drop-list">
          {drops.map((d) => (
            <Row key={d.token} d={d} space={space} onStop={() => d.stop()} />
          ))}
        </ul>
        <div className="actions">
          <button autoFocus onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
