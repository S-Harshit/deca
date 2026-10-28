// Search this room: a compact palette (Ctrl/Cmd+K) over what this device holds. Loaded only when opened.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isBlankMessage } from "../message";
import type { Snapshot } from "../space";
import { noteText } from "../tools";
import { openTool } from "../toolsDialog";

const nameOf = (snap: Snapshot, id: string) => (id === snap.me ? "you" : (snap.state.members.get(id)?.name ?? "someone"));

// ------------------------------------------------------------------------------------------------------------ search

type Hit = { key: string; kind: string; title: string; snippet: string; ts: number; open: () => void };

function snippet(text: string, words: string[]) {
  const flat = text.replaceAll(/\s+/g, " ");
  const at = Math.max(0, Math.min(...words.map((w) => flat.toLowerCase().indexOf(w)).filter((i) => i >= 0)));
  return (at > 40 ? "…" : "") + flat.slice(Math.max(0, at - 40), at + 100) + (flat.length > at + 100 ? "…" : "");
}

function jumpTo(id: string) {
  openTool(null);
  setTimeout(() => {
    const el = document.querySelector(`[data-eid="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ block: "center" });
    el?.classList.add("flash");
    setTimeout(() => el?.classList.remove("flash"), 1800);
  }, 60);
}

export default function SearchPalette({ snap }: Readonly<{ snap: Snapshot }>) {
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const hits = useMemo<Hit[]>(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const has = (text: string) => words.every((w) => text.toLowerCase().includes(w));
    const out: Hit[] = [];
    const { state } = snap;
    for (const e of state.visible) {
      if (e.type === "chat") {
        const t = String(e.payload.text ?? "");
        if (!isBlankMessage(t) && has(t)) out.push({ key: e.id, kind: "Message", title: nameOf(snap, e.author), snippet: snippet(t, words), ts: e.ts, open: () => jumpTo(e.id) });
      } else if (e.type === "file_offer") {
        const n = String(e.payload.name ?? "");
        if (has(n)) out.push({ key: e.id, kind: "File", title: n, snippet: `shared by ${nameOf(snap, e.author)}`, ts: e.ts, open: () => jumpTo(e.id) });
      }
    }
    for (const d of state.tools.docs.values()) {
      const text = d.kind === "note" ? noteText(d) : d.body.replaceAll(/<[^>]*>/g, " ");
      if (has(`${d.title} ${text}`)) out.push({ key: d.id, kind: d.kind === "page" ? "Page" : "Note", title: d.title, snippet: snippet(text, words), ts: d.ts, open: () => openTool("docs", d.id) });
    }
    for (const p of state.tools.polls.values()) if (has(`${p.q} ${p.opts.join(" ")}`)) out.push({ key: p.id, kind: "Poll", title: p.q, snippet: p.opts.join(" · "), ts: 0, open: () => openTool("polls") });
    return out.sort((a, b) => b.ts - a.ts).slice(0, 60);
  }, [q, snap]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && openTool(null);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return createPortal(
    <div className="modal-scrim palette-scrim" onClick={() => openTool(null)}>
    <div className="modal palette" role="dialog" aria-modal="true" aria-label="Search this room" onClick={(e) => e.stopPropagation()}>
      <input ref={input} aria-label="Search this room" placeholder="Search this room: messages, files, notes, pages, polls" value={q} onChange={(e) => setQ(e.target.value)} />
      {q.trim() && hits.length === 0 && <p className="muted">Nothing found.</p>}
      <ul className="hits">
        {hits.map((h) => (
          <li key={h.kind + h.key}>
            <button className="hit" onClick={h.open}>
              <span className="muted small">{h.kind}</span>
              <strong>{h.title}</strong>
              <span className="muted small">{h.snippet}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
    </div>,
    document.body,
  );
}

