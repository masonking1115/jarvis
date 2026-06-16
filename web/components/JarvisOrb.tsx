"use client";
/**
 * The JARVIS hero orb — spinning rings, breathing core, and the "JARVIS"
 * wordmark in the middle. Extracted from the intro scene so it can be reused
 * (e.g. in the Flyover view). Pure visual unless `onOrbClick` is supplied.
 */
const ACCENT = "#4ad6ff";
const ACCENT_BRIGHT = "#a4eaff";
const ACCENT_DIM = "#1f6ea0";

const NUM_TICKS = 36;
const LOOP_SECONDS = 9;

export function JarvisOrb({
  className,
  style,
  onOrbClick,
}: {
  className?: string;
  style?: React.CSSProperties;
  onOrbClick?: () => void;
}) {
  const ticks = Array.from({ length: NUM_TICKS }).map((_, i) => {
    const angle = (i / NUM_TICKS) * 360;
    const big = i % 9 === 0;
    return (
      <line
        key={i}
        x1="0" y1={-152} x2="0" y2={big ? -140 : -146}
        stroke={ACCENT}
        strokeWidth={big ? 1.6 : 0.9}
        strokeLinecap="round"
        opacity={big ? 0.95 : 0.55}
        transform={`rotate(${angle})`}
        style={{ animation: `intro-tick ${LOOP_SECONDS}s ease-in-out ${(i / NUM_TICKS) * LOOP_SECONDS}s infinite` }}
      />
    );
  });

  const orbitDots = Array.from({ length: 12 }).map((_, i) => {
    const angle = (i / 12) * 360;
    return <circle key={i} cx="0" cy={-172} r="1.4" fill={ACCENT} opacity={0.7} transform={`rotate(${angle})`} />;
  });

  return (
    <svg viewBox="-200 -200 400 400" className={className} style={style} aria-hidden>
      <defs>
        <radialGradient id="orbCoreGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor={ACCENT_BRIGHT} stopOpacity="0.95" />
          <stop offset="45%" stopColor={ACCENT} stopOpacity="0.7" />
          <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="orbArcGrad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%"  stopColor={ACCENT} stopOpacity="0" />
          <stop offset="100%" stopColor={ACCENT_BRIGHT} stopOpacity="1" />
        </linearGradient>
        <filter id="orbBloom" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="orbBloomBig" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <circle r="180" stroke={ACCENT_DIM} strokeWidth="0.6" fill="none" opacity="0.35" />

      <g className="spin-cw-slow">{orbitDots}</g>

      <circle r="152" stroke={ACCENT} strokeWidth="0.8" fill="none" opacity="0.55" />
      <g>{ticks}</g>
      <circle r="140" stroke={ACCENT} strokeWidth="1.2" fill="none" opacity="0.8" filter="url(#orbBloom)" />

      <g className="spin-ccw-med" style={{ transformOrigin: "0 0" }}>
        <circle r="128" fill="none" stroke="url(#orbArcGrad)" strokeWidth="2.5"
                strokeLinecap="round" strokeDasharray="120 380" filter="url(#orbBloom)" />
      </g>
      <g className="spin-cw-med" style={{ transformOrigin: "0 0" }}>
        <circle r="116" fill="none" stroke={ACCENT_BRIGHT} strokeWidth="1.5"
                strokeLinecap="round" strokeDasharray="40 60 20 600" opacity="0.9" filter="url(#orbBloom)" />
      </g>
      <g className="spin-ccw-fast" style={{ transformOrigin: "0 0" }}>
        <circle r="100" fill="none" stroke={ACCENT} strokeWidth="0.8"
                strokeLinecap="round" strokeDasharray="6 14" opacity="0.7" />
      </g>

      <g className="ring-breathe">
        <circle r="80" fill="none" stroke={ACCENT_BRIGHT} strokeWidth="2.2" filter="url(#orbBloomBig)" />
        <circle r="80" fill="none" stroke={ACCENT} strokeWidth="0.8" />
        <circle r="72" fill="url(#orbCoreGlow)" />
      </g>

      <text
        x="0" y="0" textAnchor="middle" dominantBaseline="central" className="intro-wordmark"
        style={{ fontFamily: "var(--font-display), Orbitron, sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: "0.34em", fill: "white" }}
      >
        JARVIS
      </text>

      <g opacity="0.65">
        {Array.from({ length: 4 }).map((_, i) => (
          <line key={i} x1="0" y1="-92" x2="0" y2="-86" stroke={ACCENT_BRIGHT} strokeWidth="1.2" transform={`rotate(${i * 90 + 45})`} />
        ))}
      </g>

      <g className="spin-cw-veryslow">
        {Array.from({ length: 3 }).map((_, i) => (
          <circle key={i} cx="0" cy="-152" r="2.4" fill={ACCENT_BRIGHT} filter="url(#orbBloom)" transform={`rotate(${i * 120 + 30})`} />
        ))}
      </g>

      {onOrbClick && (
        <circle r="90" cx="0" cy="0" fill="transparent" style={{ cursor: "pointer", pointerEvents: "all" }} onClick={onOrbClick}>
          <title>Enter Console</title>
        </circle>
      )}
    </svg>
  );
}
