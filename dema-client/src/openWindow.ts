import { notify } from "./toast";

/**
 * Open a link as its own small browser window beside this one. A real window works for every site; showing a site
 * inside the page would not, because most sites forbid being framed. Only web links, and the new page gets no handle on this one.
 */
export function openAsWindow(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  const w = Math.min(520, Math.max(320, screen.availWidth - 80));
  const h = Math.min(760, Math.max(360, screen.availHeight - 80));
  const left = Math.max(0, (window.screenX || 0) + (window.outerWidth || w) - w - 24);
  const top = Math.max(0, (window.screenY || 0) + 60);
  const win = window.open(url, "_blank", `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if (!win) return void notify("Your browser blocked the window. Allow pop-ups for this site, or click the link instead.", "error");
  try {
    win.opener = null; // the site cannot reach back into Deca
  } catch {
    // already cross-origin: nothing to cut
  }
}

/** Messages deep in the chat ask the room to open a link through this, so they need no access to the room itself. */
export const pageShare: { handler: ((url: string) => string) | null } = { handler: null };
export function shareForEveryone(url: string) {
  const err = pageShare.handler?.(url) ?? "Not connected yet";
  if (err) notify(err, "error");
  else notify("Opened for everyone: they each get a button to open it");
}
