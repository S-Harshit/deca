import { derive, type SpaceEvent } from "../.build/log.ts";
const ev = (id: string, author: string, ts: number, type: any, payload: any = {}): SpaceEvent => ({ id, author, ts, type, payload });
const base = [ev("j1", "H", 1, "joined", { name: "Host" })];
for (const [t, p] of [["chat", { text: "hi" }], ["coin", { result: "heads" }], ["rps", { throw: "rock" }], ["file_offer", { fileId: "f", name: "n", size: 1 }]] as const)
  console.log(t, "from a never-joined author is visible:", derive([...base, ev("x", "X", 2, t as any, p)], "H").visible.some((e) => e.id === "x"));
