import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { buildExport, EXPORT_FILE_CAP } from "../roomExport";
import type { Space } from "../space";
import { notify } from "../toast";

const mb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Save this room's history (and optionally the files on this device) to a zip. Nothing is uploaded anywhere. */
export function ExportDialog({ space, onClose }: Readonly<{ space: Space; onClose: () => void }>) {
  const held = space.heldFileStats();
  const [files, setFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const tooBig = held.bytes > EXPORT_FILE_CAP;

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [busy, onClose]);

  const run = async () => {
    setBusy(true);
    try {
      const { blob, filename, fileCount } = await buildExport(await space.exportInput(), files);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      notify(`Saved ${filename}${fileCount ? ` with ${fileCount} file${fileCount === 1 ? "" : "s"}` : ""}`);
      onClose();
    } catch {
      notify("Couldn't build the export", "error");
      setBusy(false);
    }
  };

  // Drawn into the page itself: inside the phone sidebar (which slides with a transform) a "fixed" dialog would slide off-screen with it.
  return createPortal(
    <div className="modal-scrim" onClick={() => !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="export-title">Export this room</h2>
        <ul>
          <li>Saves everything this device has: messages, who joined and left, and file names, as a readable page plus a signed copy that can be verified later.</li>
          <li>It stays on your computer. Nothing is uploaded, and the other people are not told. Anyone in a room can do this, just as they could take screenshots.</li>
          <li>It only holds what reached you, so it is not a guarantee of the full history.</li>
        </ul>
        <label className="toggle" title={tooBig ? `Over ${mb(EXPORT_FILE_CAP)}: only some files will fit` : undefined}>
          <input type="checkbox" checked={files} disabled={!held.count} onChange={(e) => setFiles(e.target.checked)} />
          {held.count ? `Include the ${held.count} file${held.count === 1 ? "" : "s"} on this device (${mb(held.bytes)})` : "No files on this device to include"}
        </label>
        {files && tooBig && <p className="muted small">Large: files are added until {mb(EXPORT_FILE_CAP)}, the rest are left out.</p>}
        <div className="actions">
          <button autoFocus onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={() => void run()} disabled={busy}>
            {busy ? "Building…" : "Export"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
