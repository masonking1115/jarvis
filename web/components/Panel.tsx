import Link from "next/link";
import { ReactNode } from "react";

export function Panel({
  title, right, href, children, className = "", demo = false,
}: {
  title: string;
  right?: ReactNode;
  href?: string;
  children: ReactNode;
  className?: string;
  demo?: boolean;
}) {
  return (
    <div className={`panel ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="panel-title">{title}</h2>
          {demo && <span className="text-[9px] tracking-widest uppercase text-jarvis-warn/80 border border-jarvis-warn/40 rounded px-1.5 py-0.5">demo</span>}
        </div>
        <div className="flex items-center gap-2 text-xs text-jarvis-muted">
          {right}
          {href && <Link href={href} className="text-jarvis-accent hover:underline">open →</Link>}
        </div>
      </div>
      {children}
    </div>
  );
}
