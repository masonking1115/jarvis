import Link from "next/link";
import { ReactNode } from "react";

export function Panel({
  title, right, href, hrefLabel, children, className = "", demo = false,
}: {
  title: string;
  right?: ReactNode;
  href?: string;
  hrefLabel?: string;
  children: ReactNode;
  className?: string;
  demo?: boolean;
}) {
  return (
    <div className={`panel ${className}`}>
      <div className="flex items-center justify-between mb-3 relative">
        <div className="flex items-center gap-2">
          <h2 className="panel-title">{title}</h2>
          {demo && (
            <span className="font-ui text-[9px] tracking-[0.22em] uppercase text-jarvis-amber border border-jarvis-amber/50 rounded px-1.5 py-[1px] leading-none">
              demo
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-jarvis-muted">{right}</div>
      </div>
      {children}
      {href && (
        <div className="mt-3 pt-3 border-t border-jarvis-border/70 flex justify-end">
          <Link href={href} className="cta-link">
            {hrefLabel ?? `View all ${title.toLowerCase()}`} →
          </Link>
        </div>
      )}
    </div>
  );
}
