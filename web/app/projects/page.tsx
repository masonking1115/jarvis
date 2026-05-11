"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Panel } from "@/components/Panel";
import { StatusPill, Status } from "@/components/StatusPill";

export default function ProjectsPage() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.get("/api/projects").then(setData).catch(console.error); }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Projects</h1>
      <Panel title="Active Projects" demo={data?.placeholder}>
        {!data ? <div className="text-jarvis-muted text-sm">Loading…</div> : (
          <ul className="divide-y divide-jarvis-border">
            {data.projects.map((p: any) => (
              <li key={p.name} className="py-3 flex items-center gap-4">
                <span className="flex-1">{p.name}</span>
                <span className="w-40 h-1.5 bg-jarvis-bg rounded-full overflow-hidden border border-jarvis-border">
                  <span className="block h-full bg-jarvis-accent" style={{ width: `${p.progress*100}%` }} />
                </span>
                <span className="text-xs text-jarvis-muted w-10 text-right">{Math.round(p.progress*100)}%</span>
                <StatusPill status={p.status === "active" ? "active" : "warn"} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Roadmap">
        <p className="text-sm text-jarvis-muted">
          DB-backed projects, milestones, task dependencies, technical-document storage,
          and the Research Agent integration land here. Currently sourcing placeholder data
          from <code className="text-jarvis-accent">/api/projects</code>.
        </p>
      </Panel>
    </div>
  );
}
