import { useEffect, useRef, useState } from "react";
import type { Space, Snapshot, Tile } from "../space";
import { Avatar } from "./Avatar";
import { Icon } from "./Icons";

/** Call buttons for the top bar: start/leave call, mic, camera, screen share. */
export function CallControls({ space, snap }: Readonly<{ space: Space; snap: Snapshot }>) {
  const { inCall, sharing, micOn, camOn } = snap;
  return (
    <div className="row call-controls">
      {inCall ? (
        <>
          <button
            className={`icon-btn ${micOn ? "" : "off"}`}
            aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
            aria-pressed={!micOn}
            title={micOn ? "Mute microphone" : "Unmute microphone"}
            onClick={() => space.toggleMic()}
          >
            <Icon name={micOn ? "mic" : "micOff"} />
          </button>
          <button
            className={`icon-btn ${camOn ? "" : "off"}`}
            aria-label={camOn ? "Turn off camera" : "Turn on camera"}
            aria-pressed={!camOn}
            title={camOn ? "Turn off camera" : "Turn on camera"}
            onClick={() => space.toggleCam()}
          >
            <Icon name={camOn ? "video" : "videoOff"} />
          </button>
        </>
      ) : (
        <button className="primary" aria-label="Start call" title="Start call" onClick={() => void space.startCamera()}>
          <Icon name="video" /> <span className="hide-md">Start call</span>
        </button>
      )}
      <button
        className={`icon-btn ${sharing ? "live" : ""}`}
        aria-label={sharing ? "Stop sharing screen" : "Share screen"}
        aria-pressed={sharing}
        title={sharing ? "Stop sharing screen" : "Share screen"}
        onClick={() => (sharing ? space.stopScreen() : void space.startScreen())}
      >
        <Icon name="monitor" />
      </button>
      {inCall && (
        <button className="icon-btn hangup" aria-label="Leave call" title="Leave call" onClick={() => space.stopCamera()}>
          <Icon name="phoneOff" />
        </button>
      )}
    </div>
  );
}

/** A running call clock, as plain text. */
export function CallElapsed({ since }: Readonly<{ since: number }>) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="call-elapsed">{clock(now - since)}</span>;
}

/**
 * A slim bar at the top of the chat while a call is on: the chat is the narrow column then, and this lets anyone
 * give it the whole area (the video keeps playing, just out of sight) and come back. Not offered with a game open.
 */
export function ChatCallBar({ snap, expanded, onToggle }: Readonly<{ snap: Snapshot; expanded: boolean; onToggle: () => void }>) {
  const onCamera = snap.tiles.filter((t) => t.kind === "camera").length;
  return (
    <div className="chat-callbar">
      {/* The video carries its own timer; this one only appears while the video (and its timer) is hidden, so there is never a pair. */}
      {expanded && <span className="rec-dot" aria-hidden="true" />}
      <span>
        In a call{onCamera ? ` · ${onCamera} on camera` : ""}
        {expanded && snap.callStartedAt ? <> · <CallElapsed since={snap.callStartedAt} /></> : null}
      </span>
      <button
        className={`small-btn chat-expand ${expanded ? "live" : ""}`}
        aria-pressed={expanded}
        aria-label={expanded ? "Back to video" : "Expand chat"}
        title={expanded ? "Show the video again" : "Give the chat the whole area. The call keeps going."}
        onClick={onToggle}
      >
        <Icon name={expanded ? "video" : "maximize"} size={14} /> {expanded ? "Video" : "Expand"}
      </button>
    </div>
  );
}

/** Video area. A screen share (or a pinned tile) is spotlighted; everyone else goes in a strip. */
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${m}:${sec}` : `${m}:${sec}`;
};

/** How long the call has been running, counted from when its first participant joined. */
function CallTimer({ since }: Readonly<{ since: number }>) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="call-timer" role="timer" aria-label="Call duration" title="How long this call has been running">
      <span className="rec-dot" /> {clock(now - since)}
    </div>
  );
}

export function CallStage({ snap }: Readonly<{ snap: Snapshot }>) {
  const [pinned, setPinned] = useState<string | null>(null);
  const { tiles, state } = snap;
  const nameOf = (id: string) => (id === snap.me ? "You" : (state.members.get(id)?.name ?? id));

  const spotKey =
    (pinned && tiles.some((t) => t.key === pinned) ? pinned : null) ?? tiles.find((t) => t.kind === "screen")?.key ?? null;
  const spot = tiles.find((t) => t.key === spotKey);
  const rest = tiles.filter((t) => t.key !== spotKey);

  const renderTile = (t: Tile) => (
    <VideoTile key={t.key} tile={t} label={nameOf(t.peerId)} pinned={t.key === pinned} onPin={() => setPinned(t.key === pinned ? null : t.key)} />
  );

  return (
    <section className={`stage ${spot ? "spot" : ""}`} aria-label="Call">
      {snap.callStartedAt && <CallTimer since={snap.callStartedAt} />}
      {spot && <div className="stage-main">{renderTile(spot)}</div>}
      <div className={`stage-grid n${Math.min(rest.length, 4)}`}>{rest.map(renderTile)}</div>
    </section>
  );
}

function VideoTile({
  tile,
  label,
  pinned,
  onPin,
}: Readonly<{ tile: Tile; label: string; pinned: boolean; onPin: () => void }>) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [full, setFull] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const trackKey = tile.stream
    .getTracks()
    .map((t) => t.id)
    .join(",");

  // Safari will not render a video track that joins a stream already attached to the element
  // (audio usually arrives first), so re-attach whenever the set of tracks changes. It can also
  // refuse autoplay (Low Power Mode, etc.): offer a tap instead of failing silently.
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    el.srcObject = null;
    el.srcObject = tile.stream;
    el.play().then(
      () => setBlocked(false),
      () => setBlocked(true),
    );
  }, [tile.stream, trackKey]);

  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen?.();
  };

  const screen = tile.kind === "screen";
  const showVideo = tile.cam;
  return (
    <div ref={box} className={`tile ${screen ? "screen" : ""} ${full ? "full" : ""}`} onDoubleClick={toggleFull}>
      {/* Always mounted so remote audio keeps playing even when the camera is off. */}
      <video ref={video} autoPlay playsInline muted={tile.local} className={showVideo ? "" : "hidden"} />
      {!showVideo && (
        <div className="tile-off">
          <Avatar name={label} id={tile.peerId} size={64} />
        </div>
      )}
      {blocked && (
        <button className="tap-play" onClick={() => void video.current?.play().then(() => setBlocked(false))}>
          Tap to play
        </button>
      )}
      <div className="tile-label">
        {!tile.mic && !screen && <Icon name="micOff" size={13} />}
        {label}
        {screen && (tile.mic ? " · screen with sound" : " · screen")}
      </div>
      <div className="tile-actions">
        <button className="icon-btn glass" aria-label={pinned ? "Unpin" : "Pin"} title={pinned ? "Unpin" : "Pin to spotlight"} onClick={onPin}>
          <Icon name="pin" size={15} />
        </button>
        <button
          className="icon-btn glass"
          aria-label={full ? "Exit full screen" : "Full screen"}
          title={full ? "Exit full screen" : "Full screen (or double-click)"}
          onClick={toggleFull}
        >
          <Icon name={full ? "minimize" : "maximize"} size={15} />
        </button>
      </div>
    </div>
  );
}
