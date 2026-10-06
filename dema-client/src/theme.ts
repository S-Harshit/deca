import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { accentFrom } from "./wallpaper";

export type ThemeId = "midnight" | "light" | "graphite" | "forest" | "rose" | "sunset" | "shadcn";

/** `colors` is [background, surface, accent], only used to draw the swatch. */
export const THEMES: { id: ThemeId; label: string; colors: [string, string, string] }[] = [
  { id: "midnight", label: "Midnight", colors: ["#0f1115", "#1e222b", "#7c83ff"] },
  { id: "graphite", label: "Graphite", colors: ["#151515", "#262626", "#c6f432"] },
  { id: "light", label: "Light", colors: ["#f4f5f8", "#ffffff", "#5b62e6"] },
  { id: "forest", label: "Forest", colors: ["#0d1512", "#1a2a24", "#3ddc97"] },
  { id: "rose", label: "Rosé", colors: ["#fbf3f4", "#ffffff", "#cf374c"] },
  { id: "sunset", label: "Sunset", colors: ["#1a1214", "#2b1d20", "#ff9a5a"] },
  { id: "shadcn", label: "Zinc", colors: ["#ffffff", "#f4f4f5", "#18181b"] },
];

export const ACCENTS = ["#c6f432", "#7c83ff", "#3ddc97", "#ff6b7a", "#ffb454", "#4cc9f0", "#c77dff"];
export const SCALES = [
  { label: "S", value: 0.9 },
  { label: "M", value: 1 },
  { label: "L", value: 1.12 },
  { label: "XL", value: 1.25 },
];
export const RADII = [
  { label: "Sharp", value: 4 },
  { label: "Soft", value: 8 },
  { label: "Round", value: 18 },
];

export type Prefs = {
  theme: ThemeId;
  /** null = use the theme's own accent */
  accent: string | null;
  scale: number;
  compact: boolean;
  radius: number;
  /** Which home screen to show: one calm card, or the original two-column "ticket". */
  home: "simple" | "classic";
  /** Play the host's air horn on this device (the visual alert always shows). */
  hornSound: boolean;
  /** Show pictures from image links inline. Fetching them reveals your IP to the image host. */
  linkPreviews: boolean;
  /** Sidebar width in px; null = the stylesheet's default. */
  sidebarW: number | null;
  /** Sidebar panels the user has folded away (by slot id). */
  collapsed: string[];
  /** Timestamp style in chat. */
  clock: "auto" | "12" | "24";
  /** Show the unread count in the tab title while the tab is in the background. */
  titleBadge: boolean;
  /** A personal wallpaper is set (the picture itself is in IndexedDB, only on this device). */
  wallpaper: boolean;
  /** How much the theme colour covers the picture (percent) and how blurred it is (px). */
  wallDim: number;
  wallBlur: number;
  /** Take the accent from the picture: its opposite colour, its own colour, or leave the accent alone. */
  wallAccent: "complement" | "match" | "off";
  wallHue: number;
  wallSat: number;
  wallColorful: boolean;
  /** Bumped whenever a new picture is saved, so the page reloads the background even though "a wallpaper is set" did not change. */
  wallRev: number;
};

const LIGHT_THEMES: ThemeId[] = ["light", "rose", "shadcn"];

export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 440;

const KEY = "deca.prefs";

function defaults(): Prefs {
  return { theme: "graphite", accent: null, scale: 1, compact: false, radius: 8, linkPreviews: true, home: "simple", hornSound: true, sidebarW: null, collapsed: [], clock: "auto", titleBadge: true, wallpaper: false, wallDim: 55, wallBlur: 0, wallAccent: "complement", wallHue: 210, wallSat: 0, wallColorful: false, wallRev: 0 };
}

/** Stored values come from the user's own browser but can be stale, hand-edited or from another version. */
function sanitize(p: Prefs): Prefs {
  const d = defaults();
  const w = typeof p.sidebarW === "number" && Number.isFinite(p.sidebarW) ? Math.round(p.sidebarW) : null;
  return {
    ...p,
    sidebarW: w === null ? null : Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)),
    collapsed: Array.isArray(p.collapsed) ? p.collapsed.filter((c) => typeof c === "string").slice(0, 8) : d.collapsed,
    clock: p.clock === "12" || p.clock === "24" ? p.clock : "auto",
    titleBadge: typeof p.titleBadge === "boolean" ? p.titleBadge : d.titleBadge,
    wallpaper: p.wallpaper === true,
    wallDim: typeof p.wallDim === "number" && Number.isFinite(p.wallDim) ? Math.min(90, Math.max(0, Math.round(p.wallDim))) : d.wallDim,
    wallBlur: typeof p.wallBlur === "number" && Number.isFinite(p.wallBlur) ? Math.min(16, Math.max(0, Math.round(p.wallBlur))) : d.wallBlur,
    wallAccent: p.wallAccent === "match" || p.wallAccent === "off" ? p.wallAccent : "complement",
    wallHue: typeof p.wallHue === "number" && Number.isFinite(p.wallHue) ? ((p.wallHue % 360) + 360) % 360 : d.wallHue,
    wallSat: typeof p.wallSat === "number" && Number.isFinite(p.wallSat) ? Math.min(1, Math.max(0, p.wallSat)) : d.wallSat,
    wallColorful: p.wallColorful === true,
    wallRev: typeof p.wallRev === "number" && Number.isFinite(p.wallRev) ? Math.max(0, Math.floor(p.wallRev)) : 0,
  };
}

function load(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (saved && (THEMES.some((t) => t.id === saved.theme))) return sanitize({ ...defaults(), ...saved });
  } catch {
    // storage unavailable or corrupt: fall back to defaults
  }
  return defaults();
}

/** Readable text colour on top of an arbitrary accent. */
function onAccent(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111" : "#fff";
}

export function applyPrefs(p: Prefs) {
  const root = document.documentElement;
  root.dataset.theme = p.theme;
  root.dataset.compact = String(p.compact);
  root.style.fontSize = `${16 * p.scale}px`;
  root.style.setProperty("--radius", `${p.radius}px`);
  // The wallpaper's colour takes over the accent unless the person turned that off.
  const fromWall =
    p.wallpaper && p.wallAccent !== "off"
      ? accentFrom({ hue: p.wallHue, sat: p.wallSat, colorful: p.wallColorful }, p.wallAccent, !LIGHT_THEMES.includes(p.theme))
      : null;
  const accent = fromWall ?? p.accent;
  const wall = p.wallpaper;
  root.dataset.wall = wall ? "on" : "";
  root.style.setProperty("--wall-dim", `${p.wallDim}%`);
  root.style.setProperty("--wall-blur", `${p.wallBlur}px`);
  if (accent) {
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--on-accent", onAccent(accent));
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--on-accent");
  }
}

export type PrefsApi = { prefs: Prefs; update: (patch: Partial<Prefs>) => void; reset: () => void };
export const PrefsContext = createContext<PrefsApi | null>(null);
/** Current preferences for components deep in the tree. */
export const usePrefsValue = () => useContext(PrefsContext)?.prefs ?? defaults();
/** The setters too, for things like slash commands. */
export const usePrefsApi = () => useContext(PrefsContext);

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(load);

  useEffect(() => {
    applyPrefs(prefs);
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      // not persisted; still applied for this session
    }
  }, [prefs]);

  const update = useCallback((patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch })), []);
  const reset = useCallback(() => setPrefs(defaults()), []);
  return { prefs, update, reset };
}
