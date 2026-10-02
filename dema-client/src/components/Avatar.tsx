import { hue } from "./colors";

export function Avatar({ name, id, size = 32 }: Readonly<{ name: string; id: string; size?: number }>) {
  const h = hue(id);
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${h} 50% 40%)` }}
    >
      {(name[0] ?? "?").toUpperCase()}
    </span>
  );
}
