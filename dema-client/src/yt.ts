/* eslint-disable @typescript-eslint/no-explicit-any -- the YouTube IFrame API ships no types */
// The YouTube player script, loaded once, and a way to ask it for the videos in a playlist (or the "radio" YouTube builds around one video)
// without an API key: a hidden player is pointed at the list, reports the ids once it has loaded it, and is thrown away.
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytLoading: Promise<any> | null = null;
export function loadYT(): Promise<any> {
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

const LIST = /^[\w-]{13,64}$/;

/** A playlist link (not a single video inside one): the list id, or null. A link to a video that merely has `&list=` plays that one video. */
export function parsePlaylistId(input: string): string | null {
  const text = input.trim();
  try {
    const u = new URL(text.startsWith("http") ? text : `https://${text}`);
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
    const list = u.searchParams.get("list");
    if (!list || !LIST.test(list) || u.searchParams.get("v") || u.hostname === "youtu.be") return null;
    return list;
  } catch {
    return null;
  }
}

/** A link to one video inside an automatic mix (the "radio" YouTube starts when you listen to a song: a `list=RD...` with a `v=`): that video. */
export function parseMixSeed(input: string): string | null {
  try {
    const text = input.trim();
    const u = new URL(text.startsWith("http") ? text : `https://${text}`);
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    const v = u.searchParams.get("v");
    const list = u.searchParams.get("list") ?? "";
    return (host === "youtube.com" || host === "youtube-nocookie.com") && v && /^[\w-]{11}$/.test(v) && /^RD/.test(list) ? v : null;
  } catch {
    return null;
  }
}

/** A personal mix ("My Mix", "Discover") or a private list: YouTube never serves these to a page that is not signed in as you. */
export const isPersonalList = (list: string) => /^(RDMM|RDEM|RDGM|LM$|WL$|LL$)/.test(list) || list === "LM" || list === "WL";

/** The video ids in a playlist, in order; empty if YouTube would not give them (private, blocked, not found). */
export async function playlistIds(list: string, max = 60): Promise<string[]> {
  if (!LIST.test(list)) return [];
  const YT = await loadYT();
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:-9999px;top:0;width:200px;height:120px;pointer-events:none";
    const mount = document.createElement("div");
    box.appendChild(mount);
    document.body.appendChild(box);
    let done = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    // eslint-disable-next-line prefer-const -- finish() above refers to it before the player exists
    let player: any;
    const finish = (ids: string[]) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      try {
        player?.destroy?.();
      } catch {
        // already gone
      }
      box.remove();
      resolve(ids.filter((id) => /^[\w-]{11}$/.test(id)).slice(0, max));
    };
    player = new YT.Player(mount, {
      width: 200,
      height: 120,
      playerVars: { listType: "playlist", list, controls: 0 },
      events: {
        onReady: () => {
          let tries = 0;
          poll = setInterval(() => {
            const ids: string[] = player.getPlaylist?.() ?? [];
            if (ids.length || ++tries > 30) finish(ids);
          }, 250);
        },
        onError: () => finish([]),
      },
    });
    setTimeout(() => finish([]), 12000);
  });
}
