"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Panel } from "@/components/Panel";
import { StatusPill, Status } from "@/components/StatusPill";

export default function AgentsPage() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.get("/api/agents").then(setData).catch(console.error); }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">AI Agents</h1>
      <Panel title="Roster" demo={data?.placeholder}>
        {!data ? <div className="text-jarvis-muted text-sm">Loading…</div> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.agents.map((a: any) => (
              <div key={a.name} className="rounded-xl border border-jarvis-border bg-jarvis-panel2/40 p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold">{a.name}</div>
                  <div className="text-xs text-jarvis-muted">{a.role}</div>
                </div>
                <StatusPill status={a.status as Status} />
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Roadmap">
        <p className="text-sm text-jarvis-muted">
          Each agent will become an autonomous process backed by an LLM, with its own
          tools, memory, and schedule. The roster here is the multi-agent system from
          Phase 5 of the project plan.
        </p>
      </Panel>
    </div>
  );
}
