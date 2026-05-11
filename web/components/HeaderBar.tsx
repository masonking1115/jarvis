"use client";
import { useEffect, useState } from "react";

export function HeaderBar() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="border-b border-jarvis-border bg-[#040813]/60 backdrop-blur">
      <div className="px-7 py-4 flex items-center justify-between">
        {/* Left: brand wordmark + status */}
        <div className="flex items-center gap-5">
          <div>
            <div className="font-display font-bold text-[22px] tracking-[0.22em] text-jarvis-text leading-none drop-shadow-[0_0_10px_rgba(74,214,255,0.35)]">
              JARVIS <span className="text-jarvis-accent">CONSOLE</span>
            </div>
            <div className="font-ui text-[11px] tracking-[0.32em] text-jarvis-muted mt-1.5">
              CENTRAL LIFE OPTIMIZATION SYSTEM
            </div>
          </div>
          <span className="pill text-jarvis-good">
            <span className="dot dot-good" /> OPTIMAL
          </span>
        </div>

        {/* Right: clock + date + tagline */}
        <div className="flex items-center gap-7">
          <div className="text-right">
            <div className="numeric font-bold text-[34px] leading-none tracking-tight text-jarvis-text drop-shadow-[0_0_12px_rgba(74,214,255,0.4)]">
              {now ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--"}
            </div>
            <div className="font-ui text-[11px] tracking-[0.22em] text-jarvis-muted mt-1.5 uppercase">
              {now ? now.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" }) : "—"}
            </div>
          </div>
          <div className="hidden md:block w-px h-10 bg-jarvis-border" />
          <div className="hidden md:flex flex-col items-end">
            <span className="font-ui text-[10px] tracking-[0.28em] text-jarvis-muted">DIRECTIVE</span>
            <span className="font-ui italic text-[13px] text-jarvis-text">"Focus is the multiplier."</span>
          </div>
        </div>
      </div>
    </header>
  );
}
