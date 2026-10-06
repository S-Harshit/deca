import { accentFrom, dominantHue } from "../.build/wallpaper.ts";
const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const cr = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
for (const [name, bgs, dark] of [["dark", ["#1d1d1d", "#171a21", "#13201b", "#231719"], true], ["light", ["#ffffff", "#fafafa"], false]] as const) {
  let min = 99, at = 0;
  for (let h = 0; h < 360; h += 5) for (const mode of ["complement", "match"] as const) {
    const hex = accentFrom({ hue: h, sat: 0.8, colorful: true }, mode, dark)!;
    for (const bg of bgs) { const c = cr(hex, bg); if (c < min) { min = c; at = h; } }
  }
  console.log(name, "worst contrast of the accent against panels:", min.toFixed(2), "at hue", at);
}
// dominant hue on synthetic pictures
const px = (rgb: number[], n: number) => { const a = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) a.set([...rgb, 255], i * 4); return a; };
const cat = (...parts: Uint8ClampedArray[]) => { const out = new Uint8ClampedArray(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const show = (n: string, d: Uint8ClampedArray) => { const p = dominantHue(d); console.log(n.padEnd(34), JSON.stringify({ hue: p.hue, sat: +p.sat.toFixed(2), colorful: p.colorful }), "opposite", accentFrom(p, "complement", true), "same", accentFrom(p, "match", true)); };
show("blue sky", px([40, 90, 220], 2304));
show("red", px([220, 40, 40], 2304));
show("green", px([40, 200, 80], 2304));
show("grey", px([128, 128, 128], 2304));
show("black", px([5, 5, 5], 2304));
show("white", px([250, 250, 250], 2304));
show("70% blue 30% orange", cat(px([40, 90, 220], 1600), px([240, 140, 30], 704)));
show("mostly grey, a little red (1%)", cat(px([128, 128, 128], 2280), px([220, 40, 40], 24)));
show("mostly grey, some red (10%)", cat(px([128, 128, 128], 2070), px([220, 40, 40], 234)));
show("hue split across the 0 boundary", cat(px([220, 30, 60], 1000), px([220, 60, 30], 1000)));
