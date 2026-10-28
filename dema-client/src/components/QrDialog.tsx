import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { qrSvg } from "../qr";
import { notify } from "../toast";
import { Icon } from "./Icons";

/** "Open on your phone": the room's invite link as a QR code, so another device joins with one scan. */
export function QrDialog({ link, onClose }: Readonly<{ link: string; onClose: () => void }>) {
  const svg = useMemo(() => qrSvg(link), [link]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      notify("Invite link copied");
    } catch {
      notify("Select the link and copy it by hand", "error");
    }
  };
  // Drawn into the page itself: inside the phone sidebar (which slides with a transform) a "fixed" dialog would slide off-screen with it.
  return createPortal(
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal qr-modal" role="dialog" aria-modal="true" aria-labelledby="qr-heading" onClick={(e) => e.stopPropagation()}>
        <h2 id="qr-heading">Open this room on another device</h2>
        <div className="qr-box" role="img" aria-label="QR code of the invite link" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="muted small">Point the other device's camera at this code and open the link. Then send files, pictures and text between your devices from the chat box. Files and messages go straight between your devices (the server only introduces them), and the room is gone when you leave.</p>
        {/^(localhost|127\.|\[::1\])/.test(location.hostname) && <p className="error-text small">This link points at this computer ("localhost"), so a phone cannot open it. Open Deca through its public link instead (see START-HERE.md), or use the hosted version.</p>}
        <div className="row">
          <code className="link grow">{link}</code>
          <button className="small-btn" onClick={() => void copy()}>
            <Icon name="copy" size={13} /> Copy
          </button>
        </div>
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
