/**
 * Browsers hide your Wi-Fi address behind a random ".local" name unless the page has been allowed to use the microphone or
 * camera. The other device then has to look that name up, which many routers and phones do not manage, and the fallback (the
 * shared public address) needs the router to loop traffic back inside the network, which many do not do either.
 *
 * So in a room with no server, joining can ask for the microphone once. Nothing is recorded or sent: the track is switched off
 * and never connected to anything. It only lets the browser put its real local address into the code, so two devices on the
 * same Wi-Fi can connect straight to each other. The permission is released as soon as the first link is up.
 */
export async function revealLocalAddress(): Promise<MediaStream | null> {
  try {
    if (!navigator.mediaDevices?.getUserMedia) return null;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of stream.getAudioTracks()) t.enabled = false; // silent: nothing is captured
    return stream;
  } catch {
    return null; // refused or no microphone: the exchange still works, just by the slower routes
  }
}

export const stopStream = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop());

export type Addresses = { real: number; hidden: number; public: number; relay: number };

/** What kinds of address a set of connection messages carries (for the "not connecting?" help). */
export function countAddresses(items: unknown[]): Addresses {
  const out: Addresses = { real: 0, hidden: 0, public: 0, relay: 0 };
  const lines: string[] = [];
  type Item = { candidate?: { candidate?: unknown }; description?: { sdp?: unknown } };
  for (const it of items as Item[]) {
    if (typeof it?.candidate?.candidate === "string") lines.push(it.candidate.candidate);
    if (typeof it?.description?.sdp === "string") for (const l of it.description.sdp.split(/\r?\n/)) if (l.startsWith("a=candidate:")) lines.push(l.slice(2));
  }
  for (const l of new Set(lines)) {
    const f = l.split(" ");
    const addr = f[4] ?? "";
    const type = f[7];
    if (type === "host") {
      if (addr.endsWith(".local")) out.hidden++;
      else out.real++;
    }
    else if (type === "srflx") out.public++;
    else if (type === "relay") out.relay++;
  }
  return out;
}
