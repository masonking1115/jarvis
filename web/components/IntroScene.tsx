"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Loopable JARVIS intro hero.
 *
 * Layers (back → front):
 *   1. Page background (deep navy gradient — inherited from globals.css)
 *   2. Canvas particle field (lightweight, ~60 particles drifting)
 *   3. Network overlay (nodes + curved edges, fades in/out on a 9s loop)
 *   4. SVG core (concentric rings, segmented rotating arcs, tick marks, glowing core, JARVIS wordmark)
 *   5. Bottom CTA → /dashboard
 *
 * Visual constants — kept here so the whole composition is tunable from one place.
 */
const ACCENT = "#4ad6ff";
const ACCENT_BRIGHT = "#a4eaff";
const ACCENT_DIM = "#1f6ea0";

const NUM_TICKS = 36;          // outer tick marks
const NUM_PARTICLES = 60;
const LOOP_SECONDS = 9;        // master loop length

export function IntroScene() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Particle layer — small twinkling sparks drifting across the viewport.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0;
    function resize() {
      w = window.innerWidth; h = window.innerHeight;
      canvas!.width = w * dpr; canvas!.height = h * dpr;
      canvas!.style.width = `${w}px`; canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    const particles = Array.from({ length: NUM_PARTICLES }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      r: Math.random() * 1.3 + 0.35,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.015 + Math.random() * 0.025,
    }));

    let raf = 0;
    function tick() {
      ctx!.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy; p.twinkle += p.twinkleSpeed;
        if (p.x < -5) p.x = w + 5;
        else if (p.x > w + 5) p.x = -5;
        if (p.y < -5) p.y = h + 5;
        else if (p.y > h + 5) p.y = -5;
        const alpha = 0.18 + 0.45 * (Math.sin(p.twinkle) * 0.5 + 0.5);
        ctx!.fillStyle = `rgba(116, 211, 255, ${alpha})`;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  // Tick marks positioned around the outer ring.
  const ticks = Array.from({ length: NUM_TICKS }).map((_, i) => {
    const angle = (i / NUM_TICKS) * 360;
    // Bigger tick every 9 marks (4 cardinal anchors)
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
        style={{
          // staggered wave of twinkling, synced to the master cycle
          animation: `intro-tick ${LOOP_SECONDS}s ease-in-out ${(i / NUM_TICKS) * LOOP_SECONDS}s infinite`,
        }}
      />
    );
  });

  // Orbital dots — small specks that ride farther out.
  const orbitDots = Array.from({ length: 12 }).map((_, i) => {
    const angle = (i / 12) * 360;
    return (
      <circle
        key={i}
        cx="0" cy={-172} r="1.4"
        fill={ACCENT}
        opacity={0.7}
        transform={`rotate(${angle})`}
      />
    );
  });

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-[#04080f] grid-bg cursor-pointer"
      onClick={() => router.push("/dashboard")}
      role="button"
      aria-label="Enter JARVIS Console"
    >
      {/* particles */}
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />

      {/* network overlay (fades in mid-cycle) */}
      <NetworkOverlay />

      {/* radial vignette glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 50%, rgba(74,214,255,0.08), transparent 70%), radial-gradient(40% 40% at 50% 50%, rgba(74,214,255,0.05), transparent 70%)",
        }}
      />

      {/* core SVG */}
      <div className="absolute inset-0 flex items-center justify-center">
        <svg
          viewBox="-200 -200 400 400"
          className="intro-core w-[min(82vmin,640px)] h-[min(82vmin,640px)]"
          aria-hidden
        >
          <defs>
            <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%"  stopColor={ACCENT_BRIGHT} stopOpacity="0.95" />
              <stop offset="45%" stopColor={ACCENT} stopOpacity="0.7" />
              <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
            </radialGradient>
            <linearGradient id="arcGrad" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%"  stopColor={ACCENT} stopOpacity="0" />
              <stop offset="100%" stopColor={ACCENT_BRIGHT} stopOpacity="1" />
            </linearGradient>
            <filter id="bloom" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="bloomBig" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="5" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* far faint ring */}
          <circle r="180" stroke={ACCENT_DIM} strokeWidth="0.6" fill="none" opacity="0.35" />

          {/* orbital dots (slow CW) */}
          <g className="spin-cw-slow">{orbitDots}</g>

          {/* outer ring with tick marks */}
          <circle r="152" stroke={ACCENT} strokeWidth="0.8" fill="none" opacity="0.55" />
          <g className="intro-ticks">{ticks}</g>
          <circle r="140" stroke={ACCENT} strokeWidth="1.2" fill="none" opacity="0.8" filter="url(#bloom)" />

          {/* segmented rotating arcs */}
          <g className="spin-ccw-med" style={{ transformOrigin: "0 0" }}>
            <circle
              r="128" fill="none" stroke="url(#arcGrad)" strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray="120 380"
              filter="url(#bloom)"
            />
          </g>
          <g className="spin-cw-med" style={{ transformOrigin: "0 0" }}>
            <circle
              r="116" fill="none" stroke={ACCENT_BRIGHT} strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray="40 60 20 600"
              opacity="0.9"
              filter="url(#bloom)"
            />
          </g>
          <g className="spin-ccw-fast" style={{ transformOrigin: "0 0" }}>
            <circle
              r="100" fill="none" stroke={ACCENT} strokeWidth="0.8"
              strokeLinecap="round"
              strokeDasharray="6 14"
              opacity="0.7"
            />
          </g>

          {/* inner main ring + glow disk */}
          <g className="ring-breathe">
            <circle r="80" fill="none" stroke={ACCENT_BRIGHT} strokeWidth="2.2" filter="url(#bloomBig)" />
            <circle r="80" fill="none" stroke={ACCENT} strokeWidth="0.8" />
            <circle r="72" fill="url(#coreGlow)" />
          </g>

          {/* JARVIS wordmark */}
          <text
            x="0" y="0"
            textAnchor="middle"
            dominantBaseline="central"
            className="intro-wordmark"
            style={{
              fontFamily: "var(--font-display), Orbitron, sans-serif",
              fontWeight: 700,
              fontSize: 22,
              letterSpacing: "0.34em",
              fill: "white",
            }}
          >
            JARVIS
          </text>

          {/* small inner hashmarks */}
          <g opacity="0.65">
            {Array.from({ length: 4 }).map((_, i) => (
              <line key={i} x1="0" y1="-92" x2="0" y2="-86"
                    stroke={ACCENT_BRIGHT} strokeWidth="1.2"
                    transform={`rotate(${i * 90 + 45})`} />
            ))}
          </g>

          {/* tiny status pips along the outer rim */}
          <g className="spin-cw-veryslow">
            {Array.from({ length: 3 }).map((_, i) => (
              <circle key={i} cx="0" cy="-152" r="2.4"
                      fill={ACCENT_BRIGHT}
                      filter="url(#bloom)"
                      transform={`rotate(${i * 120 + 30})`} />
            ))}
          </g>
        </svg>
      </div>

      {/* Header text (animates in once, stays) */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 text-center intro-fade-in">
        <div className="font-display text-[12px] md:text-[14px] tracking-[0.42em] text-jarvis-muted">
          INITIALIZING
        </div>
      </div>

      {/* CTA */}
      <div className="absolute bottom-14 left-1/2 -translate-x-1/2 text-center intro-fade-in pointer-events-auto">
        <div className="font-ui text-[10px] md:text-[12px] tracking-[0.42em] text-jarvis-muted mb-3">
          CENTRAL LIFE OPTIMIZATION SYSTEM
        </div>
        <Link
          href="/dashboard"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-3 px-5 py-2.5 rounded-md border border-jarvis-accent/60 text-jarvis-accent font-ui font-semibold tracking-[0.3em] text-[12px] hover:bg-jarvis-accent/10 hover:shadow-[0_0_18px_rgba(74,214,255,0.4)] transition"
        >
          ENTER CONSOLE
          <span className="inline-block translate-y-[-1px]">→</span>
        </Link>
        <div className="mt-3 font-ui text-[10px] tracking-[0.3em] text-jarvis-mute2">
          (click anywhere)
        </div>
      </div>
    </div>
  );
}

/* -------------------- network overlay -------------------- */

function NetworkOverlay() {
  // Pre-placed nodes around the scene (percentage coordinates).
  const nodes = [
    { x: 14, y: 24, label: "FITNESS" },
    { x: 86, y: 20, label: "FINANCE" },
    { x: 10, y: 60, label: "PROJECTS" },
    { x: 90, y: 64, label: "AGENTS" },
    { x: 22, y: 88, label: "GOALS" },
    { x: 78, y: 90, label: "SCHEDULE" },
  ];
  const edges: [number, number, number][] = [
    // [from, to, curvature]
    [0, 1, -10], [0, 2, -6], [1, 3, 8],
    [2, 4, -4], [3, 5, 6], [4, 5, -12],
    [0, 3, 10], [1, 2, -8],
  ];

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none network-layer"
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
    >
      {edges.map(([a, b, curve], i) => {
        const A = nodes[a], B = nodes[b];
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        // perpendicular offset for the control point so the curve bows
        const dx = B.x - A.x, dy = B.y - A.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const cx = mx + (-dy / len) * curve;
        const cy = my + (dx / len) * curve;
        return (
          <path
            key={i}
            d={`M ${A.x} ${A.y} Q ${cx} ${cy} ${B.x} ${B.y}`}
            fill="none"
            stroke="#4ad6ff"
            strokeWidth="0.12"
            opacity="0.55"
          />
        );
      })}
      {nodes.map((n, i) => (
        <g key={i}>
          <circle cx={n.x} cy={n.y} r="0.9" fill="#a4eaff" />
          <circle cx={n.x} cy={n.y} r="0.45" fill="white" />
          <text
            x={n.x + 1.8} y={n.y + 0.6}
            fill="#4ad6ff"
            fontSize="1.5"
            fontFamily="var(--font-ui), Rajdhani, sans-serif"
            opacity="0.85"
            style={{ letterSpacing: "0.06em" }}
          >
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
