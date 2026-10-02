import { createContext, useContext, type ReactNode } from "react";
import { Icon } from "./components/Icons";
import { usePrefsApi } from "./theme";

type SlotApi = { title: string; collapsed: boolean; toggle: () => void };
const SlotContext = createContext<SlotApi | null>(null);

/** A sidebar panel the user can fold to just its title. The panel puts a <SlotToggle /> in its own heading. */
export function Slot({ id, title, children }: Readonly<{ id: string; title: string; children: ReactNode }>) {
  const api = usePrefsApi();
  const collapsed = api?.prefs.collapsed.includes(id) ?? false;
  const toggle = () => api?.update({ collapsed: collapsed ? api.prefs.collapsed.filter((c) => c !== id) : [...api.prefs.collapsed, id] });
  return (
    <SlotContext.Provider value={{ title, collapsed, toggle }}>
      <div className={`slot ${collapsed ? "collapsed" : ""}`}>{children}</div>
    </SlotContext.Provider>
  );
}

/** The fold arrow. Renders nothing outside a Slot, or when `hidden` (e.g. a popped-out player has nothing to fold into). */
export function SlotToggle({ hidden }: Readonly<{ hidden?: boolean }>) {
  const slot = useContext(SlotContext);
  if (!slot || hidden) return null;
  const label = `${slot.collapsed ? "Expand" : "Collapse"} ${slot.title}`;
  return (
    <button className="slot-toggle" aria-expanded={!slot.collapsed} aria-label={label} title={label} onClick={slot.toggle}>
      <Icon name="chevron" size={12} />
    </button>
  );
}
