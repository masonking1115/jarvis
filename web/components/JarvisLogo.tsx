export function JarvisLogo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id="jl-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#bdf1ff" stopOpacity="1" />
          <stop offset="55%" stopColor="#4ad6ff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0a2a4a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="jl-ring" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%"  stopColor="#4ad6ff" />
          <stop offset="100%" stopColor="#00b8e6" />
        </linearGradient>
      </defs>

      {/* outer hex ring */}
      <polygon
        points="32,4 56,18 56,46 32,60 8,46 8,18"
        fill="none" stroke="url(#jl-ring)" strokeWidth="2"
        style={{ filter: "drop-shadow(0 0 6px rgba(74,214,255,0.7))" }}
      />

      {/* inner ring */}
      <circle cx="32" cy="32" r="14" fill="none" stroke="#4ad6ff" strokeWidth="1.5" opacity="0.7" />

      {/* core glow */}
      <circle cx="32" cy="32" r="10" fill="url(#jl-core)" />

      {/* radial spokes */}
      {[0, 60, 120, 180, 240, 300].map((d) => {
        const r1 = 17, r2 = 22;
        const rad = (d * Math.PI) / 180;
        const x1 = 32 + Math.cos(rad) * r1, y1 = 32 + Math.sin(rad) * r1;
        const x2 = 32 + Math.cos(rad) * r2, y2 = 32 + Math.sin(rad) * r2;
        return <line key={d} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#4ad6ff" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" />;
      })}
    </svg>
  );
}
