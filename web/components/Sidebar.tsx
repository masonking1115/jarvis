"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { JarvisLogo } from "./JarvisLogo";
import { useFlyover } from "./flyover/FlyoverProvider";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/schedule",  label: "Schedule" },
  { href: "/goals",     label: "Goals" },
  { href: "/finance",   label: "Finance" },
  { href: "/spending",  label: "Spending" },
  { href: "/email",     label: "Email" },
  { href: "/fitness",   label: "Fitness" },
  { href: "/projects",  label: "Projects" },
  { href: "/trading",   label: "Trading Desk" },
  { href: "/agents",    label: "Agents" },
  { href: "/notes",     label: "Notes" },
  { href: "/settings",  label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { toggle } = useFlyover();
  return (
    <aside className="w-56 shrink-0 border-r border-jarvis-border bg-[#040813]/70 backdrop-blur min-h-screen flex flex-col">
      {/* Top: brand mark → back to landing */}
      <Link href="/" className="px-5 pt-5 pb-3 flex items-center gap-3 group" title="Return to landing">
        <JarvisLogo size={40} />
        <div>
          <div className="font-display font-bold text-[15px] tracking-[0.18em] text-jarvis-text leading-none group-hover:drop-shadow-[0_0_8px_rgba(74,214,255,0.6)] transition">JARVIS</div>
          <div className="font-ui text-[10px] tracking-[0.28em] text-jarvis-muted mt-1 group-hover:text-jarvis-accent transition">CONSOLE</div>
        </div>
      </Link>

      <div className="mx-5 my-2 h-px bg-gradient-to-r from-transparent via-jarvis-border to-transparent" />

      <nav className="flex-1 py-2">
        {NAV.map(n => {
          const active = n.href === "/" ? pathname === "/" : pathname?.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href}
              className={`relative flex items-center gap-3 pl-5 pr-4 py-2 text-[20px] font-ui tracking-wider ${
                active
                  ? "text-jarvis-text"
                  : "text-jarvis-dim hover:text-jarvis-text"
              }`}>
              {active && (
                <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-jarvis-accent shadow-[0_0_8px_rgba(74,214,255,0.9)]" />
              )}
              <span className={`dot ${active ? "dot-info" : "bg-jarvis-mute2"}`} style={{ width: 9, height: 9 }} />
              <span className={active ? "drop-shadow-[0_0_8px_rgba(74,214,255,0.5)]" : ""}>{n.label}</span>
            </Link>
          );
        })}
        {/* Flyover is an overlay, not a route — toggled (also bound to Esc). */}
        <button onClick={toggle}
          className="w-full relative flex items-center gap-3 pl-5 pr-4 py-2 text-[20px] font-ui tracking-wider text-jarvis-dim hover:text-jarvis-text text-left">
          <span className="dot bg-jarvis-mute2" style={{ width: 9, height: 9 }} />
          <span>Flyover</span>
        </button>
      </nav>

      {/* Footer: JARVIS Online emblem → back to landing */}
      <div className="px-5 pb-5 pt-3 border-t border-jarvis-border">
        <Link href="/" className="flex items-center gap-3 group" title="Return to landing">
          <JarvisLogo size={60} />
          <div>
            <div className="font-display text-jarvis-accent text-[13px] tracking-[0.22em] leading-none drop-shadow-[0_0_8px_rgba(74,214,255,0.6)] group-hover:drop-shadow-[0_0_14px_rgba(74,214,255,0.9)] transition">JARVIS</div>
            <div className="font-ui text-[10px] tracking-[0.28em] text-jarvis-muted mt-1 group-hover:text-jarvis-accent transition">ONLINE</div>
          </div>
        </Link>
      </div>
    </aside>
  );
}
