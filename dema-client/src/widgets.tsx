import type { ReactNode } from "react";
import type { Snapshot, Space } from "./space";

export type WidgetContext = { space: Space; snap: Snapshot; isHost: boolean };

/**
 * A panel in the sidebar. Members, Music and Host controls are widgets registered through this, and
 * plugins (see docs/PLUGINS.md) are meant to register the same way. Each gets the fold arrow, the saved
 * fold state and the ordering for free.
 */
export type Widget = {
  /** Stable id: it keys the saved fold state, so never reuse one for something else. */
  id: string;
  title: string;
  /** Only the host sees it. */
  hostOnly?: boolean;
  /** Lower comes first; built-ins use 10, 20, 30. */
  order?: number;
  render: (ctx: WidgetContext) => ReactNode;
};

const registry = new Map<string, Widget>();

export function registerWidget(w: Widget) {
  registry.set(w.id, w);
}

export function listWidgets(isHost: boolean): Widget[] {
  return [...registry.values()].filter((w) => !w.hostOnly || isHost).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}
