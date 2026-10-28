import { useEffect, useRef } from "react";

function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * Decorative equaliser. YouTube's player lives in a cross-origin iframe, so its audio cannot be
 * analysed; these bars follow the play state and give each track its own tempo, shape and beat: quick attack, slow release,
 * falling peak caps, a reflection, and a harder low end on the beat.
 */
export function Visualizer({
  playing,
  seed,
  bars = 40,
  className = "",
}: Readonly<{ playing: boolean; seed: string; bars?: number; className?: string }>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const heights = useRef<number[]>([]);
  const peaks = useRef<number[]>([]);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const h = hash(seed);
    const bpm = 84 + (h % 60);
    const phase = (h >>> 8) % 100;
    const style = h % 3; // each track gets its own shape: a mirrored spread, a bass-heavy slope, or a rolling wave
    if (heights.current.length !== bars) {
      heights.current = new Array(bars).fill(0.04);
      peaks.current = new Array(bars).fill(0.04);
    }
    let raf = 0;
    let lastDraw = 0;
    let frame = 0;
    let color = "";

    const draw = (ms: number) => {
      // ~30fps is plenty for a decoration and halves the cost
      if (ms - lastDraw < 32) {
        raf = requestAnimationFrame(draw);
        return;
      }
      lastDraw = ms;
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth;
      const H = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, H);
      if (frame++ % 30 === 0) color = getComputedStyle(cv).color; // style reads are costly: refresh occasionally
      ctx.fillStyle = color;

      const t = ms / 1000;
      const beatPhase = (t * bpm) / 60;
      const beat = Math.pow(Math.max(0, Math.sin(beatPhase * Math.PI)), 6); // a sharp pulse on every beat
      const bar = Math.pow(Math.max(0, Math.sin((beatPhase / 4) * Math.PI)), 3); // and a bigger swell every fourth
      const gap = Math.max(1, Math.min(3, w / bars / 6));
      const bw = Math.max(0, (w - gap * (bars - 1)) / bars); // 0 while the canvas is hidden or folded away
      const mid = H * 0.62; // the bars rise from here; their reflection falls below
      let settled = true;
      for (let i = 0; i < bars; i++) {
        const x = i / (bars - 1);
        const wobble = Math.abs(Math.sin(t * 1.7 + i * 0.55 + phase)) * 0.5 + Math.abs(Math.sin(t * 3.1 + i * 1.3 + phase * 2)) * 0.5;
        const shape = style === 0 ? 1 - Math.abs(x - 0.5) * 0.9 : style === 1 ? 1 - x * 0.55 : 0.55 + Math.sin(x * Math.PI * 2 + t * 1.4) * 0.35;
        const kick = beat * (x < 0.3 ? 0.4 : 0.15) + bar * 0.12; // the low end takes the hit on the beat
        const target = playing && !reduce ? Math.min(1, (0.14 + wobble * 0.55) * shape + kick) : 0.04;
        const cur = heights.current[i];
        heights.current[i] = cur + (target - cur) * (target > cur ? 0.42 : 0.13); // quick attack, slow release
        if (Math.abs(target - heights.current[i]) > 0.01) settled = false;
        peaks.current[i] = Math.max(heights.current[i], peaks.current[i] - 0.012); // the cap falls under gravity
        const up = Math.max(2, heights.current[i] * mid);
        const left = i * (bw + gap);
        const r = Math.max(0, Math.min(2.5, bw / 2));
        ctx.globalAlpha = 0.95;
        ctx.beginPath();
        ctx.roundRect(left, mid - up, bw, up, r);
        ctx.fill();
        ctx.globalAlpha = 0.28; // the reflection
        ctx.beginPath();
        ctx.roundRect(left, mid + 2, bw, Math.min(H - mid - 2, up * 0.45), r);
        ctx.fill();
        if (playing && peaks.current[i] - heights.current[i] > 0.02) {
          ctx.globalAlpha = 0.85; // the falling cap
          ctx.fillRect(left, mid - peaks.current[i] * mid - 3, bw, 2);
        }
        if (peaks.current[i] - heights.current[i] > 0.01) settled = false;
      }
      ctx.globalAlpha = 1;
      if (playing || !settled) raf = requestAnimationFrame(draw); // stop the loop once paused and at rest
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [playing, seed, bars]);

  return <canvas ref={canvas} className={`viz ${className}`} aria-hidden="true" title="Decorative: YouTube doesn't expose its audio" />;
}
