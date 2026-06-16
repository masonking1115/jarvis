"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { JarvisOrb } from "./JarvisOrb";

/**
 * Loopable JARVIS intro hero.
 *
 * Click rules:
 *   - The central orb (rings + JARVIS wordmark area) → /dashboard
 *   - Each labeled satellite node (FITNESS, FINANCE, …) → that module's page
 *   - Clicks anywhere else do nothing
 */
const NUM_PARTICLES = 60;

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

  // From the intro only: Esc or Space jumps straight into the map (flyover) view.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === " " || e.code === "Space") {
        e.preventDefault();
        router.push("/dashboard?flyover=1");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#04080f] grid-bg">
      {/* particles (decorative) */}
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />

      {/* network overlay — its labeled nodes ARE the clickable links */}
      <NetworkOverlay />

      {/* radial vignette glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 50%, rgba(74,214,255,0.08), transparent 70%), radial-gradient(40% 40% at 50% 50%, rgba(74,214,255,0.05), transparent 70%)",
        }}
      />

      {/* core SVG. The SVG itself ignores clicks; only the orb hit-circle catches them. */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <JarvisOrb
          className="intro-core w-[min(82vmin,640px)] h-[min(82vmin,640px)]"
          onOrbClick={() => router.push("/dashboard")}
        />
      </div>

      {/* Top status text */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 text-center intro-fade-in pointer-events-none">
        <div className="font-display text-[12px] md:text-[14px] tracking-[0.42em] text-jarvis-muted">
          INITIALIZING
        </div>
      </div>

      {/* Bottom subtitle (informational, non-clickable) */}
      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 text-center intro-fade-in pointer-events-none">
        <div className="font-ui text-[10px] md:text-[12px] tracking-[0.42em] text-jarvis-muted">
          CENTRAL LIFE OPTIMIZATION SYSTEM
        </div>
        <div className="mt-3 font-ui text-[10px] tracking-[0.3em] text-jarvis-mute2">
          Click the orb to enter — or any module label
        </div>
      </div>
    </div>
  );
}

/* -------------------- network overlay -------------------- */

type NetNode = { x: number; y: number; label: string; href: string };

function NetworkOverlay() {
  const nodes: NetNode[] = [
    { x: 14, y: 24, label: "FITNESS",  href: "/fitness"  },
    { x: 86, y: 20, label: "FINANCE",  href: "/finance"  },
    { x: 10, y: 60, label: "PROJECTS", href: "/projects" },
    { x: 90, y: 64, label: "AGENTS",   href: "/agents"   },
    { x: 22, y: 88, label: "GOALS",    href: "/goals"    },
    { x: 78, y: 90, label: "SCHEDULE", href: "/schedule" },
  ];
  const edges: [number, number, number][] = [
    [0, 1, -10], [0, 2, -6], [1, 3, 8],
    [2, 4, -4],  [3, 5, 6],  [4, 5, -12],
    [0, 3, 10],  [1, 2, -8],
  ];

  return (
    <div className="absolute inset-0 network-layer">
      {/* connecting curves (decorative, non-interactive) */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
        aria-hidden
      >
        {edges.map(([a, b, curve], i) => {
          const A = nodes[a], B = nodes[b];
          const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
          const dx = B.x - A.x, dy = B.y - A.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const cx = mx + (-dy / len) * curve;
          const cy = my + ( dx / len) * curve;
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
      </svg>

      {/* clickable nodes */}
      {nodes.map((n) => (
        <Link
          key={n.label}
          href={n.href}
          aria-label={`Open ${n.label.toLowerCase()}`}
          style={{ left: `${n.x}%`, top: `${n.y}%` }}
          className="absolute -translate-x-1/2 -translate-y-1/2 group flex items-center gap-2 cursor-pointer"
        >
          <span className="relative flex">
            <span className="absolute inline-flex h-3 w-3 rounded-full bg-jarvis-accent opacity-60 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-jarvis-accent shadow-[0_0_10px_rgba(74,214,255,0.95)]" />
          </span>
          <span className="font-ui text-[14px] md:text-[16px] tracking-[0.28em] uppercase text-jarvis-accent group-hover:text-white group-hover:drop-shadow-[0_0_8px_rgba(164,234,255,0.9)] transition">
            {n.label}
          </span>
        </Link>
      ))}
    </div>
  );
}
