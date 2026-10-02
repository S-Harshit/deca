import { useEffect, useRef } from "react";
import { newRun, step, JUMP_T, ROLL_T, VIEW, type Obstacle, type Run } from "../runnerSim";
import { setRunner } from "../runner";
import { Icon } from "./Icons";

const CAM = 1.6; // the camera sits this far behind the runner, so things reach the runner at z = 0

type Cmd = { z: number; draw: () => void };

/** Cheap deterministic noise for scenery, so buildings are stable as they scroll past. */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function accent(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#c6f432";
}

/**
 * An original endless runner that plays itself, drawn in code: three tracks, trains to dodge, barriers to hop,
 * bars to roll under, coins. Purely decorative and local (nobody else sees it), and it never makes a sound.
 */
export function RunnerStrip() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvas.current;
    const box = wrap.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !box || !ctx) return;
    const run: Run = newRun();
    let W = 0;
    let H = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = box.clientWidth;
      H = box.clientHeight;
      cv.width = Math.max(1, Math.round(W * dpr));
      cv.height = Math.max(1, Math.round(H * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    let color = accent();
    let colorAt = 0;

    // ---- projection: world (lane, height, z ahead of the runner) -> screen
    const proj = (z: number) => 1 / (1 + Math.max(-1, z + CAM) * 0.075);
    const horizon = () => H * 0.3;
    const groundY = (z: number) => horizon() + (H * 0.9 - horizon()) * proj(z);
    const laneU = () => H * 0.42; // pixels per lane at the runner
    const hu = () => H * 0.36; // pixels per unit of height at the runner
    const X = (lane: number, z: number) => W / 2 + lane * laneU() * proj(z);
    const Y = (h: number, z: number) => groundY(z) - h * hu() * proj(z);
    const fog = (z: number) => Math.min(1, Math.max(0, z / VIEW));
    const shade = (h: number, s: number, l: number, z: number) => `hsl(${h} ${Math.round(s * (1 - fog(z) * 0.55))}% ${Math.round(l + fog(z) * 16)}%)`;

    const quad = (a: [number, number], b: [number, number], c: [number, number], d: [number, number], fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.lineTo(c[0], c[1]);
      ctx.lineTo(d[0], d[1]);
      ctx.closePath();
      ctx.fill();
    };

    const sky = () => {
      const g = ctx.createLinearGradient(0, 0, 0, horizon() + 8);
      g.addColorStop(0, "#15183f");
      g.addColorStop(0.55, "#5a3a78");
      g.addColorStop(1, "#f0905c");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, horizon() + 8);
      // far skyline, scrolling slowly sideways with distance travelled
      const off = run.dist * 0.6;
      for (let layer = 0; layer < 2; layer++) {
        const unit = H * (0.2 + layer * 0.1);
        const parallax = off * (0.15 + layer * 0.12);
        ctx.fillStyle = layer ? "#241a3d" : "#33244f";
        for (let i = -2; i < W / unit + 3; i++) {
          const idx = i + Math.floor(parallax / unit) + layer * 97;
          const bw = unit * (0.7 + hash(idx) * 0.9);
          const bh = H * (0.1 + hash(idx + 5) * 0.2) * (layer ? 1.2 : 1);
          const x = i * unit - (parallax % unit);
          ctx.fillRect(x, horizon() - bh, bw, bh + 2);
        }
      }
    };

    const ground = () => {
      const g = ctx.createLinearGradient(0, horizon(), 0, H);
      g.addColorStop(0, "#2a2140");
      g.addColorStop(1, "#15112a");
      ctx.fillStyle = g;
      ctx.fillRect(0, horizon(), W, H - horizon());
      // gravel bed under the three tracks
      quad([X(-1.7, VIEW), groundY(VIEW)], [X(1.7, VIEW), groundY(VIEW)], [X(1.7, -CAM + 0.01), groundY(-CAM + 0.01)], [X(-1.7, -CAM + 0.01), groundY(-CAM + 0.01)], "#3a3452");
      // sleepers scrolling towards the camera
      const gap = 1.6;
      ctx.lineWidth = Math.max(1, H * 0.012);
      for (let z = -((run.dist % gap) + 0); z < VIEW; z += gap) {
        if (z < -CAM + 0.05) continue;
        ctx.strokeStyle = shade(30, 28, 24, z);
        ctx.beginPath();
        ctx.moveTo(X(-1.55, z), groundY(z));
        ctx.lineTo(X(1.55, z), groundY(z));
        ctx.stroke();
      }
      // rails
      ctx.lineWidth = Math.max(1, H * 0.01);
      ctx.strokeStyle = "#a9a4c4";
      for (const lane of [-1, 0, 1]) {
        for (const side of [-0.28, 0.28]) {
          ctx.beginPath();
          ctx.moveTo(X(lane + side, -CAM + 0.01), groundY(-CAM + 0.01));
          ctx.lineTo(X(lane + side, VIEW), groundY(VIEW));
          ctx.stroke();
        }
      }
    };

    const building = (side: -1 | 1, idx: number, z: number, cmds: Cmd[]) => {
      const lat = 2.2 + hash(idx + 3) * 2.6;
      const h = 1.6 + hash(idx + 9) * 4.2;
      const w = 1.4 + hash(idx + 1) * 1.2;
      const hue = 235 + Math.floor(hash(idx + 7) * 70);
      cmds.push({
        z,
        draw: () => {
          const x0 = side * lat;
          const x1 = side * (lat + w);
          const zn = Math.max(z, -CAM + 0.05);
          const zf = z + 4;
          // inner side face (towards the tracks), then the front face
          quad([X(x0, zn), Y(0, zn)], [X(x0, zf), Y(0, zf)], [X(x0, zf), Y(h, zf)], [X(x0, zn), Y(h, zn)], shade(hue, 35, 22, z));
          quad([X(x0, zn), Y(0, zn)], [X(x1, zn), Y(0, zn)], [X(x1, zn), Y(h, zn)], [X(x0, zn), Y(h, zn)], shade(hue, 38, 27, z));
          // a few lit windows
          ctx.fillStyle = shade(45, 90, 62, z);
          for (let r = 0; r < 4; r++)
            for (let c = 0; c < 2; c++) {
              if (hash(idx * 7 + r * 3 + c) < 0.55) continue;
              const wx = x0 + (x1 - x0) * (0.2 + c * 0.42);
              const wy = h * (0.18 + r * 0.2);
              const sz = proj(zn) * H * 0.045;
              ctx.fillRect(X(wx, zn), Y(wy, zn), sz, sz * 1.2);
            }
        },
      });
    };

    const item = (o: Obstacle, cmds: Cmd[]) => {
      const z = o.z;
      if (z + o.len < -CAM + 0.05) return;
      cmds.push({
        z: z + o.len * 0.5,
        draw: () => {
          const lane = o.lane;
          if (o.kind === "train") {
            const zn = Math.max(z, -CAM + 0.05);
            const zf = Math.min(z + o.len, VIEW);
            const hh = 1.75;
            const l = lane - 0.42;
            const r = lane + 0.42;
            const side = lane === 0 ? 0 : lane < 0 ? r : l; // the face turned towards the camera's centre line
            if (lane !== 0) quad([X(side, zn), Y(0.1, zn)], [X(side, zf), Y(0.1, zf)], [X(side, zf), Y(hh, zf)], [X(side, zn), Y(hh, zn)], shade(o.hue, 50, 30, z));
            quad([X(l, zn), Y(hh, zn)], [X(r, zn), Y(hh, zn)], [X(r, zf), Y(hh, zf)], [X(l, zf), Y(hh, zf)], shade(o.hue, 55, 52, z));
            if (z > -CAM + 0.05) {
              quad([X(l, zn), Y(0.1, zn)], [X(r, zn), Y(0.1, zn)], [X(r, zn), Y(hh, zn)], [X(l, zn), Y(hh, zn)], shade(o.hue, 55, 42, z));
              const s = proj(zn);
              ctx.fillStyle = shade(190, 60, 80, z);
              const ww = (X(r, zn) - X(l, zn)) * 0.34;
              ctx.fillRect(X(l, zn) + (X(r, zn) - X(l, zn)) * 0.08, Y(1.45, zn), ww, hu() * 0.55 * s);
              ctx.fillRect(X(l, zn) + (X(r, zn) - X(l, zn)) * 0.58, Y(1.45, zn), ww, hu() * 0.55 * s);
              ctx.fillStyle = "#fff6b0";
              ctx.beginPath();
              ctx.arc(X(lane - 0.26, zn), Y(0.4, zn), hu() * 0.07 * s, 0, 7);
              ctx.arc(X(lane + 0.26, zn), Y(0.4, zn), hu() * 0.07 * s, 0, 7);
              ctx.fill();
            }
          } else if (o.kind === "barrier") {
            const zn = Math.max(z, -CAM + 0.05);
            const l = lane - 0.4;
            const r = lane + 0.4;
            quad([X(l, zn), Y(0.1, zn)], [X(r, zn), Y(0.1, zn)], [X(r, zn), Y(0.62, zn)], [X(l, zn), Y(0.62, zn)], shade(35, 90, 52, z));
            ctx.fillStyle = shade(0, 0, 12, z);
            const stripes = 4;
            for (let i = 0; i < stripes; i += 2) {
              const a = l + ((r - l) * i) / stripes;
              const b = l + ((r - l) * (i + 1)) / stripes;
              quad([X(a, zn), Y(0.1, zn)], [X(b, zn), Y(0.1, zn)], [X(b, zn), Y(0.62, zn)], [X(a, zn), Y(0.62, zn)], shade(0, 0, 14, z));
            }
          } else if (o.kind === "bar") {
            const zn = Math.max(z, -CAM + 0.05);
            const l = lane - 0.42;
            const r = lane + 0.42;
            const post = (x: number) => quad([X(x - 0.04, zn), Y(0, zn)], [X(x + 0.04, zn), Y(0, zn)], [X(x + 0.04, zn), Y(1.2, zn)], [X(x - 0.04, zn), Y(1.2, zn)], shade(220, 12, 55, z));
            post(l);
            post(r);
            quad([X(l - 0.04, zn), Y(1.18, zn)], [X(r + 0.04, zn), Y(1.18, zn)], [X(r + 0.04, zn), Y(0.82, zn)], [X(l - 0.04, zn), Y(0.82, zn)], shade(2, 75, 50, z));
          } else {
            const s = proj(z);
            const spin = Math.abs(Math.cos(run.t * 6 + z * 0.9));
            ctx.fillStyle = shade(48, 100, 55, z);
            ctx.beginPath();
            ctx.ellipse(X(lane, z), Y(0.6, z), Math.max(0.5, hu() * 0.12 * s * (0.25 + 0.75 * spin)), Math.max(0.5, hu() * 0.12 * s), 0, 0, 7);
            ctx.fill();
          }
        },
      });
    };

    const player = () => {
      const lane = run.lane;
      const z = 0;
      const s = proj(z);
      const jumpH = run.move === "jump" ? Math.sin((run.moveT / JUMP_T) * Math.PI) : 0;
      const rolling = run.move === "roll";
      const swing = Math.sin(run.t * 15);
      const px = X(lane, z);
      const feet = groundY(z) - jumpH * hu() * 1.1 * s;
      // shadow stays on the ground
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.beginPath();
      ctx.ellipse(px, groundY(z) + 2, hu() * 0.3 * s * (1 - jumpH * 0.4), hu() * 0.07 * s, 0, 0, 7);
      ctx.fill();
      const u = hu() * s;
      if (run.grace > 0.01 && Math.floor(run.t * 12) % 2 === 0 && run.crashes > 0) ctx.globalAlpha = 0.45;
      if (rolling) {
        // a tucked ball
        const spinA = (run.moveT / ROLL_T) * Math.PI * 2;
        ctx.save();
        ctx.translate(px, feet - u * 0.3);
        ctx.rotate(spinA);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(0, 0, u * 0.3, 0, 7);
        ctx.fill();
        ctx.fillStyle = "#f2c9a0";
        ctx.beginPath();
        ctx.arc(u * 0.14, -u * 0.12, u * 0.13, 0, 7);
        ctx.fill();
        ctx.restore();
      } else {
        const leg = jumpH > 0 ? 0.2 : swing * 0.28;
        ctx.strokeStyle = "#2b2b44";
        ctx.lineWidth = u * 0.13;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(px - u * 0.07, feet - u * 0.42);
        ctx.lineTo(px - u * 0.07 + leg * u, feet);
        ctx.moveTo(px + u * 0.07, feet - u * 0.42);
        ctx.lineTo(px + u * 0.07 - leg * u, feet);
        ctx.stroke();
        ctx.fillStyle = color; // jacket in the theme's accent
        ctx.beginPath();
        ctx.roundRect(px - u * 0.17, feet - u * 0.82, u * 0.34, u * 0.46, u * 0.08);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = u * 0.09;
        ctx.beginPath();
        const arm = jumpH > 0 ? -0.35 : -swing * 0.3;
        ctx.moveTo(px - u * 0.17, feet - u * 0.74);
        ctx.lineTo(px - u * 0.27 + arm * u, feet - u * 0.5);
        ctx.moveTo(px + u * 0.17, feet - u * 0.74);
        ctx.lineTo(px + u * 0.27 - arm * u, feet - u * 0.5);
        ctx.stroke();
        ctx.fillStyle = "#f2c9a0";
        ctx.beginPath();
        ctx.arc(px, feet - u * 0.95, u * 0.14, 0, 7);
        ctx.fill();
        ctx.fillStyle = "#2b2b44"; // cap
        ctx.beginPath();
        ctx.arc(px, feet - u * 0.99, u * 0.145, Math.PI, 0);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const hud = () => {
      ctx.font = `600 ${Math.max(11, Math.round(H * 0.085))}px ui-monospace, Menlo, monospace`;
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(0,0,0,.45)";
      const label = `${run.coins} coins   ${Math.floor(run.dist)} m`;
      const tw = ctx.measureText(label).width;
      ctx.beginPath();
      ctx.roundRect(8, 8, tw + 16, H * 0.085 + 12, 6);
      ctx.fill();
      ctx.fillStyle = "#ffe27a";
      ctx.fillText(label, 16, 14);
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      sky();
      ground();
      const cmds: Cmd[] = [];
      const spacing = 5;
      const first = Math.floor(run.dist / spacing);
      for (let i = first; i < first + VIEW / spacing + 2; i++) {
        const z = i * spacing - run.dist;
        if (z < -CAM) continue;
        building(-1, i * 2, z, cmds);
        building(1, i * 2 + 1, z, cmds);
      }
      for (const o of run.items) if (o.z < VIEW) item(o, cmds);
      cmds.sort((a, b) => b.z - a.z);
      for (const c of cmds) c.draw();
      player();
      hud();
    };

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      let n = 0;
      while (acc >= 1 / 60 && n++ < 6) {
        step(run, 1 / 60);
        acc -= 1 / 60;
      }
      if (now - colorAt > 1500) {
        color = accent();
        colorAt = now;
      }
      draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="runner-strip" ref={wrap}>
      <canvas ref={canvas} role="img" aria-label="A decorative endless runner that plays itself. Type /run off to hide it." />
      <button className="icon-btn small runner-close" aria-label="Hide the runner" title="Hide (or type /run off)" onClick={() => setRunner(false)}>
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
