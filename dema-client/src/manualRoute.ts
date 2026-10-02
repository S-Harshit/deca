/** The invite for a "connect by code" room: `#/m/<room>/<id of whoever shared it>/<id of the host>/<their name>`. */
export type ManualRoute = { room: string; seed: { id: string; name: string }; hostId: string };

/** Accepts a whole link, just the `#/m/...` part, or the `m/...` part pasted on its own. */
export function parseManual(input: string): ManualRoute | null {
  const m = /m\/([0-9a-f]{12})\/([0-9a-f]{16})\/([0-9a-f]{16})\/([^\s/]+)/i.exec(input);
  if (!m) return null;
  let name = m[4];
  try {
    name = decodeURIComponent(name);
  } catch {
    // a name that was not encoded: use it as it is
  }
  return { room: m[1].toLowerCase(), seed: { id: m[2].toLowerCase(), name: name.slice(0, 32) }, hostId: m[3].toLowerCase() };
}
