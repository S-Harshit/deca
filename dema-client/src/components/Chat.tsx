import {
  useCallback,
  useEffect,
  useLayoutEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { MAX_FILE, rpsOutcome, type Hand, type SpaceEvent } from "../log";
import type { ArchiveData } from "../archive";
import type { ArchiveView, Snapshot, Space, Transfer } from "../space";
import { openAsWindow, pageShare } from "../openWindow";
import { setCodeDialog } from "../codeDialog";
import { runnerOn, setRunner } from "../runner";
import { usePrefsValue } from "../theme";
import { notify } from "../toast";
import { nameColor } from "./colors";
import { Icon } from "./Icons";
import { isBlankMessage, safeWebUrl } from "../message";
import { MessageBody } from "./Message";

const mb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const time = (ts: number, clock: "auto" | "12" | "24") =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(clock === "auto" ? {} : { hour12: clock === "12" }) });
const IMAGE = /^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/;
const isImage = (type: unknown) => IMAGE.test(String(type));
const isVideo = (type: unknown) => /^video\/(mp4|webm|ogg|quicktime)$/.test(String(type));
const GROUP_MS = 5 * 60 * 1000;

function shareFiles(space: Space, files: Iterable<File>) {
  for (const f of files) {
    const err = space.offerFile(f);
    if (err) notify(err, "error");
  }
}

type Props = Readonly<{ space: Space; snap: Snapshot; isHost: boolean; inviteLink: string; onInvite: () => void; callBar?: ReactNode }>;

export function Chat({ space, snap, isHost, inviteLink, onInvite, callBar }: Props) {
  useEffect(() => {
    pageShare.handler = (url) => space.sharePage(url);
    return () => {
      pageShare.handler = null;
    };
  }, [space]);
  const [drag, setDrag] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null); // fileId of the image being viewed

  const images = [...snap.archives.flatMap((a) => a.data?.events ?? []), ...snap.state.visible]
    .filter((e) => e.type === "file_offer" && isImage(e.payload.type) && snap.transfers[e.payload.fileId]?.url)
    .map((e) => ({ id: e.payload.fileId as string, name: e.payload.name as string, url: snap.transfers[e.payload.fileId].url! }));
  const viewIndex = images.findIndex((i) => i.id === viewing);

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDrag(true);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    shareFiles(space, Array.from(e.dataTransfer.files));
  };

  return (
    <section
      className="chat"
      aria-label="Chat"
      onDragOver={onDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrag(false)}
      onDrop={onDrop}
    >
      {callBar}
      <SharedPageBar snap={snap} />
      <Timeline space={space} snap={snap} inviteLink={inviteLink} onInvite={onInvite} onView={setViewing} />
      <Composer space={space} snap={snap} isHost={isHost} />
      {drag && (
        <div className="drop-overlay">
          <Icon name="paperclip" size={28} />
          Drop to share (up to {mb(MAX_FILE)})
        </div>
      )}
      {viewIndex >= 0 && (
        <Lightbox items={images} index={viewIndex} onClose={() => setViewing(null)} onIndex={(i) => setViewing(images[i].id)} />
      )}
    </section>
  );
}

function Timeline({
  space,
  snap,
  inviteLink,
  onInvite,
  onView,
}: Readonly<{ space: Space; snap: Snapshot; inviteLink: string; onInvite: () => void; onView: (fileId: string) => void }>) {
  const { state, transfers, me } = snap;
  const { clock } = usePrefsValue();
  const name = (id: string) => state.members.get(id)?.name ?? id;
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const seen = useRef(0);
  const [unseen, setUnseen] = useState(0);
  const count = state.visible.length;
  const alone = snap.settled && [...state.members.values()].filter((m) => m.online).length <= 1;

  const toBottom = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    const grew = count - seen.current;
    seen.current = count;
    if (grew <= 0) return;
    const last = state.visible[count - 1];
    if (stick.current || last.author === me) toBottom();
    else if (last.type === "chat" || last.type === "file_offer") setUnseen((u) => u + grew);
  }, [count, me, state.visible, toBottom]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (stick.current) setUnseen(0);
  };

  const line = (e: SpaceEvent) => {
    switch (e.type) {
      case "joined":
        return `${name(e.author)} joined`;
      case "returned":
        return `${name(e.author)} came back`;
      case "left":
        return `${name(e.payload.peerId)} left`;
      case "kick":
        return `${name(e.payload.peerId)} was removed`;
      case "role_changed":
        return `${name(e.payload.hostId)} is now host`;
      case "horn":
        return `${name(e.author)} sounded the air horn`;
      case "page_share":
        return `${name(e.author)} opened a page for everyone: ${hostOf(e.payload.url)}`;
      case "room_options":
        return e.payload.endsAt === undefined ? "" : e.payload.endsAt ? `${name(e.author)} set this room to end at ${new Date(Number(e.payload.endsAt)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : `${name(e.author)} removed the end time`;
      case "archive_added":
        return `${name(e.author)} added imported history (${String(e.payload.events)} lines)`;
      case "perms_changed":
        return `permissions: chat ${e.payload.chat ? "on" : "off"}, files ${e.payload.files ? "on" : "off"}, music ${e.payload.music === false ? "off" : "on"}`;
      default:
        return e.type;
    }
  };

  const onMedia = useCallback(() => stick.current && toBottom(), [toBottom]);
  let prev: SpaceEvent | null = null;
  const rows = state.visible.map((e) => {
    if (e.type === "chat" && isBlankMessage(String(e.payload.text ?? ""))) return null; // an empty code block from an older client
    if (e.type === "score") return null; // shown only in the leaderboard
    if (e.type === "room_options" && e.payload.endsAt === undefined) return null; // the summary switch has no line of its own
    if (e.type !== "chat" && e.type !== "file_offer" && e.type !== "coin" && e.type !== "rps" && e.type !== "blame") {
      prev = null;
      return (
        <div key={e.id} className="sys">
          {line(e)}
        </div>
      );
    }
    const grouped = !!prev && prev.author === e.author && e.ts - prev.ts < GROUP_MS;
    prev = e;
    const mine = e.author === me;
    // Plain chat lines are the bulk of a long conversation: a memoised row is skipped when nothing about it changed.
    if (e.type === "chat") return <ChatLine key={e.id} e={e} mine={mine} grouped={grouped} name={name(e.author)} clock={clock} onMedia={onMedia} />;
    return (
      <div key={e.id} className={`line ${mine ? "mine" : ""} ${grouped ? "grouped" : ""}`}>
        <span className="t">{time(e.ts, clock)}</span>
        <span className="who" style={{ color: nameColor(e.author) }} title={name(e.author)}>
          {grouped ? "" : mine ? "you" : name(e.author)}
        </span>
        <div className="what">
          {e.type === "coin" && <Coin result={e.payload.result} fresh={snap.fresh.has(e.id)} onDone={() => stick.current && toBottom()} />}
          {e.type === "blame" && <Blame author={e.author} target={e.payload.target} snap={snap} fresh={snap.fresh.has(e.id)} onDone={() => stick.current && toBottom()} />}
          {e.type === "rps" && <Throw e={e} snap={snap} fresh={snap.fresh.has(e.id)} onDone={() => stick.current && toBottom()} />}
          {e.type === "file_offer" && (
            <FileBody
              offer={e}
              transfer={transfers[e.payload.fileId]}
              mine={mine}
              onGet={() => space.requestFile(e)}
              onView={() => onView(e.payload.fileId)}
              onLoad={() => stick.current && toBottom()}
            />
          )}
        </div>
      </div>
    );
  });

  return (
    <div className="timeline-wrap">
      <div className="timeline" ref={scroller} onScroll={onScroll} role="log" aria-live="polite">
        {alone && (
          <div className="invite-card">
            <strong>You're the only one here</strong>
            {snap.manual ? (
              <>
                <span className="muted">No server, so joining takes a short back-and-forth:</span>
                <ol className="steps muted small">
                  <li>
                    <strong>Send this link</strong> to your friend.
                  </li>
                  <li>They open it and get a <strong>code</strong>. They send it back to you.</li>
                  <li>
                    Press <strong>Paste their code</strong> below, then send them the reply code you get.
                  </li>
                </ol>
              </>
            ) : (
              <span className="muted">Share this link to bring people in. Nothing is stored on a server.</span>
            )}
            <div className="row">
              <code className="link">{inviteLink}</code>
              <button className="primary" onClick={onInvite}>
                <Icon name="copy" size={15} /> Copy
              </button>
            </div>
            {snap.manual && (
              <button className="small-btn" onClick={() => setCodeDialog(true)}>
                Paste their code
              </button>
            )}
          </div>
        )}
        {snap.archives.map((a) => (
          <ArchiveSection key={a.ref.aid} view={a} snap={snap} space={space} onView={onView} onLoad={() => stick.current && toBottom()} />
        ))}
        {rows}
      </div>
      {unseen > 0 && (
        <button
          className="new-pill"
          onClick={() => {
            toBottom();
            setUnseen(0);
          }}
        >
          <Icon name="arrowDown" size={14} /> {unseen} new
        </button>
      )}
    </div>
  );
}

const hostOf = (url: unknown) => {
  const href = safeWebUrl(url);
  return href ? new URL(href).hostname : "a page";
};

/**
 * "Open this page for everyone": the latest page someone shared, with one button to open it. It cannot open by itself
 * (browsers only allow a window after a click, and nobody should have pages thrown at them), so the address is shown
 * plainly, with a warning if it uses look-alike international letters.
 */
function SharedPageBar({ snap }: Readonly<{ snap: Snapshot }>) {
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const last = [...snap.state.visible].reverse().find((e) => e.type === "page_share");
  if (!last || gone.has(last.id) || Date.now() - last.ts > 30 * 60 * 1000) return null;
  const href = safeWebUrl(last.payload.url);
  if (!href) return null;
  const u = new URL(href);
  const who = last.author === snap.me ? "You" : (snap.state.members.get(last.author)?.name ?? "Someone");
  const rest = `${u.pathname === "/" ? "" : u.pathname}${u.search}`;
  const hide = () => setGone((g) => new Set(g).add(last.id));
  return (
    <div className="shared-page" role="status">
      <Icon name="users" size={15} />
      <span className="shared-text">
        <strong>{who}</strong> opened a page for everyone: <strong className="shared-host">{u.hostname}</strong>
        <span className="shared-path">{rest.length > 40 ? `${rest.slice(0, 40)}…` : rest}</span>
        {u.hostname.includes("xn--") && <span className="shared-warn"> Uses look-alike international letters: check the address.</span>}
      </span>
      <button
        className="small-btn primary"
        onClick={() => {
          openAsWindow(href);
          hide();
        }}
      >
        Open
      </button>
      <button className="icon-btn small" aria-label="Dismiss" title="Dismiss" onClick={hide}>
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

/** One plain chat line. Props are all stable values, so React skips it while the rest of the room changes. */
const ChatLine = memo(function ChatLine({
  e,
  mine,
  grouped,
  name,
  clock,
  onMedia,
}: Readonly<{ e: SpaceEvent; mine: boolean; grouped: boolean; name: string; clock: "auto" | "12" | "24"; onMedia: () => void }>) {
  return (
    <div className={`line ${mine ? "mine" : ""} ${grouped ? "grouped" : ""}`}>
      <span className="t">{time(e.ts, clock)}</span>
      <span className="who" style={{ color: nameColor(e.author) }} title={name}>
        {grouped ? "" : mine ? "you" : name}
      </span>
      <div className="what">
        <MessageBody text={e.payload.text} onMedia={onMedia} />
      </div>
    </div>
  );
});

/** Imported history: read-only, above the live conversation, clearly marked, never part of the room's log. */
function ArchiveSection({
  view,
  snap,
  space,
  onView,
  onLoad,
}: Readonly<{ view: ArchiveView; snap: Snapshot; space: Space; onView: (fileId: string) => void; onLoad: () => void }>) {
  const { ref, data } = view;
  const { clock } = usePrefsValue();
  const viewer = useRef(onView);
  viewer.current = onView;
  const stableView = useCallback((id: string) => viewer.current(id), []);
  const loader = useRef(onLoad);
  loader.current = onLoad;
  const stableLoad = useCallback(() => loader.current(), []);
  const byName = (id: string) => snap.state.members.get(id)?.name ?? "the host";
  if (!data) {
    return (
      <div className="archive-head" role="status">
        Loading imported history from room {ref.from || "?"} ({ref.events} lines)…
      </div>
    );
  }
  // What can change a row: a line the room already has (hidden), or one of this archive's attachments moving.
  const live = new Set(snap.state.visible.map((e) => e.id));
  const hiddenKey = data.events.filter((e) => live.has(e.id)).map((e) => e.id).join(",");
  const fileKey = data.files.map((f) => (snap.transfers[f.fileId] ? `${snap.transfers[f.fileId].status}:${snap.transfers[f.fileId].received}` : "-")).join("|");
  const when = data.exportedAt ? new Date(data.exportedAt).toLocaleDateString() : "";
  return (
    <section className="archive" aria-label={`Imported history from room ${ref.from}`}>
      <div className="archive-head">
        <strong>Imported history</strong> from room {ref.from || "?"}, exported by {data.exportedBy || "someone"} {when && `on ${when}`}, added by {byName(ref.by)}.
        <div className="muted small">
          Read-only. Every line is signed by its author, so who wrote it is certain; the names are what people called themselves then, so a short id is shown too.
        </div>
      </div>
      <ArchiveRows aid={ref.aid} data={data} hiddenKey={hiddenKey} fileKey={fileKey} clock={clock} transfers={snap.transfers} space={space} onView={stableView} onLoad={stableLoad} />
      <div className="archive-end muted small">end of imported history</div>
    </section>
  );
}

/** The imported lines themselves. Thousands can be on screen, so this only re-renders when its own inputs change. */
const ArchiveRows = memo(
  function ArchiveRows({
    aid,
    data,
    hiddenKey,
    clock,
    transfers,
    space,
    onView,
    onLoad,
  }: Readonly<{
    aid: string;
    data: ArchiveData;
    hiddenKey: string;
    fileKey: string;
    clock: "auto" | "12" | "24";
    transfers: Record<string, Transfer>;
    space: Space;
    onView: (fileId: string) => void;
    onLoad: () => void;
  }>) {
    const hidden = new Set(hiddenKey ? hiddenKey.split(",") : []);
    const nameOf = (id: string) => data.names[id] ?? id.slice(0, 8);
    const files = new Map(data.files.map((f) => [f.fileId, f]));
    const sys = (e: SpaceEvent) => {
      const who = nameOf(e.author);
      if (e.type === "coin") return `${who} flipped a coin: ${e.payload.result}`;
      if (e.type === "rps") return `${who} threw ${e.payload.throw}`;
      if (e.type === "blame") return `${who} blamed ${nameOf(String(e.payload.target))}`;
      return `${who} sounded the air horn`;
    };
    return (
      <>
        {data.events
          .filter((e) => !hidden.has(e.id))
          .map((e) => {
            if (e.type !== "chat" && e.type !== "file_offer") {
              return (
                <div key={e.id} className="sys">
                  {sys(e)}
                </div>
              );
            }
            const meta = files.get(String(e.payload.fileId));
            return (
              <div key={e.id} className="line arch">
                <span className="t">{time(e.ts, clock)}</span>
                <span className="who" style={{ color: nameColor(e.author) }} title={`${nameOf(e.author)} · ${e.author}`}>
                  {nameOf(e.author)} <span className="aid">#{e.author.slice(0, 4)}</span>
                </span>
                <div className="what">
                  {e.type === "chat" && <MessageBody text={e.payload.text} onMedia={onLoad} />}
                  {e.type === "file_offer" &&
                    (meta?.present ? (
                      <FileBody
                        offer={e}
                        transfer={transfers[e.payload.fileId]}
                        mine={false}
                        onGet={() => space.requestArchiveFile(aid, e)}
                        onView={() => onView(e.payload.fileId)}
                        onLoad={onLoad}
                      />
                    ) : (
                      <span className="muted">
                        {String(e.payload.name)} <span className="small">(the file was not included in the export)</span>
                      </span>
                    ))}
                </div>
              </div>
            );
          })}
      </>
    );
  },
  (a, b) => a.data === b.data && a.hiddenKey === b.hiddenKey && a.fileKey === b.fileKey && a.clock === b.clock && a.aid === b.aid,
);

/** A coin flip. A live flip spins for a moment before landing; one from history just shows its result. */
function Coin({ result, fresh, onDone }: Readonly<{ result: "heads" | "tails"; fresh: boolean; onDone: () => void }>) {
  const [done, setDone] = useState(!fresh);
  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => {
      setDone(true);
      onDone();
    }, 1300);
    return () => clearTimeout(t);
  }, [done, onDone]);
  return (
    <div className="coin-row" data-result={done ? result : "flipping"}>
      <span className={`coin ${done ? "landed" : "flipping"}`} aria-hidden="true">
        {done ? (result === "heads" ? "H" : "T") : "?"}
      </span>
      <span>{done ? <>flipped a coin: <strong>{result}</strong></> : "flipping a coin…"}</span>
    </div>
  );
}

/** "Blame someone": a live pick cycles through the people here for a moment, then lands on one. History just shows who. */
function Blame({ author, target, snap, fresh, onDone }: Readonly<{ author: string; target: string; snap: Snapshot; fresh: boolean; onDone: () => void }>) {
  const calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [done, setDone] = useState(!fresh || calm);
  const [shown, setShown] = useState(0);
  const { members } = snap.state;
  const pool = useMemo(() => [...members.values()].filter((m) => m.online).map((m) => m.name), [members]);
  const nameOf = (id: string) => members.get(id)?.name ?? "someone";
  // Say both sides, from the viewer's point of view: "Ann blamed Bob", "you blamed Bob", "Ann blamed you", "you blamed yourself".
  const blamer = author === snap.me ? "You" : nameOf(author);
  const blamed = target === snap.me ? (author === snap.me ? "yourself" : "you") : nameOf(target);
  useEffect(() => {
    if (done) return;
    const spin = setInterval(() => setShown((n) => n + 1), 90);
    const stop = setTimeout(() => {
      setDone(true);
      onDone();
    }, 1400);
    return () => {
      clearInterval(spin);
      clearTimeout(stop);
    };
  }, [done, onDone]);
  return (
    <div className="blame-row" data-state={done ? "landed" : "picking"}>
      <span className="blame-icon" aria-hidden="true">
        👉
      </span>
      <span aria-live="polite">
        {done ? (
          <>
            <strong>{blamer}</strong> blamed <strong>{blamed}</strong>
          </>
        ) : (
          <>
            {blamer} {blamer === "You" ? "are" : "is"} picking who to blame… <span className="blame-spin">{pool[shown % Math.max(1, pool.length)] ?? ""}</span>
          </>
        )}
      </span>
    </div>
  );
}

const HAND_ICON: Record<Hand, string> = { rock: "✊", paper: "✋", scissors: "✌️" };

/**
 * One rock-paper-scissors throw. A live throw shakes for a moment, then shows; an answered pair shows
 * the result on the answering throw. Unanswered throws wait 30 seconds for an opponent.
 */
function Throw({ e, snap, fresh, onDone }: Readonly<{ e: SpaceEvent; snap: Snapshot; fresh: boolean; onDone: () => void }>) {
  const { state, me } = snap;
  const [shown, setShown] = useState(!fresh);
  const [expired, setExpired] = useState(!fresh);
  const hand = e.payload.throw as Hand;
  const otherId = state.rpsPairs.get(e.id);
  const other = otherId ? state.visible.find((v) => v.id === otherId) : undefined;
  const name = (id: string) => (id === me ? "you" : (state.members.get(id)?.name ?? id));

  useEffect(() => {
    if (shown) return;
    const t = setTimeout(() => {
      setShown(true);
      onDone();
    }, 1100);
    return () => clearTimeout(t);
  }, [shown, onDone]);
  useEffect(() => {
    if (expired) return;
    const t = setTimeout(() => setExpired(true), 30000);
    return () => clearTimeout(t);
  }, [expired]);

  let note: React.ReactNode = null;
  if (shown && other && state.rpsSecond.has(e.id)) {
    const r = rpsOutcome(hand, other.payload.throw as Hand);
    note = (
      <strong className="rps-result">
        {HAND_ICON[other.payload.throw as Hand]} {name(other.author)} vs {HAND_ICON[hand]} {name(e.author)}:{" "}
        {r === "draw" ? "a tie, throw again" : `${name(r === "win" ? e.author : other.author)} win${(r === "win" ? e.author : other.author) === me ? "" : "s"}`}
      </strong>
    );
  } else if (shown && other) {
    note = <span className="muted">answered by {name(other.author)}</span>;
  } else if (shown) {
    note = <span className="muted">{expired ? "no one answered" : "waiting for someone to throw…"}</span>;
  }

  return (
    <div className="rps-row" data-state={shown ? "shown" : "throwing"}>
      <span className={`hand ${shown ? "" : "shaking"}`} role="img" aria-label={shown ? hand : "throwing"}>
        {shown ? HAND_ICON[hand] : "✊"}
      </span>
      <span>{shown ? <>threw <strong>{hand}</strong></> : "throwing…"}</span>
      {note}
    </div>
  );
}

function FileBody({
  offer,
  transfer,
  mine,
  onGet,
  onView,
  onLoad,
}: Readonly<{
  offer: SpaceEvent;
  transfer?: Transfer;
  mine: boolean;
  onGet: () => void;
  onView: () => void;
  onLoad: () => void;
}>) {
  const { name, size, type } = offer.payload;
  const pct = transfer && transfer.size ? Math.floor((transfer.received / transfer.size) * 100) : 0;

  if (isImage(type)) {
    if (transfer?.status === "done" && transfer.url) {
      return (
        <div className="image">
          <button className="img-btn" aria-label={`View ${name}`} onClick={onView}>
            <img src={transfer.url} alt={name} onLoad={onLoad} />
          </button>
          <div className="caption muted small">
            {name} · {mb(size)}
          </div>
        </div>
      );
    }
    return (
      <div className="img-ph">
        <Icon name="file" size={22} />
        <div className="grow">
          <div className="ellipsis">{name}</div>
          {transfer && transfer.status !== "failed" ? (
            <div className="progress">
              <span style={{ width: `${transfer.status === "requesting" ? 4 : pct}%` }} />
            </div>
          ) : (
            <div className="muted small">{mb(size)}</div>
          )}
        </div>
        {(!transfer || transfer.status === "failed") && !mine && (
          <button className="small-btn" onClick={onGet}>
            {transfer ? "Retry" : "Load image"}
          </button>
        )}
      </div>
    );
  }

  if (isVideo(type)) {
    return <VideoBody offer={offer} transfer={transfer} mine={mine} onGet={onGet} onLoad={onLoad} />;
  }

  return (
    <div className="file">
      <span className="file-icon">
        <Icon name="file" size={20} />
      </span>
      <div className="grow">
        <div className="ellipsis">{name}</div>
        <div className="muted small">{mb(size)}</div>
      </div>
      {mine && <span className="muted small">shared</span>}
      {!mine && !transfer && (
        <button className="small-btn primary" onClick={onGet}>
          <Icon name="download" size={14} /> Download
        </button>
      )}
      {!mine && transfer?.status === "done" && (
        <a className="button small-btn primary" href={transfer.url} download={transfer.name}>
          <Icon name="check" size={14} /> Save
        </a>
      )}
      {!mine && transfer?.status === "failed" && (
        <button className="small-btn danger" onClick={onGet}>
          Failed · retry
        </button>
      )}
      {!mine && (transfer?.status === "requesting" || transfer?.status === "receiving") && (
        <span className="progress">
          <span style={{ width: `${transfer.status === "requesting" ? 4 : pct}%` }} />
        </span>
      )}
    </div>
  );
}

/**
 * Videos are NOT fetched automatically (unlike images): the sender uploads one full copy per viewer,
 * so a person opts in. Once loaded it is a plain <video> on a local blob, which costs nothing
 * beyond the browser's own decoder.
 */
function VideoBody({
  offer,
  transfer,
  mine,
  onGet,
  onLoad,
}: Readonly<{ offer: SpaceEvent; transfer?: Transfer; mine: boolean; onGet: () => void; onLoad: () => void }>) {
  const { name, size } = offer.payload;
  const [bad, setBad] = useState(false);
  const pct = transfer && transfer.size ? Math.floor((transfer.received / transfer.size) * 100) : 0;

  if (transfer?.status === "done" && transfer.url) {
    return (
      <div className="image">
        <video
          className="chat-video"
          src={transfer.url}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={onLoad}
          onError={() => setBad(true)}
          // one video at a time
          onPlay={(e) => document.querySelectorAll<HTMLVideoElement>("video.chat-video").forEach((v) => v !== e.currentTarget && v.pause())}
        />
        <div className="caption muted small">
          {name} · {mb(size)}
          {bad && (
            <>
              {" "}
              · <span className="error-text">this browser can't play it.</span>{" "}
              <a href={transfer.url} download={transfer.name}>Save it instead</a>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="img-ph">
      <Icon name="video" size={22} />
      <div className="grow">
        <div className="ellipsis">{name}</div>
        {transfer && transfer.status !== "failed" ? (
          <div className="progress">
            <span style={{ width: `${transfer.status === "requesting" ? 4 : pct}%` }} />
          </div>
        ) : (
          <div className="muted small">video · {mb(size)}</div>
        )}
      </div>
      {!mine && (!transfer || transfer.status === "failed") && (
        <button className="small-btn primary" onClick={onGet}>
          {transfer ? "Retry" : "Load video"}
        </button>
      )}
    </div>
  );
}

function Lightbox({
  items,
  index,
  onClose,
  onIndex,
}: Readonly<{ items: { id: string; name: string; url: string }[]; index: number; onClose: () => void; onIndex: (i: number) => void }>) {
  const [zoom, setZoom] = useState(false);
  const item = items[index];

  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      else if (e.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index, items.length, onClose, onIndex]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={item.name} onClick={onClose}>
      <div className="lb-bar" onClick={(e) => e.stopPropagation()}>
        <span className="ellipsis">
          {item.name} <span className="muted">({index + 1}/{items.length})</span>
        </span>
        <div className="row">
          <a className="button icon-btn glass" href={item.url} download={item.name} aria-label="Download image" title="Download">
            <Icon name="download" />
          </a>
          <button className="icon-btn glass" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
      </div>
      {index > 0 && (
        <button
          className="icon-btn glass lb-nav left"
          aria-label="Previous image"
          onClick={(e) => {
            e.stopPropagation();
            onIndex(index - 1);
          }}
        >
          <Icon name="chevronLeft" size={22} />
        </button>
      )}
      <div className={`lb-stage ${zoom ? "zoomed" : ""}`} onClick={(e) => e.stopPropagation()}>
        <img src={item.url} alt={item.name} onClick={() => setZoom((z) => !z)} title={zoom ? "Click to fit" : "Click to zoom"} />
      </div>
      {index < items.length - 1 && (
        <button
          className="icon-btn glass lb-nav right"
          aria-label="Next image"
          onClick={(e) => {
            e.stopPropagation();
            onIndex(index + 1);
          }}
        >
          <Icon name="chevronRight" size={22} />
        </button>
      )}
    </div>
  );
}

function Composer({ space, snap, isHost }: Readonly<{ space: Space; snap: Snapshot; isHost: boolean }>) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const { perms } = snap.state;
  const canChat = isHost || perms.chat;
  const canFile = isHost || perms.files;

  // Where to put the cursor once the next text update has reached the DOM (set by the code button).
  const cursorAt = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + el.offsetHeight - el.clientHeight, 140)}px`; // + border
    if (cursorAt.current !== null) {
      el.focus();
      el.setSelectionRange(cursorAt.current, cursorAt.current);
      cursorAt.current = null;
    }
  }, [text]);

  const flip = () => {
    const err = space.flipCoin();
    if (err) notify(err, "error");
  };
  const rps = () => {
    const err = space.throwRps();
    if (err) notify(err, "error");
  };
  const blame = () => {
    const err = space.blameSomeone();
    if (err) notify(err, "error");
  };

  const [menu, setMenu] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (ev: MouseEvent) => !menuBox.current?.contains(ev.target as Node) && setMenu(false);
    const esc = (ev: globalThis.KeyboardEvent) => ev.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const send = () => {
    if (isBlankMessage(text)) return; // includes a code block that was left empty
    const command = text.trim().toLowerCase();
    // Hidden: not listed anywhere in the UI. A self-playing runner strip for this tab only.
    if (command === "/run" || command === "/run on" || command === "/run off") {
      const want = command === "/run" ? !runnerOn() : command === "/run on";
      if (want && matchMedia("(prefers-reduced-motion: reduce)").matches) notify("Reduced motion is on, so the runner stays off.");
      else setRunner(want);
      setText("");
      return;
    }
    if (command === "/flip" || command === "/rps" || command === "/blame") {
      (command === "/flip" ? flip : command === "/blame" ? blame : rps)(); // typing a command is the same as using the menu
      setText("");
      return;
    }
    space.sendChat(text);
    setText("");
  };

  /** Wrap the selection (or an empty spot) in a ``` fence and park the cursor inside it. */
  const insertFence = () => {
    const el = box.current;
    if (!el) return;
    const { selectionStart: from, selectionEnd: to } = el;
    const picked = text.slice(from, to);
    cursorAt.current = from + 4 + picked.length;
    setText(`${text.slice(0, from)}\`\`\`\n${picked}\n\`\`\`${text.slice(to)}`);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (!files.length || !canFile) return;
    e.preventDefault(); // pasted screenshots become shared images
    shareFiles(space, files);
  };

  return (
    <div className="composer">
      <label className={`icon-btn ${canFile ? "" : "disabled"}`} title={`Attach files (up to ${mb(MAX_FILE)}). You can also drop or paste.`}>
        <Icon name="paperclip" />
        <input
          type="file"
          hidden
          multiple
          disabled={!canFile}
          aria-label="Attach files"
          onChange={(e) => {
            shareFiles(space, Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </label>
      <div className="decider-wrap" ref={menuBox}>
        <button className="icon-btn" type="button" aria-label="Deciders" aria-haspopup="menu" aria-expanded={menu} title="Deciders: coin flip, rock paper scissors, blame" disabled={!canChat} onClick={() => setMenu((m) => !m)}>
          <Icon name="dice" />
        </button>
        {menu && (
          <div className="menu" role="menu" aria-label="Deciders">
            <button role="menuitem" onClick={() => { setMenu(false); flip(); }}>
              <Icon name="coin" size={16} /> Flip a coin <span className="muted small">/flip</span>
            </button>
            <button role="menuitem" onClick={() => { setMenu(false); rps(); }}>
              <span aria-hidden="true">✊</span> Rock paper scissors <span className="muted small">/rps</span>
            </button>
            <button role="menuitem" onClick={() => { setMenu(false); blame(); }}>
              <span aria-hidden="true">👉</span> Blame someone <span className="muted small">/blame</span>
            </button>
          </div>
        )}
      </div>
      <button className="icon-btn" type="button" aria-label="Insert code block" title="Code block (```). Shift+Enter adds a new line." disabled={!canChat} onClick={insertFence}>
        <Icon name="code" />
      </button>
      <textarea
        ref={box}
        rows={1}
        value={text}
        disabled={!canChat}
        placeholder={canChat ? "Write a message…" : "Chat disabled by host"}
        aria-label="Message"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      <button className="primary send" aria-label="Send" title="Send (Enter)" onClick={send} disabled={!canChat || isBlankMessage(text)}>
        <Icon name="send" size={17} />
      </button>
    </div>
  );
}
