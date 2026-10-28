import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { qrSvg } from "../qr";
import { notify } from "../toast";
import { Icon } from "./Icons";

/** "Open on your phone": the room's invite link as a QR code, so another device joins with one scan. */
const ON_THIS_COMPUTER = /^(localhost|127\.|\[::1\])/;

/**
 * A room opened as "localhost" can only be reached from this computer, so the link that is shared (and the QR code) uses this computer's
 * address on the local network instead, which a phone on the same Wi-Fi can open. The server tells us that address (and only us: it answers
 * nobody else). A plain http address has no camera and no WebCrypto, so the page signs in plain JavaScript there (softcrypto.ts).
 */
function useShareLink(link: string) {
  const local = ON_THIS_COMPUTER.test(location.hostname);
  const [lan, setLan] = useState<string | null>(null);
  const [asked, setAsked] = useState(!local);
  useEffect(() => {
    if (!local) return;
    let live = true;
    fetch(`${import.meta.env.BASE_URL}lan`)
      .then((r) => r.json())
      .then((d: { port?: number; addresses?: string[] }) => {
        const ip = d.addresses?.[0];
        if (live && ip) setLan(link.replace(/^https?:\/\/[^/]+/, `http://${ip}:${d.port ?? location.port}`));
      })
      .catch(() => undefined)
      .finally(() => live && setAsked(true));
    return () => {
      live = false;
    };
  }, [local, link]);
  return { shared: lan ?? link, local, lan: !!lan, asked };
}

export function QrDialog({ link: roomLink, onClose }: Readonly<{ link: string; onClose: () => void }>) {
  const { shared: link, local, lan, asked } = useShareLink(roomLink);
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
        {local && lan && <p className="muted small">This is this computer's address on your Wi-Fi, so a phone on the same network can open it. Your phone must be on the same Wi-Fi. On a plain http address like this the phone cannot use the camera or calls; chat, files and music work.</p>}
        {local && !lan && asked && <p className="error-text small">This computer's address on your network could not be found. Connect to Wi-Fi (or a hotspot) and open this window again, or open Deca through its public link.</p>}
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
