// The room's extra tools in one dialog with tabs: search, pages and notes, polls, a drawing board, and doors to other rooms.
// Loaded only when someone opens it (React.lazy in App.tsx), so a room that never uses them pays nothing.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isBlankMessage } from "../message";
import type { Snapshot, Space } from "../space";
import { notify } from "../toast";
import { LIMITS, PALETTE, pageDocument, tally, type Doc } from "../tools";
import { openTool, type ToolTab } from "../toolsDialog";
import { ask } from "../confirm";

const TABS: { id: ToolTab; label: string }[] = [
  { id: "search", label: "Search" },
  { id: "docs", label: "Pages & notes" },
  { id: "polls", label: "Polls" },
  { id: "board", label: "Board" },
  { id: "doors", label: "Doors" },
];

type Props = Readonly<{ space: Space; snap: Snapshot; tab: ToolTab; focus: string | null }>;

export default function RoomTools({ space, snap, tab, focus }: Props) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && openTool(null);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return createPortal(
    <div className="modal-scrim" onClick={() => openTool(null)}>
      <div className="modal tools-modal" role="dialog" aria-modal="true" aria-label="Room tools" onClick={(e) => e.stopPropagation()}>
        <div className="tools-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`small-btn ${tab === t.id ? "primary" : ""}`} onClick={() => openTool(t.id)}>
              {t.label}
            </button>
          ))}
          <button className="small-btn push-right" aria-label="Close" onClick={() => openTool(null)}>
            Close
          </button>
        </div>
        <div className="tools-body">
          {tab === "search" && <SearchTab snap={snap} />}
          {tab === "docs" && <DocsTab space={space} snap={snap} focus={focus} />}
          {tab === "polls" && <PollsTab space={space} snap={snap} />}
          {tab === "board" && <BoardTab space={space} snap={snap} />}
          {tab === "doors" && <DoorsTab space={space} snap={snap} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

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

function SearchTab({ snap }: Readonly<{ snap: Snapshot }>) {
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
    for (const d of state.tools.docs.values()) if (has(`${d.title} ${d.body}`)) out.push({ key: d.id, kind: d.kind === "page" ? "Page" : "Note", title: d.title, snippet: snippet(d.body, words), ts: d.ts, open: () => openTool("docs", d.id) });
    for (const p of state.tools.polls.values()) if (has(`${p.q} ${p.opts.join(" ")}`)) out.push({ key: p.id, kind: "Poll", title: p.q, snippet: p.opts.join(" · "), ts: 0, open: () => openTool("polls") });
    for (const p of state.tools.portals.values()) if (has(`${p.label} ${p.url}`)) out.push({ key: p.id, kind: "Door", title: p.label, snippet: p.url, ts: 0, open: () => openTool("doors") });
    return out.sort((a, b) => b.ts - a.ts).slice(0, 60);
  }, [q, snap]);
  return (
    <div className="tool-col">
      <input ref={input} aria-label="Search this room" placeholder="Search messages, files, pages, notes, polls and doors in this room" value={q} onChange={(e) => setQ(e.target.value)} />
      {!q.trim() && <p className="muted small">Looks only at what this device has of the room. Nothing is sent anywhere.</p>}
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
  );
}

// -------------------------------------------------------------------------------------------------- pages and notes

const PAGE_START = `<h1>My page</h1>\n<p>Write HTML here. It is shown to everyone in the room, safely: no scripts, no outside images or links that run.</p>\n<style>body{font-family:sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.5}</style>\n`;

function DocsTab({ space, snap, focus }: Readonly<{ space: Space; snap: Snapshot; focus: string | null }>) {
  const docs = [...snap.state.tools.docs.values()].sort((a, b) => b.ts - a.ts);
  const [sel, setSel] = useState<string | null>(focus ?? docs[0]?.id ?? null);
  useEffect(() => {
    if (focus) setSel(focus);
  }, [focus]);
  const doc = snap.state.tools.docs.get(sel ?? "") ?? null;
  const create = (kind: "page" | "note") => {
    const id = space.newToolId();
    const err = space.saveDoc(id, kind, kind === "page" ? "My page" : "Untitled note", kind === "page" ? PAGE_START : "");
    if (err) notify(err, "error");
    else setSel(id);
  };
  return (
    <div className="tool-split">
      <div className="tool-side">
        <div className="row">
          <button className="small-btn primary" onClick={() => create("note")}>
            New note
          </button>
          <button className="small-btn" onClick={() => create("page")}>
            New page
          </button>
        </div>
        <ul className="hits">
          {docs.map((d) => (
            <li key={d.id}>
              <button className={`hit ${d.id === sel ? "on" : ""}`} onClick={() => setSel(d.id)}>
                <span className="muted small">{d.kind === "page" ? "Page" : "Note"} · {nameOf(snap, d.owner)}</span>
                <strong>{d.title}</strong>
              </button>
            </li>
          ))}
        </ul>
        {docs.length === 0 && <p className="muted small">Notes are written by anyone in the room. A page is HTML only its author can change. Both live and end with the room.</p>}
      </div>
      <div className="tool-main">{doc ? <DocEditor key={doc.id} doc={doc} space={space} snap={snap} onGone={() => setSel(null)} /> : <p className="muted">Pick one, or make a new note or page.</p>}</div>
    </div>
  );
}

function DocEditor({ doc, space, snap, onGone }: Readonly<{ doc: Doc; space: Space; snap: Snapshot; onGone: () => void }>) {
  const mine = doc.owner === snap.me || snap.state.hostId === snap.me;
  const canEdit = doc.kind === "note" || mine;
  const [title, setTitle] = useState(doc.title);
  const [body, setBody] = useState(doc.body);
  const saved = useRef({ title: doc.title, body: doc.body });
  // Someone else's change arrives while we are not typing: show it.
  useEffect(() => {
    if (doc.rev && (doc.title !== saved.current.title || doc.body !== saved.current.body) && title === saved.current.title && body === saved.current.body) {
      saved.current = { title: doc.title, body: doc.body };
      setTitle(doc.title);
      setBody(doc.body);
    }
  }, [doc.rev]); // eslint-disable-line react-hooks/exhaustive-deps
  // Save a moment after the last keystroke.
  useEffect(() => {
    if (!canEdit || (title === saved.current.title && body === saved.current.body)) return;
    const t = setTimeout(() => {
      const err = space.saveDoc(doc.id, doc.kind, title, body);
      if (err) notify(err, "error");
      else saved.current = { title, body };
    }, 700);
    return () => clearTimeout(t);
  }, [title, body, canEdit, space, doc.id, doc.kind]);
  const limit = doc.kind === "page" ? LIMITS.pageChars : LIMITS.noteChars;
  const remove = async () => {
    if (await ask({ title: `Delete "${doc.title}"?`, lines: ["It is removed for everyone in the room."], confirm: "Delete", danger: true })) {
      space.deleteDoc(doc.id);
      onGone();
    }
  };
  const recent = doc.editor !== snap.me && Date.now() - doc.ts < 6000;
  return (
    <div className="tool-col">
      <div className="row">
        <input aria-label="Title" className="grow" value={title} maxLength={LIMITS.titleChars} disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} />
        {(doc.owner === snap.me || snap.state.hostId === snap.me) && (
          <button className="small-btn danger" onClick={() => void remove()}>
            Delete
          </button>
        )}
      </div>
      <p className="muted small">
        {doc.kind === "page" ? `A page by ${nameOf(snap, doc.owner)}${canEdit ? "" : ". Only they can change it."}` : `A note anyone can edit. Last change by ${nameOf(snap, doc.editor)}.`}
        {recent ? ` ${nameOf(snap, doc.editor)} is editing…` : ""}
      </p>
      {doc.kind === "note" ? (
        <textarea className="doc-text" aria-label="Note" value={body} maxLength={limit} onChange={(e) => setBody(e.target.value)} />
      ) : (
        <div className="page-split">
          {canEdit && <textarea className="doc-text" aria-label="Page HTML" spellCheck={false} value={body} maxLength={limit} onChange={(e) => setBody(e.target.value)} />}
          <iframe className="page-frame" title={doc.title} sandbox="" referrerPolicy="no-referrer" srcDoc={pageDocument(canEdit ? body : doc.body)} />
        </div>
      )}
      <p className="muted small">{body.length.toLocaleString()} of {limit.toLocaleString()} characters</p>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------- polls

function PollsTab({ space, snap }: Readonly<{ space: Space; snap: Snapshot }>) {
  const polls = [...snap.state.tools.polls.values()].reverse();
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState(["", ""]);
  const create = () => {
    const err = space.newPoll(q, opts);
    if (err) return notify(err, "error");
    setQ("");
    setOpts(["", ""]);
  };
  return (
    <div className="tool-split">
      <div className="tool-side">
        <h4>New poll</h4>
        <input aria-label="Poll question" placeholder="Question" value={q} maxLength={LIMITS.pollQuestion} onChange={(e) => setQ(e.target.value)} />
        {opts.map((o, i) => (
          <input key={i} aria-label={`Option ${i + 1}`} placeholder={`Option ${i + 1}`} value={o} maxLength={LIMITS.optionChars} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} />
        ))}
        <div className="row">
          {opts.length < LIMITS.pollOptions && (
            <button className="small-btn" onClick={() => setOpts([...opts, ""])}>
              Add option
            </button>
          )}
          <button className="small-btn primary" onClick={create}>
            Start poll
          </button>
        </div>
      </div>
      <div className="tool-main">
        {polls.length === 0 && <p className="muted">No polls yet. Start one on the left; everyone in the room can vote, once, and change their mind until it ends.</p>}
        {polls.map((p) => {
          const { counts, total } = tally(p);
          const mine = p.votes.get(snap.me);
          return (
            <section key={p.id} className="poll" aria-label={p.q}>
              <h4>{p.q}</h4>
              <p className="muted small">by {nameOf(snap, p.author)} · {total} {total === 1 ? "vote" : "votes"}{p.ended ? " · ended" : ""}</p>
              {p.opts.map((o, i) => (
                <button key={i} className={`poll-opt ${mine === i ? "mine" : ""}`} disabled={p.ended} aria-pressed={mine === i} onClick={() => space.vote(p.id, i)}>
                  <span className="poll-bar" style={{ width: `${total ? (counts[i] / total) * 100 : 0}%` }} />
                  <span className="poll-label">{o}</span>
                  <span className="poll-count">{counts[i]}</span>
                </button>
              ))}
              {!p.ended && (p.author === snap.me || snap.state.hostId === snap.me) && (
                <button className="small-btn" onClick={() => space.endPoll(p.id)}>
                  End poll
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------- board

const W = 1000;
const H = 600;

function BoardTab({ space, snap }: Readonly<{ space: Space; snap: Snapshot }>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(0);
  const [size, setSize] = useState(4);
  const live = useRef<number[] | null>(null);
  const strokes = snap.state.tools.strokes;

  const paint = (extra?: { c: number; w: number; pts: number[] }) => {
    const g = canvas.current?.getContext("2d");
    if (!g) return;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, W, H);
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const s of [...strokes, ...(extra ? [extra] : [])]) {
      g.strokeStyle = g.fillStyle = PALETTE[s.c];
      g.lineWidth = s.w;
      const p = s.pts;
      if (p.length === 2) {
        g.beginPath();
        g.arc((p[0] / 1000) * W, (p[1] / 1000) * H, s.w / 2, 0, Math.PI * 2);
        g.fill();
        continue;
      }
      g.beginPath();
      g.moveTo((p[0] / 1000) * W, (p[1] / 1000) * H);
      for (let i = 2; i < p.length; i += 2) g.lineTo((p[i] / 1000) * W, (p[i + 1] / 1000) * H);
      g.stroke();
    }
  };
  useEffect(() => paint(), [strokes]); // eslint-disable-line react-hooks/exhaustive-deps

  const at = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [Math.round(Math.min(1000, Math.max(0, ((e.clientX - r.left) / r.width) * 1000))), Math.round(Math.min(1000, Math.max(0, ((e.clientY - r.top) / r.height) * 1000)))];
  };
  const down = (e: React.PointerEvent) => {
    canvas.current!.setPointerCapture(e.pointerId);
    live.current = at(e);
    paint({ c: color, w: size, pts: live.current });
  };
  const move = (e: React.PointerEvent) => {
    const pts = live.current;
    if (!pts) return;
    const [x, y] = at(e);
    if (Math.hypot(x - pts[pts.length - 2], y - pts[pts.length - 1]) < 3) return; // thin the line as it is drawn
    pts.push(x, y);
    paint({ c: color, w: size, pts });
  };
  const up = () => {
    let pts = live.current;
    live.current = null;
    if (!pts) return;
    if (pts.length / 2 > LIMITS.strokePoints) {
      const keep = LIMITS.strokePoints;
      const thin: number[] = [];
      for (let i = 0; i < keep; i++) {
        const j = Math.round((i * (pts.length / 2 - 1)) / (keep - 1)) * 2;
        thin.push(pts[j], pts[j + 1]);
      }
      pts = thin;
    }
    space.drawStroke(color, size, pts);
  };
  const clear = async () => {
    if (await ask({ title: "Clear the board for everyone?", lines: ["Everything drawn so far is erased."], confirm: "Clear", danger: true })) space.clearBoard();
  };
  const save = () => canvas.current?.toBlob((b) => {
    if (!b) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = "board.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  return (
    <div className="tool-col">
      <div className="row wrap board-bar">
        {PALETTE.map((c, i) => (
          <button key={c} className={`dot ${i === color ? "on" : ""}`} style={{ background: c, borderColor: i === color ? "var(--accent)" : "var(--border)" }} aria-label={i === PALETTE.length - 1 ? "Eraser" : `Colour ${i + 1}`} aria-pressed={i === color} onClick={() => setColor(i)} />
        ))}
        <label className="row muted small">
          Size
          <input type="range" aria-label="Brush size" min={1} max={24} value={size} onChange={(e) => setSize(Number(e.target.value))} style={{ width: 110, flex: "none" }} />
        </label>
        <span className="push-right row">
          <button className="small-btn" onClick={save}>
            Save as picture
          </button>
          <button className="small-btn danger" onClick={() => void clear()}>
            Clear
          </button>
        </span>
      </div>
      <canvas ref={canvas} className="board" width={W} height={H} aria-label="Drawing board" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      <p className="muted small">Everyone draws on the same paper. A stroke appears for others when you lift the pen. {strokes.length} of {LIMITS.strokes} strokes used.</p>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------- doors

function DoorsTab({ space, snap }: Readonly<{ space: Space; snap: Snapshot }>) {
  const doors = [...snap.state.tools.portals.values()];
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const here = snap.manual?.invite ?? location.href;
  const add = () => {
    const err = space.addPortal(url, label);
    if (err) return notify(err, "error");
    setUrl("");
    setLabel("");
  };
  return (
    <div className="tool-col">
      <p className="muted small">A door is a link to another Deca room, so rooms can lead to each other. It opens in a new tab and leaves this room as it is. Anyone here can add one.</p>
      <ul className="hits">
        {doors.map((d) => (
          <li key={d.id} className="row">
            <a className="hit grow" href={d.url} target="_blank" rel="noopener noreferrer">
              <strong>{d.label}</strong>
              <span className="muted small">added by {nameOf(snap, d.author)} · {d.url}</span>
            </a>
            {(d.author === snap.me || snap.state.hostId === snap.me) && (
              <button className="small-btn danger" aria-label={`Remove door ${d.label}`} onClick={() => space.removePortal(d.id)}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {doors.length === 0 && <p className="muted">No doors yet.</p>}
      <h4>Add a door</h4>
      <input aria-label="Link to a room" placeholder="Link to a Deca room (https://…/#/s/…)" value={url} onChange={(e) => setUrl(e.target.value)} />
      <input aria-label="Door name" placeholder="Name (optional)" value={label} maxLength={LIMITS.labelChars} onChange={(e) => setLabel(e.target.value)} />
      <div className="row">
        <button className="small-btn primary" onClick={add}>
          Add door
        </button>
        <button className="small-btn" onClick={() => setUrl(here)} title="Fill in this room's own link, so people in another room can find their way back here">
          Use this room's link
        </button>
      </div>
    </div>
  );
}
