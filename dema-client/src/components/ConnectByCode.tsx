import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Addresses } from "../localNetwork";
import type { Snapshot, Space } from "../space";
import { notify } from "../toast";
import { Icon } from "./Icons";

const describe = (a: Addresses) => {
  const bits = [a.real && `${a.real} Wi-Fi address${a.real > 1 ? "es" : ""}`, a.hidden && `${a.hidden} hidden address${a.hidden > 1 ? "es" : ""}`, a.public && `${a.public} internet address${a.public > 1 ? "es" : ""}`, a.relay && `${a.relay} relay`].filter(Boolean);
  return bits.length ? bits.join(", ") : "no addresses";
};

/** A plain reading of what the two codes carried, to point at the likely cause. */
function verdict(mine?: Addresses, theirs?: Addresses) {
  if (!mine || !theirs) return "";
  if (mine.real === 0 && theirs.real === 0 && (mine.hidden || theirs.hidden)) return "Both browsers hid their Wi-Fi address, which often stops devices on one Wi-Fi from finding each other. Start again with “Same Wi-Fi” ticked on both.";
  if (mine.real === 0 && mine.hidden) return "Your browser hid its Wi-Fi address. Start again with “Same Wi-Fi” ticked on this device.";
  if (theirs.real === 0 && theirs.hidden) return "Their browser hid its Wi-Fi address. They should start again with “Same Wi-Fi” ticked.";
  if (mine.real && theirs.real) return "Both offered real Wi-Fi addresses. If it still fails, the Wi-Fi is probably stopping devices from talking to each other (look for “AP isolation”, “client isolation” or a guest network) or a VPN is in the way.";
  return "";
}

/**
 * Join people without a server, one task at a time:
 *  - a code to send (shown on its own, with a Copy button),
 *  - then, only if a reply is expected, the box to paste it into.
 * Whoever joins sends a code to someone already in the room; that person pastes it and sends a reply back. After that first
 * link everyone else in the room is introduced automatically.
 */
export function ConnectByCode({ space, snap, onClose }: Readonly<{ space: Space; snap: Snapshot; onClose: () => void }>) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paste, setPaste] = useState(false); // the person chose to paste instead of (or after) sending a code
  const codes = snap.manual?.codes ?? [];
  const preparing = snap.manual?.preparing ?? [];
  const ask = codes.find((c) => c.kind === "ask");
  // The box to paste into is shown when there is nothing to send, or the person has sent it and moved on.
  const requests = snap.manual?.requests ?? [];
  const showPaste = paste || (!codes.length && !preparing.length);

  // The code has done its job (the person connected, or the reply was pasted): close, unless a code is being pasted.
  const [had, setHad] = useState(0);
  useEffect(() => {
    if (codes.length) setHad(codes.length);
    else if (had && !text.trim() && !preparing.length && !requests.length) onClose();
  }, [codes.length, had, text, preparing.length, requests.length, onClose]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [busy, onClose]);

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      notify("Code copied");
    } catch {
      notify("Select the code and copy it by hand", "error");
    }
  };

  const connect = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const problem = await space.pasteCode(text);
    setBusy(false);
    setError(problem);
    if (!problem) {
      setText("");
      setPaste(false);
    }
  };

  // Drawn into the page itself: inside the phone sidebar (which slides with a transform) a "fixed" dialog would slide off-screen with it.
  return createPortal(
    <div className="modal-scrim" onClick={() => !busy && onClose()}>
      <div className="modal code-modal" role="dialog" aria-modal="true" aria-labelledby="code-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="code-title">Connect by code</h2>

        {requests.map((r) => (
          <div key={r.peerId} className="code-box" role="alert">
            <strong>{r.name} wants to join</strong>
            <span className="muted small">Only let them in if you know this is the person you sent your link to. Anyone who gets a code can try.</span>
            <div className="row">
              <button className="small-btn primary" onClick={() => space.approveCode(r.peerId)}>
                Let them in
              </button>
              <button className="small-btn" onClick={() => space.refuseCode(r.peerId)}>
                No
              </button>
            </div>
          </div>
        ))}

        {!showPaste && !codes.length && preparing.length > 0 && (
          <div className="code-box" role="status">
            <strong>Getting your code ready for {preparing[0].name}…</strong>
            <span className="muted small">This takes a few seconds while your browser looks for the best way to reach them.</span>
          </div>
        )}

        {!showPaste &&
          codes.map((c) => (
            <div key={c.peerId} className="code-box">
              <strong>{c.kind === "ask" ? `Step 1 of 2: send this code to ${c.name}` : `Last step: send this reply back to ${c.name}`}</strong>
              <span className="muted small">
                {c.kind === "ask"
                  ? `Copy it and send it to ${c.name} in any way you like (a message, an email). They paste it into Deca and send you a reply code.`
                  : `${c.name} is waiting for this. Copy it and send it to them. When they paste it, you are connected.`}
              </span>
              <textarea readOnly rows={3} value={c.text} aria-label={`Code for ${c.name}`} onFocus={(e) => e.currentTarget.select()} />
              <div className="row">
                <button className="small-btn primary" onClick={() => void copy(c.text)}>
                  <Icon name="copy" size={13} /> Copy code
                </button>
                {c.kind === "ask" && (
                  <button className="small-btn" onClick={() => setPaste(true)}>
                    I have sent it: next
                  </button>
                )}
              </div>
            </div>
          ))}

        {showPaste && (
          <div className="code-box">
            <strong>{ask ? `Now paste ${ask.name}'s reply code:` : "Paste the code you were sent:"}</strong>
            {!ask && (
              <ol className="steps muted small">
                <li>The person joining sends you a code. Paste it here and press Connect.</li>
                <li>A reply code appears: send it back to them.</li>
              </ol>
            )}
            <textarea rows={3} value={text} placeholder="deca1.…" aria-label="Paste a code" onChange={(e) => setText(e.target.value)} />
            {error && (
              <p className="error-text small" role="alert">
                {error}
              </p>
            )}
            <div className="row">
              <button className="small-btn primary" disabled={!text.trim() || busy} onClick={() => void connect()}>
                {busy ? "Checking…" : "Connect"}
              </button>
              {codes.length > 0 && (
                <button className="small-btn" onClick={() => setPaste(false)}>
                  Show my code again
                </button>
              )}
            </div>
          </div>
        )}

        {!showPaste && codes.some((c) => c.kind === "reply") && (
          <button className="ghost small-btn code-alt" onClick={() => setPaste(true)}>
            I need to paste a code instead
          </button>
        )}

        <details className="code-help">
          <summary>Not connecting?</summary>
          <ul className="muted small">
            <li>Both of you need internet, or to be on the same Wi-Fi. Guest Wi-Fi, some offices and VPNs stop devices reaching each other: turn the VPN off or try another network.</li>
            <li>Two browsers on the <strong>same computer</strong> often cannot connect this way. Use two different devices.</li>
            <li>If it stops at "connecting", press <strong>Reconnect</strong> next to their name and do the exchange once more.</li>
            <li>Codes are single-use: always paste the newest one you were sent.</li>
          </ul>
          {(snap.manual?.diag ?? []).map((d) => (
            <p key={d.peerId} className="muted small code-diag">
              <strong>Details for {d.name}:</strong> {d.mine ? `your code offered ${describe(d.mine)}` : "your code is not made yet"}; {d.theirs ? `their code offered ${describe(d.theirs)}` : "their code has not arrived"}. {verdict(d.mine, d.theirs)}
            </p>
          ))}
        </details>

        <div className="actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
