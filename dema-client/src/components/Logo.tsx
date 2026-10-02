/** Ten dots in a ring: "deca" is ten. With `animated` the ring pulses around, like people arriving. */
export function Logo({ size = 32, animated = false }: Readonly<{ size?: number; animated?: boolean }>) {
  const dots = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    return { i, x: 20 + 14 * Math.cos(a), y: 20 + 14 * Math.sin(a) };
  });
  return (
    <svg className={`logo-mark ${animated ? "orbit" : ""}`} width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="Deca">
      {dots.map((d) => (
        <circle key={d.i} cx={d.x} cy={d.y} r={3.1} style={{ animationDelay: `${d.i * 0.16}s` }} />
      ))}
    </svg>
  );
}
