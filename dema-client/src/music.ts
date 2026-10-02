/* eslint-disable @typescript-eslint/no-explicit-any -- wire data is untrusted and rebuilt by sanitize() */
// Shared music state. Nobody streams audio: every peer plays the same YouTube video in their own
// embedded player and follows this small state, which is broadcast over the data channels.

export type Track = { vid: string; title: string; by: string };

export type MusicState = {
  /** Monotonic version. The highest (rev, by) wins, so concurrent edits converge everywhere. */
  rev: number;
  by: string;
  cur: Track | null;
  playing: boolean;
  /** Seconds into the track at the moment this state was produced. */
  pos: number;
  queue: Track[];
};

export const EMPTY_MUSIC: MusicState = { rev: 0, by: "", cur: null, playing: false, pos: 0, queue: [] };
const MAX_QUEUE = 50;
const VID = /^[\w-]{11}$/;

/** Accepts watch / youtu.be / shorts / embed / music.youtube.com links or a bare 11-char id. */
export function parseVideoId(input: string): string | null {
  const text = input.trim();
  if (VID.test(text)) return text;
  try {
    const u = new URL(text.startsWith("http") ? text : `https://${text}`);
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      id = u.searchParams.get("v") ?? /^\/(?:shorts|embed|live|v)\/([\w-]{11})/.exec(u.pathname)?.[1] ?? null;
    }
    return id && VID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function isNewer(a: MusicState, b: MusicState | null) {
  return !b || a.rev > b.rev || (a.rev === b.rev && a.by > b.by);
}

export function positionNow(s: MusicState, receivedAt: number, now = Date.now()) {
  return s.pos + (s.playing ? (now - receivedAt) / 1000 : 0);
}

/**
 * What happens when a track ends. Deterministic, so every peer computes the identical result
 * locally at its own end-of-track and nothing needs to be sent.
 */
export function advance(s: MusicState): MusicState {
  const [next, ...rest] = s.queue;
  return { rev: s.rev + 1, by: "auto", cur: next ?? null, queue: rest, playing: !!next, pos: 0 };
}

const track = (x: any): Track | null =>
  x && VID.test(String(x.vid)) ? { vid: String(x.vid), title: String(x.title ?? "").slice(0, 120), by: String(x.by ?? "").slice(0, 64) } : null;

/** Never trust the wire: rebuild a clean state or reject. */
export function sanitize(x: any): MusicState | null {
  if (!x || typeof x.rev !== "number" || typeof x.by !== "string") return null;
  const queue = (Array.isArray(x.queue) ? x.queue : []).map(track).filter((t: Track | null): t is Track => !!t);
  const cur = x.cur ? track(x.cur) : null;
  if (x.cur && !cur) return null;
  return {
    rev: Math.max(0, Math.floor(x.rev)),
    by: x.by.slice(0, 64),
    cur,
    playing: !!x.playing && !!cur,
    pos: Number.isFinite(x.pos) ? Math.max(0, x.pos) : 0,
    queue: queue.slice(0, MAX_QUEUE),
  };
}

export async function fetchTitle(vid: string): Promise<{ title: string } | { error: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${vid}`)}&format=json`;
    const res = await fetch(url, { signal: ctl.signal });
    if (res.ok) return { title: String((await res.json()).title).slice(0, 120) };
    if (res.status === 401) return { error: "The owner doesn't allow this video to be played outside YouTube" };
    if (res.status === 404 || res.status === 400) return { error: "Video not found" };
  } catch {
    // offline or blocked: still allow it, with a generic title
  } finally {
    clearTimeout(timer);
  }
  return { title: "YouTube video" };
}
