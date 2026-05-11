export type Status = "online" | "ready" | "active" | "warn" | "offline";

const MAP: Record<Status, { dot: string; label: string; cls: string }> = {
  online:  { dot: "dot-good", label: "ONLINE",  cls: "text-jarvis-good" },
  ready:   { dot: "dot-info", label: "READY",   cls: "text-jarvis-accent" },
  active:  { dot: "dot-info", label: "ACTIVE",  cls: "text-jarvis-accent" },
  warn:    { dot: "dot-warn", label: "WARN",    cls: "text-jarvis-warn" },
  offline: { dot: "dot-bad",  label: "OFFLINE", cls: "text-jarvis-bad" },
};

export function StatusPill({ status, label }: { status: Status; label?: string }) {
  const m = MAP[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] tracking-[0.18em] font-semibold ${m.cls}`}>
      <span className={`dot ${m.dot}`} />
      {label ?? m.label}
    </span>
  );
}
