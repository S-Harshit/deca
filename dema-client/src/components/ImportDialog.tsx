import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { readExport, type ParsedImport } from "../roomImport";
import type { Space } from "../space";
import { notify } from "../toast";

/** Host only: bring an exported room's history into this room as read-only history everyone can read. */
export function ImportDialog({ space, onClose }: Readonly<{ space: Space; onClose: () => void }>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [busy, onClose]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError("");
    setParsed(null);
    try {
      setParsed(await readExport(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file could not be read.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!parsed) return;
    const err = space.importArchive(parsed);
    if (err) return setError(err);
    notify("History imported");
    onClose();
  };

  const s = parsed?.summary;
  // Drawn into the page itself: inside the phone sidebar (which slides with a transform) a "fixed" dialog would slide off-screen with it.
  return createPortal(
    <div className="modal-scrim" onClick={() => !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="import-title">Import room history</h2>
        {!s && (
          <ul>
            <li>Choose a zip saved with "Export room". Everyone here will see its messages above the live chat, marked as imported and read-only.</li>
            <li>It is checked first: every message must carry its author's valid signature, or nothing is imported.</li>
            <li>Only messages, files, coin flips, throws, blames and horns come across. The old room's host, removals and permissions do not.</li>
          </ul>
        )}
        {s && (
          <ul>
            <li>
              {s.messages} message{s.messages === 1 ? "" : "s"} from {s.people} {s.people === 1 ? "person" : "people"}, from room {s.from || "?"}, exported by {s.exportedBy || "someone"}.
            </li>
            <li>All signatures check out.</li>
            <li>
              {s.files
                ? `${s.files} attachment${s.files === 1 ? "" : "s"} included and verified against their recorded hashes; they are served from this computer, so they are only available while you are in the room.`
                : "No attachments are included."}
              {s.filesMissing ? ` ${s.filesMissing} file${s.filesMissing === 1 ? " was" : "s were"} not in the export and will show as unavailable.` : ""}
            </li>
            <li>Names are what people called themselves then. A short id is shown next to each so they are not mistaken for someone in this room.</li>
          </ul>
        )}
        {error && <p className="error-text small" role="alert">{error}</p>}
        <input ref={picker} type="file" accept=".zip,application/zip" hidden aria-label="Choose an export zip" onChange={(e) => void pick(e.target.files?.[0])} />
        <div className="actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {!s ? (
            <button className="primary" onClick={() => picker.current?.click()} disabled={busy}>
              {busy ? "Checking…" : "Choose file…"}
            </button>
          ) : (
            <>
              <button onClick={() => picker.current?.click()} disabled={busy}>
                Choose another
              </button>
              <button className="primary" onClick={confirm}>
                Add to this room
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
