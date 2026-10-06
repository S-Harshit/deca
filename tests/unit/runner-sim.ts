import { newRun, step } from "../.build/runnerSim.ts";
let crashes = 0, worst = 0, coins = 0, minutes = 0, laneSwitches = 0, jumps = 0, rolls = 0, trainsSeen = 0, firstCrash = "";
const SEEDS = 1500, SECONDS = 300, dt = 1 / 60;
const t0 = performance.now();
for (let seed = 1; seed <= SEEDS; seed++) {
  const r = newRun(seed); let prevT = r.target, prevMove = r.move, c = 0;
  for (let i = 0; i < SECONDS / dt; i++) {
    const hit = step(r, dt);
    if (hit) { c++; if (!firstCrash) firstCrash = `seed ${seed} at t=${r.t.toFixed(1)}s speed ${r.speed.toFixed(1)}`; }
    if (r.target !== prevT) { laneSwitches++; prevT = r.target; }
    if (r.move !== prevMove) { if (r.move === "jump") jumps++; if (r.move === "roll") rolls++; prevMove = r.move; }
  }
  crashes += c; worst = Math.max(worst, c); coins += r.coins; minutes += SECONDS / 60; trainsSeen += r.items.filter((o) => o.kind === "train").length;
}
console.log(`${SEEDS} runs x ${SECONDS / 60} min = ${minutes} minutes of play in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log(`crashes: ${crashes} (worst single run ${worst})  ${firstCrash}`);
console.log(`per minute: ${(coins / minutes).toFixed(0)} coins, ${(laneSwitches / minutes).toFixed(0)} lane switches, ${(jumps / minutes).toFixed(0)} jumps, ${(rolls / minutes).toFixed(0)} rolls`);
