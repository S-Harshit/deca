import { useEffect, useSyncExternalStore } from "react";
import { answer, getConfirm, subscribeConfirm } from "../confirm";

/** Renders the pending confirmation, if any. Mount once near the app root. */
export function ConfirmHost() {
  const c = useSyncExternalStore(subscribeConfirm, getConfirm);

  useEffect(() => {
    if (!c) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && answer(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [c]);

  if (!c) return null;
  return (
    <div className="modal-scrim" onClick={() => answer(false)}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="modal-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="modal-title">{c.title}</h2>
        {!!c.lines?.length && (
          <ul>
            {c.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
        <div className="actions">
          {/* Safe default: focus lands on the non-destructive choice. */}
          <button autoFocus onClick={() => answer(false)}>
            {c.cancel ?? "Stay"}
          </button>
          <button className={c.danger ? "danger" : "primary"} onClick={() => answer(true)}>
            {c.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
