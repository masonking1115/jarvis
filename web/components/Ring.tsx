export function Ring({
  value, max = 100, size = 96, stroke = 8, color = "#22d3ee", label, sub,
}: {
  value: number; max?: number; size?: number; stroke?: number; color?: string;
  label?: string; sub?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const dash = c * pct;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size/2} cy={size/2} r={r} stroke="#163255" strokeWidth={stroke} fill="none" />
          <circle
            cx={size/2} cy={size/2} r={r}
            stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
            strokeDasharray={`${dash} ${c}`}
            style={{ filter: `drop-shadow(0 0 6px ${color}80)`, transition: "stroke-dasharray 600ms ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-lg font-bold text-jarvis-text">{label ?? `${Math.round(pct * 100)}%`}</div>
          {sub && <div className="text-[10px] text-jarvis-muted tracking-wider">{sub}</div>}
        </div>
      </div>
    </div>
  );
}
