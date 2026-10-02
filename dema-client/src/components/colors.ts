export const hue = (id: string) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};

/** Stable per-person colour for names, readable on both dark and light themes. */
export const nameColor = (id: string) => `hsl(${hue(id)} 65% var(--name-l, 68%))`;

