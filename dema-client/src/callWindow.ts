// Pop the call out into a small always-on-top window (Document Picture-in-Picture: Chrome and Edge), so the call stays in view while you
// share a screen or work in another app. Where that is not available, the nearest tile goes into the browser's ordinary
// video picture-in-picture instead. Loaded only when someone presses the button.
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Space } from "./space";
import { PipView } from "./components/PipView";

type DocPip = { requestWindow: (o?: { width?: number; height?: number }) => Promise<Window> };
const api = () => (window as unknown as { documentPictureInPicture?: DocPip }).documentPictureInPicture;

let current: { win: Window; root: Root } | null = null;

/** Opens (or closes, if already open) the floating call window. Returns how it went, for the caller to tell the person. */
export async function toggleCallWindow(space: Space): Promise<"opened" | "closed" | "video" | "none"> {
  if (current) {
    current.win.close();
    return "closed";
  }
  const dpip = api();
  if (dpip) {
    try {
      const win = await dpip.requestWindow({ width: 380, height: 260 });
      // The new window starts empty: bring the app's styles and the chosen look with it (absolute addresses: it has no base of its own).
      for (const n of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
        if (n instanceof HTMLLinkElement) {
          const l = win.document.createElement("link");
          l.rel = "stylesheet";
          l.href = n.href;
          win.document.head.appendChild(l);
        } else win.document.head.appendChild(n.cloneNode(true));
      }
      win.document.documentElement.dataset.theme = document.documentElement.dataset.theme ?? "";
      win.document.documentElement.setAttribute("style", document.documentElement.getAttribute("style") ?? "");
      win.document.body.style.margin = "0";
      const root = createRoot(win.document.body);
      const back = () => {
        window.focus();
        win.close();
      };
      root.render(createElement(PipView, { space, onBack: back }));
      current = { win, root };
      win.addEventListener("pagehide", () => {
        root.unmount();
        current = null;
      });
      return "opened";
    } catch {
      // refused (no recent click, or the browser said no): fall through to the plain video window
    }
  }
  // The nearest thing: a single tile in the browser's own picture-in-picture (a screen share first, then someone else, then us).
  const vids = [...document.querySelectorAll<HTMLVideoElement>(".tile video")].filter((v) => v.srcObject && !v.classList.contains("hidden"));
  const pick = vids.find((v) => v.closest(".tile.screen")) ?? vids.find((v) => !v.closest(".tile")?.classList.contains("local")) ?? vids[0];
  if (pick && "requestPictureInPicture" in pick) {
    try {
      await pick.requestPictureInPicture();
      return "video";
    } catch {
      return "none";
    }
  }
  return "none";
}
