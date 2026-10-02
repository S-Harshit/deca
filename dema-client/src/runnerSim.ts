/**
 * An endless three-lane runner that plays itself (an original take on the "satisfying gameplay clip" genre).
 * Pure logic, no drawing: the world scrolls towards the camera, an autopilot dodges trains by changing lane,
 * hops low barriers and rolls under high bars, and picks up coins. The generator always leaves a path the
 * autopilot can follow, which runnerSim's tests check over many hours of simulated play.
 */

export type Kind = "train" | "barrier" | "bar" | "coin";
export type Obstacle = { kind: Kind; lane: -1 | 0 | 1; z: number; len: number; hue: number };
export type Move = "run" | "jump" | "roll";
export type Run = {
  t: number;
  speed: number;
  dist: number;
  coins: number;
  lane: number; // continuous: eased towards `target`
  target: -1 | 0 | 1;
  move: Move;
  moveT: number; // seconds into the current jump/roll
  items: Obstacle[];
  nextRow: number; // distance at which the next row spawns
  path: -1 | 0 | 1; // a lane the generator keeps clear of trains in the latest row
  crashes: number;
  /** What the last crash was, for debugging. */
  lastHit?: { kind: Kind; lane: number; at: number; player: number; target: number; move: Move; moveT: number };
  grace: number;
  rng: () => number;
};

export const LANES = [-1, 0, 1] as const;
export const VIEW = 70; // how far ahead things exist (world units)
export const JUMP_T = 0.62;
export const ROLL_T = 0.5;
const LANE_SPEED = 9; // lanes per second when switching (fast, like the real thing)
const MIN_GAP_SEC = 0.95; // time between rows, so a reaction is always possible

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newRun(seed = Date.now()): Run {
  const run: Run = { t: 0, speed: 16, dist: 0, coins: 0, lane: 0, target: 0, move: "run", moveT: 0, items: [], nextRow: 18, path: 0, crashes: 0, grace: 1, rng: mulberry(seed) };
  while (run.nextRow < VIEW + 20) spawnRow(run);
  return run;
}

const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

function spawnRow(run: Run) {
  const r = run.rng;
  const at = run.nextRow;
  const hue = Math.floor(r() * 360);
  // the guaranteed path moves at most one lane per row
  const path = pick(r, LANES.filter((l) => Math.abs(l - run.path) <= 1)) as -1 | 0 | 1;
  const roll = r();
  let gapSec = MIN_GAP_SEC + r() * 0.9;
  if (roll < 0.34) {
    // trains in one or two lanes, never the path lane
    const lanes = LANES.filter((l) => l !== path && r() < 0.8);
    const len = 7 + r() * 9;
    for (const lane of lanes) run.items.push({ kind: "train", lane, z: at, len, hue });
    gapSec += len / run.speed; // the row lasts as long as the train does
    if (r() < 0.7) for (let i = 0; i < 5; i++) run.items.push({ kind: "coin", lane: path, z: at + i * 2.2, len: 0.8, hue });
  } else if (roll < 0.58) {
    for (const lane of LANES) if (r() < 0.75 || lane === path) run.items.push({ kind: "barrier", lane, z: at, len: 0.8, hue });
    for (let i = 0; i < 3; i++) run.items.push({ kind: "coin", lane: path, z: at - 3 + i * 1.5, len: 0.8, hue });
    gapSec += 0.3;
  } else if (roll < 0.78) {
    for (const lane of LANES) if (r() < 0.75 || lane === path) run.items.push({ kind: "bar", lane, z: at, len: 0.6, hue });
    gapSec += 0.3;
  } else {
    for (let i = 0; i < 7; i++) run.items.push({ kind: "coin", lane: path, z: at + i * 1.8, len: 0.8, hue });
    gapSec -= 0.4;
  }
  run.path = path;
  run.nextRow = at + Math.max(MIN_GAP_SEC * 0.8, gapSec) * run.speed;
}

/** Does something solid occupy this lane at distance range [a, b] ahead of the player? */
function blockedBy(run: Run, lane: number, a: number, b: number, kinds: Kind[]) {
  return run.items.some((o) => kinds.includes(o.kind) && o.lane === lane && o.z + o.len >= a && o.z <= b);
}

/** The next row of trains ahead of z (so lane choices consider what comes after this one). */
function trainsAt(run: Run, from: number, to: number) {
  const lanes = new Set<number>();
  for (const o of run.items) if (o.kind === "train" && o.z + o.len >= from && o.z <= to) lanes.add(o.lane);
  return lanes;
}

function autopilot(run: Run) {
  const v = run.speed;
  const react = 0.55 * v + 3; // distance covered while changing lane, plus a margin
  const blockedNow = (lane: number) => trainsAt(run, 0, react + 2).has(lane);
  const here = run.target;
  if (blockedNow(here) && Math.abs(run.lane - here) < 0.15) {
    // Any lane is reachable: a hop across two lanes takes about a quarter of a second, as long as the lane in
    // between does not have a train arriving while we cross it.
    const crossable = (l: number) => Math.abs(l - here) === 1 || !trainsAt(run, 0, 0.3 * v + 2).has((here + l) / 2);
    const options = (LANES as readonly number[]).filter((l) => l !== here && !blockedNow(l) && crossable(l));
    const ahead = trainsAt(run, react + 2, react + 2 + 6 * v * 0.5);
    // prefer a lane that is also clear in the row after this one, then the nearest
    options.sort((x, y) => Number(ahead.has(x)) - Number(ahead.has(y)) || Math.abs(x - here) - Math.abs(y - here));
    if (options.length) run.target = options[0] as -1 | 0 | 1;
  } else if (!blockedNow(here)) {
    // drift towards coins when it costs nothing: a clear lane now, and one that stays clear for a good while
    // (not while a barrier or bar is about to arrive: a hop or roll in progress cannot be restarted)
    const hazard = run.items.some((o) => (o.kind === "barrier" || o.kind === "bar") && o.z > -1 && o.z < v * 1.5);
    const want = coinLane(run, react);
    if (!hazard && run.move === "run" && want !== null && want !== here && Math.abs(want - here) === 1 && !trainsAt(run, 0, react * 2.5).has(want)) run.target = want as -1 | 0 | 1;
  }
  // hop or roll when a barrier or bar reaches the lane we are in, or the one we are moving into
  if (run.move === "run") {
    const d = 0.38 * v;
    const lanes = new Set([Math.round(run.lane), run.target]);
    for (const lane of lanes) {
      if (blockedBy(run, lane, 0, d, ["barrier"])) return void startMove(run, "jump");
      if (blockedBy(run, lane, 0, d, ["bar"])) return void startMove(run, "roll");
    }
  }
}

function coinLane(run: Run, within: number): number | null {
  let best: Obstacle | null = null;
  for (const o of run.items) if (o.kind === "coin" && o.z > 1 && o.z < within * 2 && (!best || o.z < best.z)) best = o;
  return best ? best.lane : null;
}

function startMove(run: Run, move: Move) {
  run.move = move;
  run.moveT = 0;
}

/** Advance the world by dt seconds. Returns true if the autopilot hit something this step (it should not). */
export function step(run: Run, dt: number): boolean {
  run.t += dt;
  run.speed = Math.min(30, 16 + run.t * 0.06);
  const dz = run.speed * dt;
  run.dist += dz;
  autopilot(run);
  // lane change
  const diff = run.target - run.lane;
  const stepL = Math.sign(diff) * Math.min(Math.abs(diff), LANE_SPEED * dt);
  run.lane += stepL;
  if (run.move !== "run") {
    run.moveT += dt;
    if (run.moveT >= (run.move === "jump" ? JUMP_T : ROLL_T)) run.move = "run";
  }
  for (const o of run.items) o.z -= dz;
  run.nextRow -= dz;
  while (run.nextRow < VIEW + 20) spawnRow(run);
  run.grace = Math.max(0, run.grace - dt);

  let hit = false;
  const lane = run.lane;
  const jumpH = run.move === "jump" ? Math.sin((run.moveT / JUMP_T) * Math.PI) : 0;
  run.items = run.items.filter((o) => {
    if (o.z + o.len < -2) return false;
    if (o.z > 0.6 || o.z + o.len < -0.3) return true; // not at the player
    if (Math.abs(o.lane - lane) > 0.55) return true; // other lane
    if (o.kind === "coin") {
      if (jumpH < 0.9) {
        run.coins++;
        return false;
      }
      return true;
    }
    if (run.grace > 0) return true;
    if (o.kind === "barrier" && jumpH > 0.35) return true; // hopped it
    if (o.kind === "bar" && run.move === "roll") return true; // rolled under it
    hit = true;
    run.lastHit = { kind: o.kind, lane: o.lane, at: o.z, player: lane, target: run.target, move: run.move, moveT: run.moveT };
    return true;
  });
  if (hit) {
    run.crashes++;
    run.grace = 1.6; // never freeze: carry on, briefly untouchable
    run.items = run.items.filter((o) => !(o.kind !== "coin" && o.z < 3 && o.z + o.len > -1));
  }
  return hit;
}
