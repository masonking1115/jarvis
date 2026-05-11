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
    <header className="border-b border-jarvis-border bg-jarvis-panel/40 backdrop-blur">
      <div className="px-8 py-4 flex items-center justify-between">
        <div>
          <div className="text-lg font-bold tracking-wider">
            JARVIS <span className="text-jarvis-accent">CONSOLE</span>
          </div>
          <div className="text-[11px] text-jarvis-muted tracking-[0.18em] uppercase">
            Central Life Optimization System
          </div>
        </div>

        <div className="flex items-center gap-8">
          <div className="text-right">
            <div className="font-mono text-2xl text-jarvis-text leading-none tabular-nums">
              {now ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--"}
            </div>
            <div className="text-[11px] text-jarvis-muted mt-1">
              {now ? now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : ""}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1">
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-jarvis-good">
              <span className="dot dot-good" /> OPTIMAL
            </span>
            <div className="text-[11px] text-jarvis-muted italic">"Focus is the multiplier."</div>
          </div>
        </div>
      </div>
    </header>
  );
}
