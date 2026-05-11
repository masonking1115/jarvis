"use client";
import { useEffect, useState } from "react";
import { api, Task, Goal, Event, FinanceSummary, ChatReply } from "@/lib/api";
import { Panel } from "@/components/Panel";
import { StatusPill, Status } from "@/components/StatusPill";
import { Ring } from "@/components/Ring";
import { Sparkline } from "@/components/Sparkline";

type Fitness = {
  placeholder: boolean;
  rings: { name: string; value: number; goal: number; unit: string; color: string }[];
  distance_mi: number;
  wellness_pct: number;
};
type Analytics = {
  placeholder: boolean;
  metrics: { name: string; value: number; unit: string; color: string; series: number[] }[];
  net_worth_series: number[];
};
type Projects = { placeholder: boolean; projects: { name: string; status: string; progress: number }[] };
type Agents = { placeholder: boolean; agents: { name: string; status: string; role: string }[] };

export default function Dashboard() {
  // real data
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [fin, setFin] = useState<FinanceSummary | null>(null);
  // placeholder data
  const [fitness, setFitness] = useState<Fitness | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [projects, setProjects] = useState<Projects | null>(null);
  const [agents, setAgents] = useState<Agents | null>(null);
  // chat
  const [chatLog, setChatLog] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  async function refresh() {
    const [t, g, e, f, fit, an, pr, ag] = await Promise.all([
      api.get<Task[]>("/api/tasks"),
      api.get<Goal[]>("/api/goals"),
      api.get<Event[]>("/api/schedule/today"),
      api.get<FinanceSummary>("/api/finance/summary"),
      api.get<Fitness>("/api/fitness/today"),
      api.get<Analytics>("/api/analytics/overview"),
      api.get<Projects>("/api/projects"),
      api.get<Agents>("/api/agents"),
    ]);
    setTasks(t); setGoals(g); setEvents(e); setFin(f);
    setFitness(fit); setAnalytics(an); setProjects(pr); setAgents(ag);
  }
  useEffect(() => { refresh().catch(console.error); }, []);

  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!chatInput.trim() || chatBusy) return;
    const next = [...chatLog, { role: "user" as const, content: chatInput }];
    setChatLog(next); setChatInput(""); setChatBusy(true);
    try {
      const r = await api.post<ChatReply>("/api/chat", { messages: next });
      setChatLog([...next, { role: "assistant", content: r.reply }]);
    } finally { setChatBusy(false); }
  }

  return (
    <div className="space-y-4">
      {/* Row 1 — Today / Goals / Fitness / Analytics */}
      <div className="grid grid-cols-12 gap-4">
        <Panel title="Today" className="col-span-12 xl:col-span-3">
          <TodayList events={events} tasks={tasks} />
        </Panel>

        <Panel title="Goals & Progress" href="/goals" className="col-span-12 md:col-span-6 xl:col-span-3">
          <GoalsList goals={goals} />
        </Panel>

        <Panel title="Fitness" href="/fitness" demo={fitness?.placeholder} className="col-span-12 md:col-span-6 xl:col-span-3">
          <FitnessBlock fitness={fitness} />
        </Panel>

        <Panel title="Analytics" demo={analytics?.placeholder} className="col-span-12 xl:col-span-3">
          <AnalyticsBlock analytics={analytics} />
        </Panel>
      </div>

      {/* Row 2 — Finance / Projects / Agents / Chat */}
      <div className="grid grid-cols-12 gap-4">
        <Panel title="Finance" href="/finance"
          right={<span>{new Date().toLocaleString("default", { month: "long", year: "numeric" })}</span>}
          className="col-span-12 md:col-span-6 xl:col-span-3">
          <FinanceBlock fin={fin} series={analytics?.net_worth_series ?? []} />
        </Panel>

        <Panel title="Projects" href="/projects" demo={projects?.placeholder} className="col-span-12 md:col-span-6 xl:col-span-3">
          <ProjectsBlock projects={projects} />
        </Panel>

        <Panel title="AI Agents" href="/agents" demo={agents?.placeholder} className="col-span-12 md:col-span-6 xl:col-span-3">
          <AgentsBlock agents={agents} />
        </Panel>

        <Panel title="JARVIS Chat" href="/chat" className="col-span-12 md:col-span-6 xl:col-span-3">
          <div className="flex flex-col h-[280px]">
            <div className="flex-1 overflow-y-auto pr-1 space-y-2 text-sm">
              {chatLog.length === 0 && (
                <div className="text-jarvis-muted text-xs italic">
                  Good {timeOfDay()}. Standing by.
                </div>
              )}
              {chatLog.map((m, i) => (
                <div key={i} className={m.role === "user" ? "text-right" : ""}>
                  <span className={`inline-block px-2.5 py-1.5 rounded-xl max-w-[90%] whitespace-pre-wrap text-[13px]
                    ${m.role === "user" ? "bg-jarvis-accent text-jarvis-bg" : "bg-white/5 border border-jarvis-border"}`}>
                    {m.content}
                  </span>
                </div>
              ))}
            </div>
            <form onSubmit={sendChat} className="flex gap-2 mt-2">
              <input className="input text-sm" placeholder="Ask Jarvis…"
                value={chatInput} onChange={e=>setChatInput(e.target.value)} />
              <button className="btn text-sm" disabled={chatBusy}>{chatBusy ? "…" : "Send"}</button>
            </form>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ---------------- subcomponents ---------------- */

function TodayList({ events, tasks }: { events: Event[]; tasks: Task[] }) {
  // Merge today's schedule items + top tasks into a single timeline-ish list
  const items = [
    ...events.map(e => ({
      key: `e${e.id}`,
      time: new Date(e.starts_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      title: e.title,
      sub: e.location ?? "",
      color: "#22d3ee",
    })),
    ...tasks.slice(0, 5).map(t => ({
      key: `t${t.id}`,
      time: t.due_at ? new Date(t.due_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : `P${t.priority}`,
      title: t.title,
      sub: t.notes ?? "",
      color: "#34d399",
    })),
  ];
  if (items.length === 0) return <Empty text="No events or tasks for today." />;
  return (
    <ul className="space-y-2">
      {items.slice(0, 6).map(i => (
        <li key={i.key} className="flex items-start gap-3 text-sm">
          <span className="font-mono text-xs text-jarvis-muted w-12 shrink-0 mt-0.5 tabular-nums">{i.time}</span>
          <span className="dot mt-1.5" style={{ background: i.color, boxShadow: `0 0 6px ${i.color}` }} />
          <div className="flex-1 min-w-0">
            <div className="truncate">{i.title}</div>
            {i.sub && <div className="text-xs text-jarvis-muted truncate">{i.sub}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function GoalsList({ goals }: { goals: Goal[] }) {
  if (goals.length === 0) return <Empty text="No goals yet. Add one from the Goals page." />;
  return (
    <ul className="space-y-3">
      {goals.slice(0, 5).map(g => (
        <li key={g.id}>
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="dot dot-info" />
              <span className="text-jarvis-text truncate max-w-[150px]">{g.title}</span>
            </div>
            <span className="text-jarvis-muted tabular-nums">{Math.round(g.progress * 100)}%</span>
          </div>
          <div className="h-1.5 mt-1.5 bg-jarvis-bg rounded-full overflow-hidden border border-jarvis-border">
            <div className="h-full bg-jarvis-accent" style={{
              width: `${Math.round(g.progress * 100)}%`,
              boxShadow: "0 0 8px rgba(34,211,238,0.6)",
            }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function FitnessBlock({ fitness }: { fitness: Fitness | null }) {
  if (!fitness) return <Empty text="Loading…" />;
  return (
    <div className="space-y-3">
      <div className="flex justify-around">
        {fitness.rings.map(r => (
          <Ring key={r.name}
            value={r.value} max={r.goal} color={r.color} size={72} stroke={6}
            label={`${Math.round(r.value)}`}
            sub={r.name}
          />
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-jarvis-border pt-3 text-sm">
        <div>
          <div className="label">Distance</div>
          <div className="font-mono text-xl text-jarvis-accent">{fitness.distance_mi.toFixed(2)}<span className="text-xs text-jarvis-muted ml-1">mi</span></div>
        </div>
        <div className="text-right">
          <div className="label">Wellness</div>
          <div className="font-mono text-xl text-jarvis-good">{fitness.wellness_pct}<span className="text-xs text-jarvis-muted ml-1">%</span></div>
        </div>
      </div>
    </div>
  );
}

function AnalyticsBlock({ analytics }: { analytics: Analytics | null }) {
  if (!analytics) return <Empty text="Loading…" />;
  return (
    <div className="grid grid-cols-3 gap-2">
      {analytics.metrics.map(m => (
        <div key={m.name} className="rounded-lg border border-jarvis-border bg-jarvis-panel2/40 p-2">
          <div className="label truncate">{m.name}</div>
          <div className="font-mono text-lg" style={{ color: m.color }}>{m.value}</div>
          <Sparkline data={m.series} width={120} height={32} color={m.color} />
        </div>
      ))}
    </div>
  );
}

function FinanceBlock({ fin, series }: { fin: FinanceSummary | null; series: number[] }) {
  const net = fin?.net ?? 0;
  // Demo net-worth headline if user hasn't logged transactions yet
  const showDemo = !fin || fin.count === 0;
  const headline = showDemo ? series[series.length - 1] ?? 247850 : net;
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <div className="label">{showDemo ? "Net Worth (demo)" : "Net (real)"}</div>
          <div className="font-mono text-2xl text-jarvis-accent">${headline.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <Sparkline data={series.length ? series : [1,2,3,4,5,6,7]} width={140} height={48} color="#22d3ee" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center border-t border-jarvis-border pt-3">
        <Stat label="Income"   value={fin ? `$${fin.income.toFixed(0)}` : "$0"} />
        <Stat label="Expenses" value={fin ? `$${Math.abs(fin.expenses).toFixed(0)}` : "$0"} />
        <Stat label="Saved"    value={fin ? `$${Math.max(0, fin.net).toFixed(0)}` : "$0"} />
      </div>
    </div>
  );
}

function ProjectsBlock({ projects }: { projects: Projects | null }) {
  if (!projects) return <Empty text="Loading…" />;
  return (
    <ul className="space-y-2">
      {projects.projects.map(p => (
        <li key={p.name} className="flex items-center gap-3 text-sm">
          <span className="flex-1 truncate">{p.name}</span>
          <span className="w-20 h-1 bg-jarvis-bg rounded-full overflow-hidden border border-jarvis-border">
            <span className="block h-full bg-jarvis-accent" style={{ width: `${p.progress*100}%` }} />
          </span>
          <StatusPill status={p.status === "active" ? "active" : p.status === "paused" ? "warn" : "ready"} />
        </li>
      ))}
    </ul>
  );
}

function AgentsBlock({ agents }: { agents: Agents | null }) {
  if (!agents) return <Empty text="Loading…" />;
  return (
    <ul className="space-y-2">
      {agents.agents.map(a => (
        <li key={a.name} className="flex items-center justify-between text-sm">
          <div className="flex flex-col min-w-0">
            <span className="truncate">{a.name}</span>
            <span className="text-[11px] text-jarvis-muted truncate">{a.role}</span>
          </div>
          <StatusPill status={a.status as Status} />
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-xs text-jarvis-muted italic">{text}</div>;
}

function timeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}
