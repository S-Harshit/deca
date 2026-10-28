// The workspace: a pane docked beside the chat (a sheet on a phone) with the room's shared things: notes, polls and a
// drawing board. The chat stays visible and usable next to it. Loaded only when opened (React.lazy in App.tsx).
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Snapshot, Space } from "../space";
import { notify } from "../toast";
import { LIMITS, PALETTE, tally, type Doc } from "../tools";
import type { Collab } from "../collab";
import { openTool, type ToolTab } from "../toolsDialog";
import { ask } from "../confirm";

const TABS: { id: ToolTab; label: string }[] = [
  { id: "docs", label: "Notes" },
  { id: "polls", label: "Polls" },
  { id: "board", label: "Board" },
];

const WS_MIN = 320;
const WS_KEY = "deca.ws";
const wsLoad = (): { w: number | null; max: boolean } => {
  try {
    const v = JSON.parse(localStorage.getItem(WS_KEY) ?? "{}");
    return { w: typeof v.w === "number" ? v.w : null, max: v.max === true };
  } catch {
    return { w: null, max: false };
  }
};

export default function Workspace({ space, snap, tab, focus }: Readonly<{ space: Space; snap: Snapshot; tab: ToolTab; focus: string | null }>) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && !(e.target instanceof HTMLElement && e.target.closest("[role=alertdialog]")) && openTool(null);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // The pane can be dragged wider or narrower by its left edge, and maximised over the chat; both are remembered on this device.
  const [view, setView] = useState(wsLoad);
  const aside = useRef<HTMLElement>(null);
  const change = (next: { w: number | null; max: boolean }) => {
    setView(next);
    try {
      localStorage.setItem(WS_KEY, JSON.stringify(next));
    } catch {
      /* private window: the size just is not remembered */
    }
  };
  const clamp = (n: number) => Math.round(Math.min(window.innerWidth * 0.85, Math.max(WS_MIN, n)));
  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const grip = e.currentTarget;
    const right = aside.current?.getBoundingClientRect().right ?? window.innerWidth;
    grip.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => change({ w: clamp(right - m.clientX), max: false });
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  };
  const nudge = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const cur = aside.current?.getBoundingClientRect().width ?? 480;
    if (e.key === "ArrowLeft") change({ w: clamp(cur + 24), max: false });
    else if (e.key === "ArrowRight") change({ w: clamp(cur - 24), max: false });
    else return;
    e.preventDefault();
  };
  return (
    <aside ref={aside} className={`workspace ${view.max ? "ws-max" : ""}`} aria-label="Workspace" style={view.w && !view.max ? { width: view.w } : undefined}>
      <div className="ws-grip" role="separator" aria-orientation="vertical" aria-label="Resize workspace" tabIndex={0} title="Drag to resize, double-click to reset" onPointerDown={drag} onKeyDown={nudge} onDoubleClick={() => change({ w: null, max: false })} />
      <header className="ws-head">
        <div className="ws-tabs" role="tablist" aria-label="Workspace">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`ws-tab ${tab === t.id ? "on" : ""}`} onClick={() => openTool(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="row">
          <button className="icon-btn small ws-maxbtn" aria-label={view.max ? "Restore workspace size" : "Maximise workspace"} aria-pressed={view.max} title={view.max ? "Restore size" : "Maximise (hides the chat)"} onClick={() => change({ ...view, max: !view.max })}>
            {view.max ? "❐" : "▢"}
          </button>
          <button className="icon-btn small" aria-label="Close workspace" title="Close (Esc)" onClick={() => openTool(null)}>
            ✕
          </button>
        </div>
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

// ------------------------------------------------------------------------------------------------------------- notes

function DocsTab({ space, snap, focus }: Readonly<{ space: Space; snap: Snapshot; focus: string | null }>) {
  const docs = [...snap.state.tools.docs.values()].sort((a, b) => b.ts - a.ts);
  const [sel, setSel] = useState<string | null>(focus ?? docs[0]?.id ?? null);
  useEffect(() => {
    if (focus) setSel(focus);
  }, [focus]);
  const doc = snap.state.tools.docs.get(sel ?? "") ?? null;
  const create = () => {
    const id = space.newToolId();
    const err = space.saveDoc(id, "Untitled note");
    if (err) notify(err, "error");
    else setSel(id);
  };
  return (
    <div className="ws-docs">
      <div className="ws-list">
        <div className="ws-actions">
          <button className="small-btn primary" onClick={create}>
            + Note
          </button>
        </div>
        <ul className="ws-items">
          {docs.map((d) => (
            <li key={d.id}>
              <button className={`ws-item ${d.id === sel ? "on" : ""}`} onClick={() => setSel(d.id)}>
                <strong>{d.title}</strong>
                <span className="muted small">by {nameOf(snap, d.owner)}</span>
              </button>
            </li>
          ))}
        </ul>
        {docs.length === 0 && <p className="muted small">A note is written by everyone together, live: two people typing at once both keep their words. It ends with the room.</p>}
      </div>
      <div className="ws-main">{doc ? <NoteEditor key={doc.id} doc={doc} space={space} snap={snap} onGone={() => setSel(null)} /> : <p className="muted ws-empty">Pick a note or page, or make a new one.</p>}</div>
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
      space.saveDoc(doc.id, title);
    }, 600);
    return () => clearTimeout(t);
  }, [title, doc.id, space]);
  const remove = async () => {
    if (await ask({ title: `Delete "${doc.title}"?`, lines: ["It is removed for everyone in the room."], confirm: "Delete", danger: true })) {
      space.deleteDoc(doc.id);
      onGone();
    }
  };
  return (
    <div className="ws-dochead">
      <div className="row">
        <input aria-label="Title" className="grow" value={title} maxLength={LIMITS.titleChars} onChange={(e) => setTitle(e.target.value)} />
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

/** Typing here merges with everyone else's typing (collab.ts); this keeps the caret where it was when other people's changes land around it. */
function SharedText({ id, space, cap, className, label, placeholder }: Readonly<{ id: string; space: Space; cap: number; className: string; label: string; placeholder?: string }>) {
  const [text, setText] = useState(() => space.docText(id));
  const [ready, setReady] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const [, tick] = useState(0);
  const engine = useRef<Collab | null>(null);
  useEffect(() => {
    let off = () => {};
    let gone = false;
    void space.loadCollab().then((c) => {
      if (gone) return;
      engine.current = c;
      const now = c.text(id);
      setText(now);
      setReady(true);
      off = c.watch(id, (delta, local) => {
        const next = c.text(id);
        if (!local && ta.current) {
          const shift = (i: number) => {
            let at = 0;
            let out = i;
            for (const op of delta) {
              if (op.retain) at += op.retain;
              else if (typeof op.insert === "string") {
                if (at <= i) out += op.insert.length; // text arriving at the caret pushes it right
              } else if (op.delete) {
                if (at < i) out -= Math.min(op.delete, i - at);
                at += op.delete;
              }
            }
            return Math.max(0, out);
          };
          const sel: [number, number] = [shift(ta.current.selectionStart), shift(ta.current.selectionEnd)];
          // Written to the box right now, not after React renders: a key pressed in between must be measured against the merged text.
          ta.current.value = next;
          if (document.activeElement === ta.current) ta.current.setSelectionRange(sel[0], sel[1]);
        }
        setText(next);
      });
    });
    return () => {
      gone = true;
      off();
    };
  }, [id, space]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1500); // lets "is typing" expire
    return () => clearInterval(t);
  }, []);
  const typing = space.typingIn(id);
  return (
    <>
      <textarea
        ref={ta}
        className={className}
        aria-label={label}
        placeholder={ready ? placeholder : "Loading..."}
        spellCheck={false}
        value={text}
        maxLength={cap}
        disabled={!ready}
        onChange={(e) => {
          setText(e.target.value);
          engine.current?.set(id, e.target.value); // synchronous: it is diffed against exactly the text the person was looking at
        }}
      />
      <p className="muted small ws-typing" aria-live="polite">
        {typing.length ? `${typing.join(", ")} ${typing.length === 1 ? "is" : "are"} typing` : `${text.length.toLocaleString()} of ${cap.toLocaleString()} characters`}
      </p>
    </>
  );
}

/** A note is one shared text: everyone types in it at once, in any place, and nothing anyone writes is lost. */
function NoteEditor({ doc, space, snap, onGone }: Readonly<{ doc: Doc; space: Space; snap: Snapshot; onGone: () => void }>) {
  return (
    <div className="ws-col">
      <DocHead doc={doc} space={space} snap={snap} onGone={onGone} note="A note everyone edits together, live. Two people typing at once both keep their words." />
      <div className="note">
        <SharedText id={doc.id} space={space} cap={LIMITS.noteChars} className="note-text" label="Note" placeholder="Start writing." />
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

