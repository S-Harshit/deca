import { EndsIn, RoomSummary } from "./components/RoomEnd";
import { onKonami } from "./konami";
import { useScoresDialog, setScoresDialog } from "./scoresDialog";
import { ScoresDialog } from "./components/ScoresDialog";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { rid } from "./log";
import { Space, type Snapshot } from "./space";
import { PrefsContext, SIDEBAR_MAX, SIDEBAR_MIN, usePrefs, usePrefsApi, usePrefsValue } from "./theme";
import { dismiss, notify, useToasts } from "./toast";
import { CallControls, CallStage, ChatCallBar } from "./components/CallStage";
import { Chat } from "./components/Chat";
import { Avatar } from "./components/Avatar";
import { ConfirmHost } from "./components/ConfirmHost";
import { GamesPanel, type Game } from "./components/GamesPanel";
import { ask } from "./confirm";
import { Icon } from "./components/Icons";
import { Logo } from "./components/Logo";
import { loadIdentity, type Identity } from "./identity";
import { playHorn, unlockAudio } from "./horn";
import { MusicPlayer, NowPlaying } from "./components/MusicPlayer";
import { Members } from "./components/Members";
import { Slot, SlotToggle } from "./slot";
import { listWidgets, registerWidget } from "./widgets";
import { RunnerStrip } from "./components/RunnerStrip";
import { parseManual, type ManualRoute } from "./manualRoute";
import { revealLocalAddress } from "./localNetwork";
import { setRunner, useRunner } from "./runner";
import { useWallpaperImage } from "./wallpaper";
import { ThemePanel } from "./components/ThemePanel";
import "./App.css";

const spaceFromHash = () => /^#\/s\/(.+)$/.exec(location.hash)?.[1] ?? null;
const manualFromHash = () => (location.hash.startsWith("#/m/") ? parseManual(location.hash) : null);
/** Accepts a full invite link or a bare code. */
const parseCode = (v: string) => /#\/s\/([^\s/]+)/.exec(v)?.[1] ?? v.trim().replaceAll(/[^a-z0-9]/gi, "");

function App() {
  const { prefs, update, reset } = usePrefs();
  useWallpaperImage(prefs.wallpaper, prefs.wallRev, useCallback(() => update({ wallpaper: false }), [update]));
  const [spaceId, setSpaceId] = useState(spaceFromHash());
  const [route, setRoute] = useState<ManualRoute | null>(manualFromHash());
  const [name, setName] = useState(sessionStorage.getItem("name") ?? "");
  const [space, setSpace] = useState<Space | null>(null);
  // The identity is a signing key made on first visit; creating it takes a moment (and needs HTTPS and a recent browser).
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [identityFailed, setIdentityFailed] = useState(false);
  useEffect(() => {
    loadIdentity().then(setIdentity, () => setIdentityFailed(true));
  }, []);

  useEffect(() => {
    const onHash = () => {
      setSpaceId(spaceFromHash());
      setRoute(manualFromHash());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!space) return;
    // Closing the tab or navigating away: close connections now so peers see us leave promptly.
    const bye = () => space.leave();
    window.addEventListener("pagehide", bye);
    return () => {
      window.removeEventListener("pagehide", bye);
      space.leave();
    };
  }, [space]);

  const enter = (id: string) => {
    if (!identity || !name.trim() || !id) return;
    sessionStorage.setItem("name", name.trim());
    location.hash = `/s/${id}`;
    setSpace(new Space(id, identity, name.trim()));
  };

  /** A room with no server: `route` is the invite followed, or null when making a new room (we are its host). */
  const enterManual = async (r: ManualRoute | null, reveal = true) => {
    if (!identity || !name.trim()) return;
    const me = identity.peerId;
    const room = r?.room ?? rid().slice(0, 12);
    const hostId = r?.hostId ?? me;
    sessionStorage.setItem("name", name.trim());
    // Before any code is made: lets the browser put its real Wi-Fi address in it (asks for the microphone once; nothing is recorded).
    const mic = reveal ? await revealLocalAddress() : null;
    // The address keeps the way in: the invite we followed (so a refresh can dial that person again), or our own link if we made the room.
    const entry = r ? r.seed : { id: me, name: name.trim() };
    location.hash = `/m/${room}/${entry.id}/${hostId}/${encodeURIComponent(entry.name)}`;
    const created = new Space(room, identity, name.trim(), { hostId, seed: r ? r.seed : null });
    created.holdMic(mic);
    setSpace(created);
  };

  const api = useMemo(() => ({ prefs, update, reset }), [prefs, update, reset]);
  const theme = <ThemePanel prefs={prefs} update={update} reset={reset} />;

  return (
    <PrefsContext.Provider value={api}>
      {space ? (
        <SpaceView
          space={space}
          theme={theme}
          onLeave={() => {
            space.leave();
            setSpace(null);
            location.hash = "";
          }}
          onRejoin={() => {
            const r = manualFromHash();
            const id = spaceFromHash();
            if (!identity || (!id && !r)) return;
            space.leave();
            if (r) setSpace(new Space(r.room, identity, name.trim(), { hostId: r.hostId, seed: r.seed.id === identity.peerId ? null : r.seed }));
            else setSpace(new Space(id!, identity, name.trim()));
          }}
        />
      ) : (
        <Landing name={name} setName={setName} spaceId={spaceId} manualRoute={route} enterManual={enterManual} enter={enter} theme={theme} identityReady={!!identity} identityFailed={identityFailed} />
      )}
      <Toaster />
      <ConfirmHost />
    </PrefsContext.Provider>
  );
}

/** Built for static hosting (GitHub Pages, Vercel): there is no signaling server, only connect by code. */
const STATIC = !!import.meta.env.VITE_STATIC;

function Landing({
  name,
  setName,
  spaceId,
  manualRoute,
  enterManual,
  enter,
  theme,
  identityReady,
  identityFailed,
}: Readonly<{
  name: string;
  setName: (n: string) => void;
  spaceId: string | null;
  manualRoute: ManualRoute | null;
  enterManual: (r: ManualRoute | null, reveal: boolean) => void;
  enter: (id: string) => void;
  theme: React.ReactNode;
  identityReady: boolean;
  identityFailed: boolean;
}>) {
  const { home } = usePrefsValue();
  const [code, setCode] = useState("");
  const [haveCode, setHaveCode] = useState(false);
  // "No server": people join by exchanging short codes. A pasted invite of that kind is recognised without asking.
  const [serverless, setServerless] = useState(STATIC);
  const [sameWifi, setSameWifi] = useState(true);
  const pasted = haveCode ? parseManual(code) : null;
  const joinRoute = manualRoute ?? pasted;
  const invited = !!spaceId || !!manualRoute;
  const target = spaceId ?? (haveCode ? parseCode(code) : "");
  const ready = identityReady && !!name.trim() && (joinRoute ? true : serverless ? !haveCode : !!spaceId || !haveCode || !!target);
  const go = () => {
    if (!ready) return;
    if (joinRoute) enterManual(joinRoute, sameWifi);
    else if (serverless) enterManual(null, sameWifi);
    else enter(target || rid().slice(0, 12));
  };

  const fields = (
    <>
      <label className="field">
        <span>Your name</span>
        <input placeholder="Your display name" value={name} autoFocus maxLength={32} onChange={(e) => setName(e.target.value)} />
      </label>
      {!invited && haveCode && (
        <label className="field">
          <span>Invite link or code</span>
          <input placeholder="Paste an invite link or code" value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
      )}
      <button type="submit" className="primary big" disabled={!ready}>
        {joinRoute ? "Join space (no server)" : serverless ? "Create a space (no server)" : spaceId || haveCode ? "Join space" : "Create a space"}
      </button>
      {(joinRoute || serverless) && (
        <label className="toggle" title="Browsers hide your Wi-Fi address unless the page may use the microphone. Allowing it once lets two devices on the same Wi-Fi connect straight to each other. Nothing is recorded or sent.">
          <input type="checkbox" checked={sameWifi} onChange={(e) => setSameWifi(e.target.checked)} />
          <span>
            Same Wi-Fi? Let my browser share its Wi-Fi address
            <span className="muted small"> (asks for the microphone once, only for this; nothing is recorded)</span>
          </span>
        </label>
      )}
      {(manualRoute || serverless) && (
        <p className="muted small">
          {manualRoute
            ? `${manualRoute.seed.name} invited you without a server. After you join you get a short code to send them; they send one back.`
            : "No server: you connect by exchanging short codes. Good for a few people, or when the usual way is down. Your invite link works for anyone who can reach this page."}
        </p>
      )}
      {identityFailed && (
        <p className="error-text small">This browser can't create a secure identity. Open the site over HTTPS in a recent version of Chrome, Edge, Safari or Firefox.</p>
      )}
      {spaceId && STATIC && <p className="error-text small">This is a link to a room that needs a server, and this site has none. Ask them for a no-server invite link.</p>}
      {!invited && (
        <button type="button" className="ghost" onClick={() => setHaveCode((h) => !h)}>
          {haveCode ? "Create a new space instead" : "I have an invite link"}
        </button>
      )}
      {!invited && !haveCode && !STATIC && (
        <button type="button" className="ghost" onClick={() => setServerless((v) => !v)}>
          {serverless ? "Use a server instead" : "No server? Connect by code"}
        </button>
      )}
    </>
  );
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    go();
  };

  if (home === "classic") {
    return (
      <div className="landing classic">
        <div className="corner">{theme}</div>
        <div className="landing-inner">
          <div className="hero-copy">
            <Logo size={84} animated />
            <h1 className="wordmark">
              deca<span>.</span>
            </h1>
            <p className="tagline">A room you carry in a link.</p>
            <p className="muted">
              Chat, share files and images, hop on a call, and listen to music together. It all travels straight between you: no
              accounts, nothing kept on a server.
            </p>
            <ul className="points">
              <li>
                <Icon name="link" size={16} /> one link brings people in
              </li>
              <li>
                <Icon name="video" size={16} /> video, voice and screen sharing
              </li>
              <li>
                <Icon name="music" size={16} /> YouTube music everyone hears in sync
              </li>
              <li>
                <Icon name="paperclip" size={16} /> files and images up to 50 MB
              </li>
            </ul>
          </div>
          <form className="card ticket hero" onSubmit={submit}>
            <div className="ticket-head">
              <span>{invited ? "INVITATION" : "ROOM TICKET"}</span>
              <span>ADMIT ONE</span>
            </div>
            <h2>{invited ? "You've been invited" : "Open a room"}</h2>
            {spaceId && (
              <p className="muted small">
                Joining room <code>#{spaceId}</code>
              </p>
            )}
            {fields}
            <div className="barcode" aria-hidden="true" />
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="landing dotted">
      <div className="corner">{theme}</div>
      <form className="card hero simple ticket" onSubmit={submit}>
        <div className="ticket-head">
          <span>{invited ? "INVITATION" : "ROOM TICKET"}</span>
          <span>ADMIT ONE</span>
        </div>
        <Logo size={56} animated />
        <h1 className="wordmark">
          deca<span>.</span>
        </h1>
        <p className="tagline">{manualRoute ? `${manualRoute.seed.name} invited you` : spaceId ? `You're invited to room #${spaceId}` : "A room you carry in a link."}</p>
        {fields}
        <div className="barcode" aria-hidden="true" />
      </form>
    </div>
  );
}

const ENDED = {
  kicked: { title: "You were removed", text: "The host removed you from this space." },
  closed: { title: "Space closed", text: "The host closed this space." },
  time: { title: "Time's up", text: "This space reached the end time the host set." },
  locked: { title: "This room is locked", text: "The host has closed this room to newcomers. Ask them to unlock it, then try again." },
  taken: { title: "That identity is in use", text: "Someone else is already connected with this identity. Open the invite link in a fresh tab." },
  busy: { title: "The server is busy", text: "Too many rooms or connections right now. Try again in a moment." },
  full: {
    title: "This room is full",
    text: "Everyone connects directly to everyone, so a room holds a limited number of people. Try again when someone leaves.",
  },
  replaced: {
    title: "Opened in another tab",
    text: "This space was opened somewhere else as you, so this tab stepped aside. Using it here will disconnect the other one.",
  },
};

function SpaceView({ space, onLeave, onRejoin, theme }: Readonly<{ space: Space; onLeave: () => void; onRejoin: () => void; theme: React.ReactNode }>) {
  const snap = useSyncExternalStore(space.subscribe, space.getSnapshot);
  const { state, me } = snap;
  const isHost = state.hostId === me;
  const code = space.spaceId; // the short room name, for both kinds of room
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [flash, setFlash] = useState(false);
  const [games, setGames] = useState<Game[]>([]);
  const [gameOpen, setGameOpen] = useState(false);
  const scoresOpen = useScoresDialog();
  useEffect(() => onKonami(() => setScoresDialog(true)), []); // hidden: the leaderboard opens with the Konami code
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}games.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setGames(Array.isArray(list) ? list : []))
      .catch(() => undefined); // no games folder: the feature simply isn't offered
  }, []);
  const { hornSound, titleBadge, sidebarW } = usePrefsValue();
  const prefsApi = usePrefsApi();
  const seenHorn = useRef<string | null>(null);
  const hornId = snap.horn?.id ?? null;

  // A live horn from the host: flash the screen, say who, and (if this device allows it) sound it.
  useEffect(() => {
    if (!hornId || hornId === seenHorn.current) return;
    seenHorn.current = hornId;
    const who = snap.state.members.get(snap.horn?.by ?? "")?.name ?? "The host";
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1600);
    if (hornSound) {
      void playHorn().then((ok) => ok || notify("Tap anywhere on the page once so your browser allows the horn", "error"));
    }
    notify(`${who} sounded the air horn`);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a NEW horn should fire this
  }, [hornId]);

  // Browsers only allow sound after a tap/key: prepare the audio on the first one.
  useEffect(() => {
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  useMediaErrors(snap);
  useUnreadTitle(snap, code, titleBadge);

  const hasStage = snap.tiles.length > 0;
  const showGame = gameOpen && games.length > 0;

  // "Expand chat": while a call is on the chat is the narrow column; this gives it the whole area (the call keeps
  // running, just out of sight). Never while a game is open, because that would resize the game's window: the
  // control is not offered then, and opening a game resets it.
  const runner = useRunner();
  const [chatBig, setChatBig] = useState(false);
  const canExpandChat = hasStage && !showGame;
  const chatExpanded = chatBig && canExpandChat;
  useEffect(() => {
    if (!hasStage || showGame) setChatBig(false);
  }, [hasStage, showGame]);
  // A game takes the same place as the runner strip: opening one turns the runner off (it stays off afterwards).
  useEffect(() => {
    if (showGame) setRunner(false);
  }, [showGame]);
  // Joining or leaving a call yourself is a deliberate act: show the video then, even if others are still on camera.
  useEffect(() => setChatBig(false), [snap.inCall]);

  // What would leaving actually cost? Used for the dialog and for the tab-close warning.
  const others = [...state.members.values()].filter((m) => m.online && m.peerId !== me);
  const myFiles = state.visible.filter((e) => e.type === "file_offer" && e.author === me).length;
  const hasHistory = state.visible.some((e) => e.type === "chat" || e.type === "file_offer");
  const next = [...others].sort((a, b) => a.firstJoin - b.firstJoin || (a.peerId < b.peerId ? -1 : 1))[0];
  const risky = snap.inCall || snap.sharing || (!others.length && hasHistory) || (myFiles > 0 && others.length > 0);

  // Closing the tab or refreshing while it matters: let the browser ask first.
  useEffect(() => {
    if (!risky || snap.ended) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [risky, snap.ended]);

  const requestLeave = async () => {
    const lines: string[] = [];
    if (!others.length) {
      lines.push(hasHistory ? "You're the only one here. When you leave, this space and its chat are gone for good." : "You're the only one here, so leaving closes the space.");
    } else if (isHost && next) {
      lines.push(`You're the host. ${next.name} will take over.`);
    }
    if (snap.inCall) lines.push("Your call will end.");
    if (snap.sharing) lines.push("Your screen share will stop.");
    if (myFiles && others.length) {
      lines.push(`${myFiles === 1 ? "The file" : `The ${myFiles} files`} you shared can't be downloaded once you leave.`);
    }
    if (!lines.length) lines.push("You can rejoin any time with the invite link.");
    if (await ask({ title: "Leave this space?", lines, confirm: "Leave now" })) onLeave();
  };

  if (snap.ended) {
    return (
      <div className="landing">
        <div className="corner">{theme}</div>
        <div className={`card hero ended ${(snap.ended === "closed" || snap.ended === "time") && snap.state.options.summary ? "with-summary" : ""}`}>
          <h2>{ENDED[snap.ended].title}</h2>
          <p className="muted">{ENDED[snap.ended].text}</p>
          {(snap.ended === "closed" || snap.ended === "time") && snap.state.options.summary && <RoomSummary snap={snap} games={games} />}
          {(snap.ended === "replaced" || snap.ended === "full" || snap.ended === "locked" || snap.ended === "busy") && (
            <button className="primary big" onClick={onRejoin}>
              {snap.ended === "replaced" ? "Use it here instead" : "Try again"}
            </button>
          )}
          <button className={snap.ended === "replaced" || snap.ended === "full" || snap.ended === "locked" || snap.ended === "busy" ? "ghost" : "primary big"} onClick={onLeave}>
            Back home
          </button>
        </div>
      </div>
    );
  }

  const invite = async () => {
    try {
      await navigator.clipboard.writeText(snap.manual?.invite ?? location.href);
      setCopied(true);
      notify("Invite link copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt("Copy this invite link", snap.manual?.invite ?? location.href);
    }
  };


  return (
    <div className="app">
      <header className="topbar">
        <div className="row">
          <button className="icon-btn only-sm" aria-label="Members" onClick={() => setMenu((m) => !m)}>
            <Icon name="users" />
          </button>
          <span className="brand hide-md">
            <Logo size={26} />
            <span className="wm">
              deca<i>.</i>
            </span>
          </span>
          <code className="pill ticket-pill" title="Room code">#{code}</code>
          <PresenceStack snap={snap} />
          <EndsIn options={state.options} />
          <span className={`status ${snap.connected ? "on" : "off"}`}>
            <span className="hide-md">{snap.connected ? "connected" : "connecting…"}</span>
          </span>
        </div>
        <div className="row">
          <div className="hide-sm">
            <NowPlaying space={space} snap={snap} onOpen={() => setMenu(true)} />
          </div>
          <button aria-label="Invite people" title="Copy invite link" onClick={invite}>
            <Icon name={copied ? "check" : "link"} size={16} /> <span className="hide-md">{copied ? "Copied" : "Invite"}</span>
          </button>
          {games.length > 0 && (
            <button
              className={`icon-btn games-btn ${gameOpen ? "live" : ""}`}
              aria-label="Games"
              aria-pressed={gameOpen}
              title="Games (experimental)"
              onClick={() => setGameOpen((o) => !o)}
            >
              <Icon name="gamepad" />
            </button>
          )}
          <CallControls space={space} snap={snap} />
          {theme}
          <button className="ghost" aria-label="Leave space" title="Leave space" onClick={() => void requestLeave()}>
            <Icon name="logOut" size={16} /> <span className="hide-md">Leave</span>
          </button>
        </div>
      </header>

      {flash && <div className="horn-flash" aria-hidden="true" />}
      <div className="body">
        {menu && <button className="scrim" aria-label="Close members" onClick={() => setMenu(false)} />}
        <aside className={`sidebar ${menu ? "open" : ""}`} style={sidebarW ? ({ "--side-w": `${sidebarW}px` } as CSSProperties) : undefined}>
          {listWidgets(isHost).map((w) => (
            <Slot key={w.id} id={w.id} title={w.title.toLowerCase()}>
              {w.render({ space, snap, isHost })}
            </Slot>
          ))}
        </aside>
        {prefsApi && <SidebarGrip width={sidebarW} onChange={(w) => prefsApi.update({ sidebarW: w })} />}

        {scoresOpen && <ScoresDialog snap={snap} games={games} onClose={() => setScoresDialog(false)} />}
        <main className={`main ${hasStage || showGame ? "has-stage" : ""} ${chatExpanded ? "chat-big" : ""}`}>
          {showGame ? (
            // The wrapper only exists while a game is open, so the normal call layout is untouched.
            <div className="media-col">
              {hasStage && <CallStage snap={snap} />}
              <GamesPanel games={games} onScore={space.recordScore.bind(space)} onClose={() => setGameOpen(false)} />
            </div>
          ) : runner ? (
            // The hidden /run strip: under the video when there is one, otherwise above the chat. Only while no game is open.
            <div className="media-col">
              {hasStage && <CallStage snap={snap} />}
              <RunnerStrip />
            </div>
          ) : (
            hasStage && <CallStage snap={snap} />
          )}
          <Chat space={space} snap={snap} isHost={isHost} inviteLink={snap.manual?.invite ?? location.href} onInvite={invite} callBar={canExpandChat ? <ChatCallBar snap={snap} expanded={chatExpanded} onToggle={() => setChatBig((v) => !v)} /> : null} />
        </main>
      </div>
    </div>
  );
}

/** Drag (or use the arrow keys) to resize the sidebar; double-click puts it back. */
function SidebarGrip({ width, onChange }: Readonly<{ width: number | null; onChange: (w: number | null) => void }>) {
  const clamp = (w: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const grip = e.currentTarget;
    const left = (grip.previousElementSibling as HTMLElement).getBoundingClientRect().left;
    grip.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => onChange(clamp(m.clientX - left));
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  };
  const cur = width ?? 290;
  return (
    <div
      className="side-grip"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={cur}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onDown}
      onDoubleClick={() => onChange(null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(clamp(cur - 20));
        else if (e.key === "ArrowRight") onChange(clamp(cur + 20));
        else return;
        e.preventDefault();
      }}
    />
  );
}

/** Overlapping avatars of who is here right now; a ring marks people in the call. */
function PresenceStack({ snap }: Readonly<{ snap: Snapshot }>) {
  const here = [...snap.state.members.values()].filter((m) => m.online);
  const inCall = new Set(snap.tiles.filter((t) => t.kind === "camera").map((t) => t.peerId));
  const shown = here.slice(0, 5);
  return (
    <div className="stack" title={`${here.length} here: ${here.map((m) => m.name).join(", ")}`} aria-label={`${here.length} people here`}>
      {shown.map((m) => (
        <span key={m.peerId} className={inCall.has(m.peerId) ? "in-call" : ""}>
          <Avatar name={m.name} id={m.peerId} size={26} />
        </span>
      ))}
      {here.length > shown.length && <span className="more">+{here.length - shown.length}</span>}
    </div>
  );
}

/** Big red button: the host wakes everyone up with an air horn. A short cooldown stops accidental spam. */
function HornButton({ space }: Readonly<{ space: Space }>) {
  const [cooling, setCooling] = useState(false);
  const press = () => {
    const err = space.soundHorn();
    if (err) return void notify(err, "error");
    setCooling(true);
    setTimeout(() => setCooling(false), 3000);
  };
  return (
    <button className="horn-btn wide" onClick={press} disabled={cooling} title="Sounds an air horn on everyone's device">
      <Icon name="bell" size={16} /> {cooling ? "Sounded…" : "Wake up"}
    </button>
  );
}

registerWidget({ id: "members", title: "Members", order: 10, render: ({ space, snap, isHost }) => <Members space={space} snap={snap} isHost={isHost} /> });
registerWidget({ id: "music", title: "Music", order: 20, render: ({ space, snap }) => <MusicPlayer space={space} snap={snap} /> });
registerWidget({ id: "host", title: "Host controls", order: 30, hostOnly: true, render: ({ space, snap }) => <HostControls space={space} snap={snap} /> });

/** Two host choices, both off by default: an end time for the room, and a summary on the end screen. */
function RoomOptionsControls({ space, snap }: Readonly<{ space: Space; snap: Snapshot }>) {
  const { options } = snap.state;
  const [minutes, setMinutes] = useState(60);
  return (
    <>
      <label className="toggle" title="The room closes for everyone when the time is up. Everyone sees a countdown.">
        <input type="checkbox" checked={options.endsAt > 0} onChange={(e) => space.setOptions({ endsAt: e.target.checked ? Date.now() + minutes * 60000 : 0 })} />
        End this room after a set time
      </label>
      {options.endsAt > 0 ? (
        <div className="row small-row">
          <button className="small-btn" onClick={() => space.setOptions({ endsAt: options.endsAt + 15 * 60000 })}>
            Add 15 min
          </button>
        </div>
      ) : (
        <select aria-label="How long the room lasts" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          {[5, 15, 30, 45, 60, 90, 120].map((m) => (
            <option key={m} value={m}>
              {m} minutes
            </option>
          ))}
        </select>
      )}
      <label className="toggle" title="When the room ends, everyone sees who was here, what was shared, and the highlights.">
        <input type="checkbox" checked={options.summary} onChange={(e) => space.setOptions({ summary: e.target.checked })} />
        Show a summary when the room ends
      </label>
    </>
  );
}

function HostControls({ space, snap }: Readonly<{ space: Space; snap: Snapshot }>) {
  const { perms } = snap.state;
  return (
    <section className="panel" aria-label="Host controls">
      <h3>
        <SlotToggle /> Host controls
      </h3>
      <label className="toggle">
        <input type="checkbox" checked={perms.chat} onChange={(e) => space.setPerms({ ...perms, chat: e.target.checked })} />
        Members can chat
      </label>
      <label className="toggle">
        <input type="checkbox" checked={perms.files} onChange={(e) => space.setPerms({ ...perms, files: e.target.checked })} />
        Members can share files
      </label>
      {!snap.manual && (
        <label className="toggle" title="No new people can join while locked. People already here are not affected.">
          <input type="checkbox" checked={snap.locked} onChange={(e) => space.setLocked(e.target.checked)} />
          Lock room (no newcomers)
        </label>
      )}
      <label className="toggle">
        <input type="checkbox" checked={perms.music} onChange={(e) => space.setPerms({ ...perms, music: e.target.checked })} />
        Members can control music
      </label>
      <RoomOptionsControls space={space} snap={snap} />
      <HornButton space={space} />
      <button
        className="danger wide"
        onClick={async () => {
          const ok = await ask({
            title: "Close the space for everyone?",
            lines: ["Everyone is disconnected right away.", "The chat, shared files and the music queue are gone."],
            confirm: "Close for everyone",
            danger: true,
          });
          if (ok) space.closeSpace();
        }}
      >
        Close space
      </button>
    </section>
  );
}

function Toaster() {
  const toasts = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  );
}

/** Surface media errors (permission denied, no camera…) as toasts. */
function useMediaErrors(snap: Snapshot) {
  useEffect(() => {
    if (snap.mediaError) notify(snap.mediaError, "error");
  }, [snap.mediaError]);
}

/** "(2) Deca · code" in the tab title while messages arrive in a background tab. */
function useUnreadTitle(snap: Snapshot, code: string, badge: boolean) {
  const seen = useRef(0);
  const unread = useRef(0);
  const base = `Deca · ${code}`;
  const count = snap.state.visible.filter((e) => e.type === "chat" || e.type === "file_offer").length;

  useEffect(() => {
    const show = () => {
      document.title = unread.current ? `(${unread.current}) ${base}` : base;
    };
    const clear = () => {
      if (!document.hidden) {
        unread.current = 0;
        show();
      }
    };
    document.addEventListener("visibilitychange", clear);
    show();
    return () => {
      document.removeEventListener("visibilitychange", clear);
      document.title = "Deca";
    };
  }, [base]);

  useEffect(() => {
    const fresh = count - seen.current;
    seen.current = count;
    if (fresh > 0 && document.hidden && badge) {
      unread.current += fresh;
      document.title = `(${unread.current}) ${base}`;
    }
  }, [count, base, badge]);
}

export default App;
