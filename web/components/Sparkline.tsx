export function Sparkline({
  data, width = 160, height = 48, color = "#22d3ee", fill = true,
}: { data: number[]; width?: number; height?: number; color?: string; fill?: boolean }) {
  if (data.length === 0) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pad = 4;
  const step = (width - pad * 2) / (data.length - 1 || 1);
  const points = data.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (height - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });
  const path = points.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(" ");
  const area = `${path} L${points[points.length-1][0]},${height} L${points[0][0]},${height} Z`;
  const gid = `sg-${color.replace("#","")}`;

  return (
    <svg width={width} height={height} className="block">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gid})`} />}
      <path d={path} fill="none" stroke={color} strokeWidth={1.75}
        style={{ filter: `drop-shadow(0 0 4px ${color}80)` }} />
    </svg>
  );
}
