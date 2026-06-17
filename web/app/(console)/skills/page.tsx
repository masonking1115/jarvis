"use client";
import { useEffect, useState } from "react";
import { skills as skillsApi, Skill } from "@/lib/api";

export default function SkillsPage() {
  const [items, setItems] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { setItems((await skillsApi.list()).skills); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function toggle(s: Skill) {
    setItems(prev => prev.map(x => x.name === s.name ? { ...x, enabled: !x.enabled } : x));
    try { await skillsApi.toggle(s.name, !s.enabled); }
    catch { load(); }   // revert on failure
  }

  const groups: { kind: string; label: string }[] = [
    { kind: "instruction", label: "Instruction skills" },
    { kind: "action", label: "Action skills" },
  ];

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl tracking-wider text-jarvis-text mb-1">Skills</h1>
      <p className="text-jarvis-muted text-sm mb-5">
        What JARVIS can do. Instruction skills are markdown files in <code>backend/skills/</code>;
        action skills are built-in tools. Toggle any on or off.
      </p>

      {loading ? (
        <p className="text-jarvis-muted">Loading…</p>
      ) : (
        groups.map(g => {
          const list = items.filter(s => s.kind === g.kind);
          if (!list.length) return null;
          return (
            <div key={g.kind} className="mb-6">
              <h2 className="font-ui text-xs tracking-[0.22em] uppercase text-jarvis-accent mb-2">{g.label}</h2>
              <ul className="space-y-2">
                {list.map(s => (
                  <li key={s.name}
                    className="flex items-start gap-3 border border-jarvis-border rounded px-3 py-2 bg-[#040813]/50">
                    <div className="flex-1">
                      <div className="text-jarvis-text text-sm font-medium">{s.name}</div>
                      <div className="text-jarvis-muted text-xs mt-0.5">{s.when_to_use}</div>
                      {s.actions.length > 0 && (
                        <div className="text-[10px] text-jarvis-dim mt-1">tools: {s.actions.join(", ")}</div>
                      )}
                    </div>
                    <button onClick={() => toggle(s)}
                      className={`shrink-0 text-xs px-2 py-1 rounded border ${
                        s.enabled
                          ? "border-jarvis-accent text-jarvis-accent"
                          : "border-jarvis-border text-jarvis-muted"
                      }`}>
                      {s.enabled ? "On" : "Off"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}
