// The workspace: a pane docked beside the chat (a sheet on a phone) with the room's shared things: notes and pages, polls and a
// drawing board. The chat stays visible and usable next to it. Loaded only when opened (React.lazy in App.tsx).
import { useEffect, useRef, useState } from "react";
import type { Snapshot, Space } from "../space";
import { notify } from "../toast";
import { LIMITS, PALETTE, between, noteBlocks, pageDocument, tally, type Doc } from "../tools";
import { openTool, type ToolTab } from "../toolsDialog";
import { ask } from "../confirm";

const TABS: { id: ToolTab; label: string }[] = [
  { id: "docs", label: "Notes & pages" },
  { id: "polls", label: "Polls" },
  { id: "board", label: "Board" },
];

export default function Workspace({ space, snap, tab, focus }: Readonly<{ space: Space; snap: Snapshot; tab: ToolTab; focus: string | null }>) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && !(e.target instanceof HTMLElement && e.target.closest("[role=alertdialog]")) && openTool(null);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <aside className="workspace" aria-label="Workspace">
      <header className="ws-head">
        <div className="ws-tabs" role="tablist" aria-label="Workspace">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`ws-tab ${tab === t.id ? "on" : ""}`} onClick={() => openTool(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <button className="icon-btn small" aria-label="Close workspace" title="Close (Esc)" onClick={() => openTool(null)}>
          ✕
        </button>
      </header>
      <div className="ws-body">
        {tab === "docs" && <DocsTab space={space} snap={snap} focus={focus} />}
        {tab === "polls" && <PollsTab space={space} snap={snap} />}
        {tab === "board" && <BoardTab space={space} snap={snap} />}
      </div>
    </aside>
  );
}

const nameOf = (snap: Snapshot, id: string) => (id === snap.me ? "you" : (snap.state.members.get(id)?.name ?? "someone"));

// -------------------------------------------------------------------------------------------------- notes and pages

const PAGE_START = `<h1>My page</h1>\n<p>Write HTML here. Everyone in the room sees it, in a locked frame: no scripts and nothing loaded from outside.</p>\n<style>body{font-family:sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.5}</style>\n`;

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
    <div className="ws-docs">
      <div className="ws-list">
        <div className="ws-actions">
          <button className="small-btn primary" onClick={() => create("note")}>
            + Note
          </button>
          <button className="small-btn" onClick={() => create("page")}>
            + Page
          </button>
        </div>
        <ul className="ws-items">
          {docs.map((d) => (
            <li key={d.id}>
              <button className={`ws-item ${d.id === sel ? "on" : ""}`} onClick={() => setSel(d.id)}>
                <strong>{d.title}</strong>
                <span className="muted small">
                  {d.kind === "page" ? "Page" : "Note"} · {nameOf(snap, d.owner)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {docs.length === 0 && <p className="muted small">A note is written by everyone together, paragraph by paragraph. A page is HTML only its author can change. Both end with the room.</p>}
      </div>
      <div className="ws-main">{doc ? (doc.kind === "note" ? <NoteEditor key={doc.id} doc={doc} space={space} snap={snap} onGone={() => setSel(null)} /> : <PageEditor key={doc.id} doc={doc} space={space} snap={snap} onGone={() => setSel(null)} />) : <p className="muted ws-empty">Pick a note or page, or make a new one.</p>}</div>
    </div>
  );
}

function DocHead({ doc, space, snap, onGone, note }: Readonly<{ doc: Doc; space: Space; snap: Snapshot; onGone: () => void; note: string }>) {
  const mine = doc.owner === snap.me || snap.state.hostId === snap.me;
  const [title, setTitle] = useState(doc.title);
  const saved = useRef(doc.title);
  useEffect(() => {
    if (title === saved.current) return;
    const t = setTimeout(() => {
      saved.current = title;
      space.saveDoc(doc.id, doc.kind, title, doc.body);
    }, 600);
    return () => clearTimeout(t);
  }, [title, doc.id, doc.kind, doc.body, space]);
  const remove = async () => {
    if (await ask({ title: `Delete "${doc.title}"?`, lines: ["It is removed for everyone in the room."], confirm: "Delete", danger: true })) {
      space.deleteDoc(doc.id);
      onGone();
    }
  };
  return (
    <div className="ws-dochead">
      <div className="row">
        <input aria-label="Title" className="grow" value={title} maxLength={LIMITS.titleChars} disabled={doc.kind === "page" && !mine} onChange={(e) => setTitle(e.target.value)} />
        {mine && (
          <button className="small-btn danger" onClick={() => void remove()}>
            Delete
          </button>
        )}
      </div>
      <p className="muted small">{note}</p>
    </div>
  );
}

/** A page is its author's HTML, shown beside the editor in a frame with every permission off. */
function PageEditor({ doc, space, snap, onGone }: Readonly<{ doc: Doc; space: Space; snap: Snapshot; onGone: () => void }>) {
  const canEdit = doc.owner === snap.me || snap.state.hostId === snap.me;
  const [body, setBody] = useState(doc.body);
  const saved = useRef(doc.body);
  useEffect(() => {
    if (canEdit && body === saved.current) setBody(doc.body); // someone else changed it (the host) while we were not typing
    saved.current = canEdit && body !== saved.current ? saved.current : doc.body;
  }, [doc.rev]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!canEdit || body === saved.current) return;
    const t = setTimeout(() => {
      const err = space.saveDoc(doc.id, "page", doc.title, body);
      if (err) notify(err, "error");
      else saved.current = body;
    }, 700);
    return () => clearTimeout(t);
  }, [body, canEdit, space, doc.id, doc.title]);
  return (
    <div className="ws-col">
      <DocHead doc={doc} space={space} snap={snap} onGone={onGone} note={`A page by ${nameOf(snap, doc.owner)}${canEdit ? "" : ". Only they can change it."}`} />
      <div className="page-split">
        {canEdit && <textarea className="doc-text" aria-label="Page HTML" spellCheck={false} value={body} maxLength={LIMITS.pageChars} onChange={(e) => setBody(e.target.value)} />}
        <iframe className="page-frame" title={doc.title} sandbox="" referrerPolicy="no-referrer" srcDoc={pageDocument(canEdit ? body : doc.body)} />
      </div>
      {canEdit && <p className="muted small">{body.length.toLocaleString()} of {LIMITS.pageChars.toLocaleString()} characters</p>}
    </div>
  );
}

type Local = { key: string; text: string; dirty: boolean; until: number };

/**
 * A note is a list of paragraphs, each saved on its own. Two people typing in different paragraphs never overwrite each other, and
 * new paragraphs from both sides slot in by their order keys. Only if two people change the very same paragraph at the same moment
 * does the later save win (the other sees their paragraph change, nothing else is lost).
 */
function NoteEditor({ doc, space, snap, onGone }: Readonly<{ doc: Doc; space: Space; snap: Snapshot; onGone: () => void }>) {
  const remote = noteBlocks(doc);
  // What the room holds for this note, as one string: it changes whenever any paragraph does, even one that arrives out of order.
  const signature = remote.map((b) => `${b.id}:${b.key}:${b.ts}:${b.text}`).join("\u0001");
  const [local, setLocal] = useState<Map<string, Local>>(() => new Map());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const focusNext = useRef<{ id: string; pos: number } | null>(null);
  const area = useRef(new Map<string, HTMLTextAreaElement>());
  const blank = useRef({ id: space.newToolId(), key: between() }); // the first paragraph of an empty note, until someone types in it

  // Follow other people's changes, except in paragraphs this person has unsaved edits in.
  useEffect(() => {
    setLocal((cur) => {
      const next = new Map(cur);
      const seen = new Set<string>();
      for (const b of remote) {
        seen.add(b.id);
        const l = next.get(b.id);
        if (!l || !l.dirty) next.set(b.id, { key: b.key, text: b.text, dirty: false, until: 0 });
      }
      for (const [id, l] of next) if (!seen.has(id) && !l.dirty && l.until < Date.now()) next.delete(id); // removed by someone else
      return next;
    });
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = (() => {
    const list = [...local].map(([id, l]) => ({ id, key: l.key, text: l.text }));
    if (!list.length) list.push({ id: blank.current.id, key: blank.current.key, text: "" });
    return list.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : 1));
  })();

  const save = (id: string, key: string, text: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    space.setBlock(doc.id, id, key, text);
    setLocal((cur) => new Map(cur).set(id, { key, text, dirty: false, until: Date.now() + 4000 }));
  };
  const edit = (id: string, key: string, text: string) => {
    setLocal((cur) => new Map(cur).set(id, { key, text, dirty: true, until: Date.now() + 4000 }));
    clearTimeout(timers.current.get(id));
    timers.current.set(id, setTimeout(() => save(id, key, text), 450));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const f = focusNext.current;
    const el = f && area.current.get(f.id);
    if (f && el) {
      el.focus();
      el.setSelectionRange(f.pos, f.pos);
      focusNext.current = null;
    }
  });

  const keyDown = (i: number, e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const r = rows[i];
    const el = e.currentTarget;
    const at = el.selectionStart;
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault(); // a new paragraph, taking the text after the cursor with it
      const id = space.newToolId();
      const key = between(r.key, rows[i + 1]?.key);
      save(r.id, r.key, r.text.slice(0, at));
      setLocal((cur) => new Map(cur).set(id, { key, text: r.text.slice(at), dirty: true, until: Date.now() + 4000 }));
      timers.current.set(id, setTimeout(() => save(id, key, r.text.slice(at)), 120));
      focusNext.current = { id, pos: 0 };
    } else if (e.key === "Backspace" && at === 0 && el.selectionEnd === 0 && i > 0) {
      e.preventDefault(); // join with the paragraph above
      const prev = rows[i - 1];
      save(prev.id, prev.key, prev.text + r.text);
      clearTimeout(timers.current.get(r.id));
      space.deleteBlock(doc.id, r.id, r.key);
      setLocal((cur) => {
        const n = new Map(cur);
        n.delete(r.id);
        return n;
      });
      focusNext.current = { id: prev.id, pos: prev.text.length };
    } else if (e.key === "ArrowUp" && !el.value.slice(0, at).includes("\n") && i > 0 && el.selectionStart === el.selectionEnd && at < (el.value.indexOf("\n") + 1 || el.value.length + 1)) {
      e.preventDefault();
      area.current.get(rows[i - 1].id)?.focus();
    } else if (e.key === "ArrowDown" && !el.value.slice(at).includes("\n") && i < rows.length - 1) {
      e.preventDefault();
      area.current.get(rows[i + 1].id)?.focus();
    }
  };

  const recent = (id: string) => {
    const b = doc.blocks.get(id);
    return b && b.editor !== snap.me && Date.now() - b.ts < 4000 ? nameOf(snap, b.editor) : "";
  };
  return (
    <div className="ws-col">
      <DocHead doc={doc} space={space} snap={snap} onGone={onGone} note={`A note everyone edits together, paragraph by paragraph. Last change by ${nameOf(snap, doc.editor)}.`} />
      <div className="note" aria-label="Note">
        {rows.map((r, i) => (
          <div key={r.id} className="para">
            {recent(r.id) && <span className="para-who">{recent(r.id)}</span>}
            <textarea
              ref={(el) => {
                if (el) {
                  area.current.set(r.id, el);
                  el.style.height = "auto";
                  el.style.height = `${el.scrollHeight}px`;
                } else area.current.delete(r.id);
              }}
              rows={1}
              aria-label={`Paragraph ${i + 1}`}
              value={r.text}
              maxLength={LIMITS.blockChars}
              placeholder={i === 0 && rows.length === 1 ? "Start writing. Enter starts a new paragraph." : ""}
              onChange={(e) => edit(r.id, r.key, e.target.value)}
              onKeyDown={(e) => keyDown(i, e)}
            />
          </div>
        ))}
      </div>
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
    <div className="ws-polls">
      <div className="ws-form">
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
        <p className="muted small">You can also type /poll Question | option | option in the chat.</p>
      </div>
      {polls.length === 0 && <p className="muted">No polls yet. Everyone in the room can vote, once, and change their mind until it ends.</p>}
      {polls.map((p) => {
        const { counts, total } = tally(p);
        const mine = p.votes.get(snap.me);
        return (
          <section key={p.id} className="poll" aria-label={p.q}>
            <h4>{p.q}</h4>
            <p className="muted small">
              by {nameOf(snap, p.author)} · {total} {total === 1 ? "vote" : "votes"}
              {p.ended ? " · ended" : ""}
            </p>
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
    <div className="ws-col">
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

