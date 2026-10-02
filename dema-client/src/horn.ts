// An air horn made from scratch with the Web Audio API: no audio file to load or license.
// Loudness is bounded on purpose: everything goes through a compressor and then a fixed gain
// ceiling, so the peak can never exceed CEILING (-6 dBFS) however the tones stack up.

/** Linear peak ceiling. 0.5 is -6 dBFS: loud enough to wake people, and a 1.7 s burst with a hard cap, not a sustained level. */
export const CEILING = 0.5;
export const HORN_SECONDS = 1.7;

/** Builds the horn on any audio context (live or offline, so tests can measure it). */
export function buildHorn(ctx: BaseAudioContext, start = ctx.currentTime) {
  const out = ctx.createGain();
  out.gain.value = CEILING;
  out.connect(ctx.destination);

  // Catches any overshoot from stacked tones before the fixed ceiling.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 12;
  comp.ratio.value = 14;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  comp.connect(out);

  // 40 ms attack (no click), steady blast, short release.
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(1, start + 0.04);
  env.gain.setValueAtTime(1, start + HORN_SECONDS - 0.3);
  env.gain.linearRampToValueAtTime(0, start + HORN_SECONDS);
  env.connect(comp);

  // The horn's brassy, nasal colour.
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 3200;
  const body = ctx.createBiquadFilter();
  body.type = "peaking";
  body.frequency.value = 1200;
  body.gain.value = 6;
  tone.connect(body);
  body.connect(env);

  // A stacked chord (F#4, A#4, C#5), each note doubled and slightly detuned, with a touch of vibrato.
  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 6;
  const vibratoDepth = ctx.createGain();
  vibratoDepth.gain.value = 3;
  vibrato.connect(vibratoDepth);
  const stop = start + HORN_SECONDS + 0.05;
  for (const f of [370, 466, 554]) {
    for (const cents of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f, start);
      o.frequency.linearRampToValueAtTime(f * 0.985, start + HORN_SECONDS); // the pitch sags a little as the air runs out
      o.detune.value = cents;
      vibratoDepth.connect(o.frequency);
      const g = ctx.createGain();
      g.gain.value = 0.3;
      o.connect(g);
      g.connect(tone);
      o.start(start);
      o.stop(stop);
    }
  }
  vibrato.start(start);
  vibrato.stop(stop);
}

let ctx: AudioContext | null = null;

/** Create/resume the audio context. Call from a click or key press so browsers allow sound later. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    // no Web Audio here: the horn simply stays silent (the visual alert still shows)
  }
}

/** Returns false if the browser would not let it play (no tap yet, or audio unavailable). */
export async function playHorn(): Promise<boolean> {
  unlockAudio();
  if (!ctx) return false;
  if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
  if (ctx.state !== "running") return false;
  buildHorn(ctx);
  return true;
}
