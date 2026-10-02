import { useEffect } from "react";

/**
 * A personal wallpaper. It lives only in this browser (IndexedDB), is shown only to this person, and is
 * never sent to anyone. The picture is decoded, shrunk and re-encoded as JPEG, which also strips any metadata.
 */

const DB = "deca";
const STORE = "kv";
const KEY = "wallpaper";
const ACCEPT = /^image\/(png|jpeg|webp|gif|avif|bmp)$/;
export const WALL_MAX_INPUT = 20 * 1024 * 1024;
const LONG_EDGE = 1920;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const r = run(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

export const loadWallpaper = (): Promise<Blob | undefined> => tx("readonly", (s) => s.get(KEY) as IDBRequest<Blob | undefined>).catch(() => undefined);
export const clearWallpaper = () => tx("readwrite", (s) => s.delete(KEY)).then(() => undefined, () => undefined);

/** Where on the colour wheel (and how vividly) a picture mostly sits. `colorful` is false for near-greyscale pictures. */
export type Palette = { hue: number; sat: number; colorful: boolean };

export function dominantHue(data: Uint8ClampedArray): Palette {
  const bins = new Float64Array(36);
  const sats = new Float64Array(36);
  let weight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (max < 0.15 || d < 0.08) continue; // too dark, or grey: no hue worth following
    const s = d / max;
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const w = s * max; // vivid, bright pixels count most
    const bin = Math.floor(h / 10) % 36;
    bins[bin] += w;
    sats[bin] += w * s;
    weight += w;
  }
  const total = data.length / 4;
  if (weight < total * 0.02) return { hue: 210, sat: 0, colorful: false };
  // Smooth over neighbouring bins so a hue split across two bins still wins.
  let best = 0, bestScore = -1;
  for (let i = 0; i < 36; i++) {
    const score = bins[i] + 0.5 * (bins[(i + 35) % 36] + bins[(i + 1) % 36]);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return { hue: best * 10 + 5, sat: bins[best] ? sats[best] / bins[best] : 0, colorful: true };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

const luminance = ([r, g, b]: [number, number, number]) => {
  const c = [r, g, b].map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

/**
 * An accent from the picture's colour. "complement" is the opposite side of the colour wheel, so it stands out
 * against the picture; "match" follows the picture. The lightness is adjusted per colour until the accent reads
 * clearly on the theme's panels (the opposite of blue is yellow, which is invisible on white at a fixed lightness).
 */
export function accentFrom(p: Palette, mode: "complement" | "match", darkTheme: boolean): string | null {
  if (!p.colorful) return null;
  const h = mode === "complement" ? (p.hue + 180) % 360 : p.hue;
  const s = Math.min(0.9, Math.max(0.55, 0.5 + p.sat * 0.4));
  // Dark panels are about this bright (relative luminance) at most; light panels are white or near-white.
  const panel = darkTheme ? 0.02 : 0.95;
  const target = 4.6;
  const contrast = (rgb: [number, number, number]) => {
    const [hi, lo] = [luminance(rgb), panel].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  let l = darkTheme ? 0.62 : 0.45;
  let rgb = hslToRgb(h, s, l);
  for (let i = 0; i < 60 && contrast(rgb) < target; i++) {
    l += darkTheme ? 0.01 : -0.01;
    rgb = hslToRgb(h, s, Math.min(0.92, Math.max(0.12, l)));
  }
  return `#${rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Validate, shrink and store a picture. Returns what the accent logic needs. Throws a readable message on failure. */
export async function saveWallpaper(file: File): Promise<Palette> {
  if (!ACCEPT.test(file.type)) throw new Error("Choose a PNG, JPEG, WebP, GIF, AVIF or BMP picture.");
  if (file.size > WALL_MAX_INPUT) throw new Error("That picture is over 20 MB.");
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error("That picture could not be read.");
  }
  const scale = Math.min(1, LONG_EDGE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot process pictures.");
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const small = document.createElement("canvas");
  small.width = small.height = 48;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  sctx?.drawImage(bmp, 0, 0, 48, 48);
  bmp.close();
  const palette = sctx ? dominantHue(sctx.getImageData(0, 0, 48, 48).data) : { hue: 210, sat: 0, colorful: false };
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
  if (!blob) throw new Error("That picture could not be processed.");
  try {
    await tx("readwrite", (s) => s.put(blob, KEY));
  } catch {
    throw new Error("This browser would not save the picture (private window or storage blocked).");
  }
  return palette;
}

/** Keeps the page's `--wall-img` in step with the saved picture. */
export function useWallpaperImage(on: boolean, rev: number, forget: () => void) {
  useEffect(() => {
    const root = document.documentElement;
    if (!on) {
      root.style.removeProperty("--wall-img");
      return;
    }
    let url = "";
    let dead = false;
    void loadWallpaper().then((blob) => {
      if (dead) return;
      if (!blob) return forget(); // the picture is gone (cleared site data): drop the setting rather than show nothing
      url = URL.createObjectURL(blob);
      root.style.setProperty("--wall-img", `url("${url}")`);
    });
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [on, rev, forget]);
}
