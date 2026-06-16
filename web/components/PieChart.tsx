// Hand-rolled SVG donut chart (no chart-lib dependency), matching Ring.tsx style.
// Segments are drawn as overlapping stroked circles using the classic
// stroke-dasharray / dashoffset technique. Rotated -90° to start at 12 o'clock.

export type Slice = { label: string; value: number; color: string };

const fmt = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function PieChart({
  data, size = 150, stroke = 26, center,
}: {
  data: Slice[]; size?: number; stroke?: number; center?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  let acc = 0;
  const segs = data.map((d) => {
    const frac = d.value / total;
    const len = c * frac;
    const seg = { ...d, len, rest: c - len, offset: -acc, frac };
    acc += len;
    return seg;
  });

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} stroke="#163255" strokeWidth={stroke} fill="none" />
          {segs.map((s, i) => (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={s.color}
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={`${s.len} ${s.rest}`}
              strokeDashoffset={s.offset}
              style={{ filter: `drop-shadow(0 0 3px ${s.color}70)` }}
            />
          ))}
        </svg>
        {center && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-sm font-bold text-jarvis-text numeric">{center}</div>
          </div>
        )}
      </div>
      <ul className="text-[11px] space-y-1 min-w-0 flex-1">
        {segs.map((s, i) => (
          <li key={i} className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: s.color }} />
            {/* %, label, then $ — all packed left so the value sits right next to the description */}
            <span className="numeric text-jarvis-text shrink-0 w-9 text-right">{Math.round(s.frac * 100)}%</span>
            <span className="truncate text-jarvis-dim">{s.label}</span>
            <span className="text-jarvis-muted/70 numeric shrink-0">{fmt(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
