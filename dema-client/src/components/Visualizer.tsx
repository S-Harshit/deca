import { useEffect, useRef } from "react";

function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * Decorative equaliser. YouTube's player lives in a cross-origin iframe, so its audio cannot be
 * analysed; these bars follow the play state and give each track its own tempo and pattern.
 */
export function Visualizer({
  playing,
  seed,
  bars = 28,
  className = "",
}: Readonly<{ playing: boolean; seed: string; bars?: number; className?: string }>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const heights = useRef<number[]>([]);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const h = hash(seed);
    const bpm = 84 + (h % 60);
    const phase = (h >>> 8) % 100;
    if (heights.current.length !== bars) heights.current = new Array(bars).fill(0.05);
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
      ctx.beginPath();

      const t = ms / 1000;
      const beat = Math.pow(Math.max(0, Math.sin((t * Math.PI * bpm) / 60)), 4); // a pulse on the beat
      const gap = 2;
      const bw = Math.max(0, (w - gap * (bars - 1)) / bars); // 0 while the canvas is hidden or folded away
      let settled = true;
      for (let i = 0; i < bars; i++) {
        const wobble =
          Math.abs(Math.sin(t * 1.7 + i * 0.55 + phase)) * 0.55 + Math.abs(Math.sin(t * 3.1 + i * 1.3 + phase * 2)) * 0.45;
        const bass = 1 - (i / bars) * 0.45; // low bars hit harder
        const target = playing && !reduce ? Math.min(1, (0.18 + wobble * 0.62 + beat * 0.25) * bass) : 0.05;
        heights.current[i] += (target - heights.current[i]) * 0.2;
        if (Math.abs(target - heights.current[i]) > 0.01) settled = false;
        const bh = Math.max(2, heights.current[i] * H);
        ctx.roundRect(i * (bw + gap), H - bh, bw, bh, Math.max(0, Math.min(2, bw / 2)));
      }
      ctx.fill(); // one fill for all the bars
      if (playing || !settled) raf = requestAnimationFrame(draw); // stop the loop once paused and at rest
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [playing, seed, bars]);

  return <canvas ref={canvas} className={`viz ${className}`} aria-hidden="true" title="Decorative: YouTube doesn't expose its audio" />;
}
