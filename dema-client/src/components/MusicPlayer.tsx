/* eslint-disable @typescript-eslint/no-explicit-any -- the YouTube IFrame API ships no types */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { positionNow } from "../music";
import type { Snapshot, Space } from "../space";
import { SlotToggle } from "../slot";
import { notify } from "../toast";
import { Icon } from "./Icons";
import { Visualizer } from "./Visualizer";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytLoading: Promise<any> | null = null;
function loadYT(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  ytLoading ??= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => {
      ytLoading = null;
      reject(new Error("The YouTube player couldn't load. Check your connection or ad blocker."));
    };
    document.head.appendChild(s);
  });
  return ytLoading;
}

const VOL_KEY = "deca.volume";
const loadVolume = () => {
  try {
    const v = Number(localStorage.getItem(VOL_KEY));
    return Number.isFinite(v) && v >= 0 && v <= 100 && localStorage.getItem(VOL_KEY) !== null ? v : 60;
  } catch {
    return 60;
  }
};
/** Keep the whole header (and so its buttons) on screen. */
const keepOnScreen = (x: number, y: number, width: number) => ({
  x: Math.min(Math.max(0, innerWidth - width), Math.max(0, x)),
  y: Math.min(innerHeight - 56, Math.max(0, y)),
});
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Small shared listening room: everyone plays the same YouTube video, in sync, locally. */
export function MusicPlayer({ space, snap }: Readonly<{ space: Space; snap: Snapshot }>) {
  const { music, musicAt, state, me } = snap;
  const canControl = state.hostId === me || state.perms.music;
  const cur = music?.cur ?? null;
  const nameOf = (id: string) => (id === me ? "you" : (state.members.get(id)?.name ?? "someone"));

  const [listening, setListening] = useState(true);
  const [volume, setVolume] = useState(loadVolume);
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [prog, setProg] = useState({ t: 0, d: 0 });
  const [scrub, setScrub] = useState<number | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);

  const root = useRef<HTMLElement>(null);
  const [fsMax, setMax] = useState(false);
  // Phones (iPhone Safari has no element fullscreen) get a page-filling overlay instead.
  const [softMax, setSoftMax] = useState(false);
  const max = fsMax || softMax;
  useEffect(() => {
    const sync = () => setMax(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useEffect(() => {
    if (!softMax) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setSoftMax(false);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [softMax]);
  // Fullscreen the whole panel (not just the video) so play/seek/volume stay usable; the player is
  // only restyled, never remounted, so the music doesn't restart.
  const toggleMax = () => {
    if (softMax) return setSoftMax(false);
    if (document.fullscreenElement) return void document.exitFullscreen();
    const el = root.current;
    if (!el?.requestFullscreen) return setSoftMax(true);
    el.requestFullscreen().catch(() => setSoftMax(true));
  };

  // Pop-out: the same panel, restyled as a small draggable window over the page (never remounted).
  const [float, setFloat] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragStart = (e: ReactPointerEvent<HTMLElement>) => {
    if (!float || (e.target as HTMLElement).closest("button")) return;
    const box = root.current!.getBoundingClientRect();
    const dx = e.clientX - box.left;
    const dy = e.clientY - box.top;
    const head = e.currentTarget;
    head.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => setPos(keepOnScreen(m.clientX - dx, m.clientY - dy, box.width));
    const up = () => {
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", up);
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up);
  };

  // The pop-out only exists on wide screens; going narrow (phone, rotate, resize) docks it.
  useEffect(() => {
    const q = matchMedia("(max-width: 860px)");
    const dock = () => q.matches && setFloat(false);
    dock();
    q.addEventListener("change", dock);
    return () => q.removeEventListener("change", dock);
  }, []);

  // A window left out there must stay reachable if the browser is made smaller.
  useEffect(() => {
    if (!float || !pos) return;
    const fit = () => setPos((q) => (q && root.current ? keepOnScreen(q.x, q.y, root.current.offsetWidth) : q));
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, [float, pos]);

  const frame = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const loaded = useRef<string | null>(null);
  const rev = useRef(0);
  const latest = useRef({ music, musicAt });
  const allowed = useRef(canControl);
  /** When we last told the player to do something, and when we last loaded a track: state changes
   *  right after those are our own doing, not a person clicking inside the video. */
  const cmdAt = useRef(0);
  const loadedAt = useRef(0);
  useEffect(() => {
    rev.current = music?.rev ?? 0;
    latest.current = { music, musicAt };
    allowed.current = canControl;
  }, [music, musicAt, canControl]);

  /**
   * Housekeeping that never fights a person: rescue a player that never started, and correct drift.
   * (A pause or play done inside the video is handled as an intent below, not undone.)
   */
  const reconcile = useCallback(() => {
    const p = player.current;
    const { music: m, musicAt: at } = latest.current;
    if (!p || !m?.cur || loaded.current !== m.cur.vid) return;
    const st = p.getPlayerState?.(); // -1 unstarted, 1 playing, 2 paused, 3 buffering, 5 cued
    const target = positionNow(m, at);
    if (m.playing && (st === -1 || st === 5)) {
      cmdAt.current = Date.now();
      p.playVideo();
    } else if (m.playing && st === 1 && Math.abs((p.getCurrentTime?.() ?? 0) - target) > 3) {
      cmdAt.current = Date.now();
      p.seekTo(target, true);
    }
  }, []);

  /**
   * Someone paused or played INSIDE the video (clicking it). That is a request like pressing our
   * button: pass it on to everyone so all players and buttons stay in agreement. If they are not
   * allowed to control the music, put their player back and say why.
   */
  const userChangedPlayer = useCallback(
    (kind: "pause" | "play") => {
      if (allowed.current) return void space.musicToggle();
      const p = player.current;
      cmdAt.current = Date.now();
      if (kind === "pause") p?.playVideo();
      else p?.pauseVideo();
      notify("Music controls are off for members", "error");
    },
    [space],
  );

  const active = listening && !!cur;

  // Create the embedded player only while there is something to play and we are listening.
  useEffect(() => {
    const box = frame.current;
    if (!active || !box) return;
    let dead = false;
    let p: any;
    const mount = document.createElement("div");
    box.appendChild(mount);
    loadYT()
      .then((YT) => {
        if (dead) return;
        p = new YT.Player(mount, {
          width: "100%",
          height: "100%",
          playerVars: { playsinline: 1, rel: 0, controls: 0, disablekb: 1, modestbranding: 1 },
          events: {
            onReady: () => {
              if (dead) return;
              player.current = p;
              setReady(true);
            },
            onStateChange: (e: any) => {
              if (e.data === YT.PlayerState.ENDED) space.musicEnded(rev.current);
              if (e.data === YT.PlayerState.PLAYING) setBlocked(false);
              if (e.data !== YT.PlayerState.PLAYING && e.data !== YT.PlayerState.PAUSED) return;
              const now = Date.now();
              if (now - cmdAt.current < 800 || now - loadedAt.current < 2500) return; // our own doing, or settling after a load
              const m = latest.current.music;
              if (!m?.cur || loaded.current !== m.cur.vid) return;
              if (e.data === YT.PlayerState.PAUSED && m.playing) userChangedPlayer("pause");
              else if (e.data === YT.PlayerState.PLAYING && !m.playing) userChangedPlayer("play");
            },
            onAutoplayBlocked: () => setBlocked(true),
            onError: () => notify("That video can't be played here. Skip to the next one.", "error"),
          },
        });
      })
      .catch((err: Error) => notify(err.message, "error"));
    return () => {
      dead = true;
      setReady(false);
      player.current = null;
      loaded.current = null;
      try {
        p?.destroy?.();
      } catch {
        // player already gone
      }
      box.replaceChildren();
    };
  }, [active, space, userChangedPlayer]);

  // Follow the shared state: load/cue the track, play/pause, and correct drift.
  useEffect(() => {
    const p = player.current;
    if (!ready || !p || !music?.cur) return;
    const target = positionNow(music, musicAt) + 0.2;
    cmdAt.current = Date.now(); // everything below is us driving the player
    if (loaded.current !== music.cur.vid) {
      loaded.current = music.cur.vid;
      loadedAt.current = Date.now();
      const args = { videoId: music.cur.vid, startSeconds: target };
      if (music.playing) p.loadVideoById(args);
      else p.cueVideoById(args);
      return;
    }
    const st = p.getPlayerState?.();
    if (Math.abs((p.getCurrentTime?.() ?? 0) - target) > 2) p.seekTo(target, true);
    if (music.playing && st !== 1 && st !== 3) p.playVideo();
    if (!music.playing && st === 1) p.pauseVideo();
  }, [ready, music, musicAt]);

  useEffect(() => {
    const p = player.current;
    if (!ready || !p) return;
    p.setVolume(volume);
    if (muted) p.mute();
    else p.unMute();
    try {
      localStorage.setItem(VOL_KEY, String(volume));
    } catch {
      // not persisted
    }
  }, [ready, volume, muted]);

  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const p = player.current;
      if (p) setProg({ t: p.getCurrentTime?.() ?? 0, d: p.getDuration?.() ?? 0 });
    }, 500);
    const check = setInterval(reconcile, 3000); // belt and braces: also catches drift and silent changes
    return () => {
      clearInterval(id);
      clearInterval(check);
    };
  }, [ready, reconcile]);

  const add = async () => {
    if (!link.trim() || busy) return;
    const sent = link;
    // Several links at once (one per line, or separated by spaces/commas) are queued in order.
    const links = sent.split(/[\s,]+/).filter(Boolean).slice(0, 10);
    setBusy(true);
    let first = "";
    for (const l of links) first ||= await space.musicAdd(l);
    setBusy(false);
    if (first) notify(first, "error");
    else setLink((now) => (now === sent ? "" : now)); // don't wipe what they typed while it was adding
  };

  // What played last in this visit, so an empty player can offer to play it again. Deliberately not saved:
  // a room is gone when everyone leaves, so a new room starts clean.
  const [last, setLast] = useState<{ vid: string; title: string } | null>(null);
  useEffect(() => {
    if (!cur || last?.vid === cur.vid) return;
    setLast({ vid: cur.vid, title: cur.title });
  }, [cur, last]);
  const addOne = async (vid: string) => {
    const err = await space.musicAdd(vid);
    if (err) notify(err, "error");
  };

  const shown = scrub ?? prog.t;
  return (
    <section className={`panel music ${max ? "max" : ""} ${softMax ? "soft-max" : ""} ${float ? "float" : ""}`}
      aria-label="Music"
      ref={root}
      style={float && pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
    >
      <h3 onPointerDown={dragStart}>
        <SlotToggle hidden={float} />
        <Icon name="music" size={13} /> Music
        {(cur || float) && (
          <button
            className={`icon-btn small push-right hide-sm ${float ? "live" : ""}`}
            aria-label={float ? "Dock the player" : "Pop out the player"}
            aria-pressed={float}
            title={float ? "Dock back into the sidebar" : "Pop out: a small window you can drag while you chat"}
            onClick={() => setFloat((f) => !f)}
          >
            <Icon name="popout" size={14} />
          </button>
        )}
        {cur && (
          <button className="icon-btn small" aria-label={max ? "Exit full screen" : "Maximise player"} title={max ? "Exit full screen (Esc)" : "Maximise"} onClick={toggleMax}>
            <Icon name={max ? "minimize" : "maximize"} size={14} />
          </button>
        )}
        {cur && (
          <button
            className={`icon-btn small ${listening ? "live" : ""}`}
            aria-label={listening ? "Stop listening on this device" : "Listen on this device"}
            aria-pressed={listening}
            title={listening ? "Listening: click to stop hearing it here" : "Not listening: click to tune in"}
            onClick={() => setListening((l) => !l)}
          >
            <Icon name="headphones" size={14} />
          </button>
        )}
      </h3>

      {cur ? (
        <>
          {active ? (
            <div className="player-frame">
              {/* The YouTube iframe gets its own container; React-managed overlays live beside it. */}
              <div className="yt-mount" ref={frame} />
              {blocked && (
                <button className="tap-play" onClick={() => { cmdAt.current = Date.now(); void player.current?.playVideo(); }}>
                  Tap to start music
                </button>
              )}
            </div>
          ) : (
            <div className="player-frame off">Not listening on this device</div>
          )}
          <div className="np-meta">
            <div className="np-title" title={cur.title}>{cur.title}</div>
            <div className="muted small">added by {nameOf(cur.by)}</div>
          </div>
          <Visualizer playing={!!music?.playing && active} seed={cur.vid} />
          <div className="transport">
            <span className="clock">{clock(shown)}</span>
            <input
              type="range"
              className="seek"
              aria-label="Seek"
              min={0}
              max={Math.max(1, Math.floor(prog.d))}
              step={1}
              value={Math.min(shown, Math.max(1, prog.d))}
              disabled={!canControl || !active || prog.d === 0}
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={() => {
                if (scrub !== null) space.musicSeek(scrub);
                setScrub(null);
              }}
              onKeyUp={() => {
                if (scrub !== null) space.musicSeek(scrub);
                setScrub(null);
              }}
            />
            <span className="clock">{clock(prog.d)}</span>
          </div>
          <div className="controls">
            <button
              className="icon-btn primary-ish"
              aria-label={music?.playing ? "Pause for everyone" : "Play for everyone"}
              disabled={!canControl}
              onClick={() => space.musicToggle()}
            >
              <Icon name={music?.playing ? "pause" : "play"} />
            </button>
            <button className="icon-btn" aria-label="Restart this track" title="Restart this track" disabled={!canControl} onClick={() => space.musicSeek(0)}>
              <Icon name="rotate" size={16} />
            </button>
            <button className="icon-btn" aria-label="Next track" title="Next track" disabled={!canControl} onClick={() => space.musicNext()}>
              <Icon name="skipNext" />
            </button>
            <div className="volume">
              <button className="icon-btn small" aria-label={muted ? "Unmute music" : "Mute music"} onClick={() => setMuted((m) => !m)}>
                <Icon name={muted || volume === 0 ? "volumeOff" : "volume"} size={14} />
              </button>
              <input type="range" aria-label="Music volume (only for you)" min={0} max={100} value={muted ? 0 : volume} onChange={(e) => { setMuted(false); setVolume(Number(e.target.value)); }} />
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="muted small empty">Nothing playing. Paste a YouTube link and everyone here hears it together.</p>
          {canControl && (
            <div className="music-quick">
              {last && (
                <button className="small-btn" onClick={() => void addOne(last.vid)} title={last.title}>
                  <Icon name="rotate" size={13} /> Replay: <span className="ellipsis">{last.title}</span>
                </button>
              )}
            </div>
          )}
        </>
      )}

      {!!music?.queue.length && (
        <ol className="queue" aria-label="Up next">
          {music.queue.map((t, i) => (
            <li key={`${t.vid}-${i}`}>
              <span className="ellipsis" title={t.title}>{t.title}</span>
              {canControl && (
                <button className="icon-btn small" aria-label={`Remove ${t.title} from queue`} onClick={() => space.musicRemove(i)}>
                  <Icon name="x" size={13} />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      <form
        className="add-track"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          placeholder={canControl ? "Paste YouTube link(s)" : "Music controls are off"}
          aria-label="YouTube link"
          value={link}
          disabled={!canControl}
          onChange={(e) => setLink(e.target.value)}
        />
        <button type="submit" className="icon-btn" aria-label="Add to queue" disabled={!canControl || busy || !link.trim()}>
          <Icon name="plus" />
        </button>
      </form>
    </section>
  );
}

/** Tiny "now playing" chip for the top bar. */
export function NowPlaying({ space, snap, onOpen }: Readonly<{ space: Space; snap: Snapshot; onOpen: () => void }>) {
  const { music, state, me } = snap;
  if (!music?.cur) return null;
  const canControl = state.hostId === me || state.perms.music;
  return (
    <div className="now-playing">
      <Visualizer playing={music.playing} seed={music.cur.vid} bars={5} className="mini" />
      <button className="np-open" title={music.cur.title} onClick={onOpen}>
        {music.cur.title}
      </button>
      <button
        className="icon-btn small"
        aria-label={music.playing ? "Pause for everyone" : "Play for everyone"}
        disabled={!canControl}
        onClick={() => space.musicToggle()}
      >
        <Icon name={music.playing ? "pause" : "play"} size={13} />
      </button>
    </div>
  );
}
