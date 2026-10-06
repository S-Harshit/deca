import { useEffect, useRef, useState } from "react";
import { ACCENTS, RADII, SCALES, THEMES, type Prefs } from "../theme";
import { clearWallpaper, saveWallpaper, accentFrom } from "../wallpaper";
import { Icon } from "./Icons";

type Props = Readonly<{ prefs: Prefs; update: (p: Partial<Prefs>) => void; reset: () => void }>;

/** A button that opens a popover to pick a theme and tweak accent, text size, density, corners. */
export function ThemePanel({ prefs, update, reset }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="theme-wrap" ref={box}>
      <button className="icon-btn" aria-label="Appearance" aria-expanded={open} title="Appearance" onClick={() => setOpen((o) => !o)}>
        <Icon name="sliders" />
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Appearance settings">
          <h4>Theme</h4>
          <div className="swatches">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`swatch ${prefs.theme === t.id ? "on" : ""}`}
                aria-label={`${t.label} theme`}
                aria-pressed={prefs.theme === t.id}
                onClick={() => update({ theme: t.id })}
              >
                <span className="swatch-art" style={{ background: t.colors[0] }}>
                  <span style={{ background: t.colors[1] }} />
                  <span style={{ background: t.colors[2] }} />
                </span>
                {t.label}
              </button>
            ))}
          </div>

          <h4>Accent colour</h4>
          <div className="row wrap">
            <button
              className={`dot default ${prefs.accent === null ? "on" : ""}`}
              aria-label="Theme default accent"
              title="Theme default"
              onClick={() => update({ accent: null, wallAccent: "off" })}
            >
              A
            </button>
            {ACCENTS.map((c) => (
              <button
                key={c}
                className={`dot ${prefs.accent === c ? "on" : ""}`}
                style={{ background: c }}
                aria-label={`Accent ${c}`}
                onClick={() => update({ accent: c, wallAccent: "off" })}
              />
            ))}
            <label className="dot custom" title="Custom colour">
              <input type="color" value={prefs.accent ?? "#7c83ff"} onChange={(e) => update({ accent: e.target.value, wallAccent: "off" })} />
            </label>
          </div>

          <Wallpaper prefs={prefs} update={update} />
          <h4>Text size</h4>
          <Segmented options={SCALES} value={prefs.scale} onChange={(scale) => update({ scale })} />
          <h4>Corners</h4>
          <Segmented options={RADII} value={prefs.radius} onChange={(radius) => update({ radius })} />
          <h4>Time format</h4>
          <Segmented
            options={[
              { label: "Auto", value: "auto" as const },
              { label: "12h", value: "12" as const },
              { label: "24h", value: "24" as const },
            ]}
            value={prefs.clock}
            onChange={(clock) => update({ clock })}
          />
          <h4>Home screen</h4>
          <Segmented
            options={[
              { label: "Simple", value: "simple" as const },
              { label: "Classic", value: "classic" as const },
            ]}
            value={prefs.home}
            onChange={(home) => update({ home })}
          />
          <label className="toggle" title="The host can sound an air horn to wake everyone up. Turn this off to keep it silent on this device (you will still see the alert).">
            <input type="checkbox" checked={prefs.hornSound} onChange={(e) => update({ hornSound: e.target.checked })} />
            Play the host's air horn
          </label>
          <label className="toggle" title="Loading a picture from a link shows its host your IP address">
            <input type="checkbox" checked={prefs.linkPreviews} onChange={(e) => update({ linkPreviews: e.target.checked })} />
            Preview image links
          </label>
          <label className="toggle" title="Show (2) in the browser tab title while messages arrive and you are in another tab">
            <input type="checkbox" checked={prefs.titleBadge} onChange={(e) => update({ titleBadge: e.target.checked })} />
            Unread count in the tab title
          </label>
          <label className="toggle">
            <input type="checkbox" checked={prefs.compact} onChange={(e) => update({ compact: e.target.checked })} />
            Compact spacing
          </label>
          <button className="ghost small-btn" onClick={() => { void clearWallpaper(); reset(); }}>
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: Readonly<{ options: { label: string; value: T }[]; value: T; onChange: (v: T) => void }>) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button key={o.label} className={o.value === value ? "on" : ""} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Wallpaper picker: the picture stays on this device, and the accent can follow its colours. */
function Wallpaper({ prefs, update }: Readonly<{ prefs: Prefs; update: (patch: Partial<Prefs>) => void }>) {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dark = !["light", "rose", "shadcn"].includes(prefs.theme);
  const palette = { hue: prefs.wallHue, sat: prefs.wallSat, colorful: prefs.wallColorful };
  const complement = accentFrom(palette, "complement", dark);
  const match = accentFrom(palette, "match", dark);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const p = await saveWallpaper(file);
      update({ wallpaper: true, wallRev: prefs.wallRev + 1, wallHue: p.hue, wallSat: p.sat, wallColorful: p.colorful, wallAccent: p.colorful ? "complement" : "off" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That picture could not be used.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h4>Wallpaper</h4>
      <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp" hidden aria-label="Choose a wallpaper" onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
      <div className="row wall-actions">
        <button className="ghost small-btn" onClick={() => picker.current?.click()} disabled={busy}>
          {busy ? "Working…" : prefs.wallpaper ? "Change picture…" : "Choose a picture…"}
        </button>
        {prefs.wallpaper && (
          <button className="ghost small-btn" onClick={() => { void clearWallpaper(); update({ wallpaper: false }); }}>
            Remove
          </button>
        )}
      </div>
      {error && <p className="error-text small" role="alert">{error}</p>}
      {prefs.wallpaper && (
        <>
          <label className="slider">
            <span>Dim</span>
            <input type="range" min={0} max={90} value={prefs.wallDim} aria-label="Wallpaper dimming" onChange={(e) => update({ wallDim: Number(e.target.value) })} />
          </label>
          <label className="slider">
            <span>Blur</span>
            <input type="range" min={0} max={16} value={prefs.wallBlur} aria-label="Wallpaper blur" onChange={(e) => update({ wallBlur: Number(e.target.value) })} />
          </label>
          <h4>Accent from the picture</h4>
          <Segmented
            options={[
              { label: "Opposite", value: "complement" as const },
              { label: "Same", value: "match" as const },
              { label: "Off", value: "off" as const },
            ]}
            value={prefs.wallAccent}
            onChange={(wallAccent) => update({ wallAccent })}
          />
          {prefs.wallColorful ? (
            <p className="muted small">
              <span className="dot-sample" style={{ background: complement ?? undefined }} /> opposite {complement} · <span className="dot-sample" style={{ background: match ?? undefined }} /> same {match}
            </p>
          ) : (
            <p className="muted small">This picture has no strong colour, so the accent stays as it is.</p>
          )}
        </>
      )}
      <p className="muted small">Only you see it. It stays on this device and is never sent to anyone.</p>
    </>
  );
}
