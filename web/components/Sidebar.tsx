"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/",          label: "Dashboard" },
  { href: "/schedule",  label: "Schedule" },
  { href: "/goals",     label: "Goals" },
  { href: "/finance",   label: "Finance" },
  { href: "/fitness",   label: "Fitness" },
  { href: "/projects",  label: "Projects" },
  { href: "/trading",   label: "Trading Desk" },
  { href: "/agents",    label: "Agents" },
  { href: "/notes",     label: "Notes" },
  { href: "/settings",  label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-56 shrink-0 border-r border-jarvis-border bg-jarvis-panel/60 backdrop-blur min-h-screen flex flex-col">
      <div className="px-5 py-5 border-b border-jarvis-border">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-jarvis-accent/20 border border-jarvis-accent flex items-center justify-center text-jarvis-accent font-bold">J</div>
          <div>
            <div className="font-bold tracking-wide">JARVIS</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-jarvis-muted">Console</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-4">
        {NAV.map(n => {
          const active = n.href === "/" ? pathname === "/" : pathname?.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href}
              className={`flex items-center gap-3 px-5 py-2 text-sm border-l-2 ${
                active
                  ? "border-jarvis-accent bg-jarvis-accent/10 text-jarvis-text"
                  : "border-transparent text-jarvis-muted hover:text-jarvis-text hover:bg-white/5"
              }`}>
              <span className={`dot ${active ? "dot-info" : "bg-jarvis-dim"}`} />
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-jarvis-border text-[11px] text-jarvis-muted">
        <div className="flex items-center justify-between">
          <span>JARVIS v0.1</span>
          <span className="inline-flex items-center gap-1.5"><span className="dot dot-good" />Online</span>
        </div>
      </div>
    </aside>
  );
}
