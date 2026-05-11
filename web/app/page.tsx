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
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [fin, setFin] = useState<FinanceSummary | null>(null);
  const [fitness, setFitness] = useState<Fitness | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [projects, setProjects] = useState<Projects | null>(null);
  const [agents, setAgents] = useState<Agents | null>(null);
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
      {/* Row 1 */}
      <div className="grid grid-cols-12 gap-4">
        <Panel title="Today" href="/schedule" hrefLabel="View full schedule"
               className="col-span-12 xl:col-span-3">
          <TodayList events={events} tasks={tasks} />
        </Panel>

        <Panel title="Goals & Progress" href="/goals" hrefLabel="View all goals"
               className="col-span-12 md:col-span-6 xl:col-span-3">
          <GoalsList goals={goals} />
        </Panel>

        <Panel title="Fitness" href="/fitness" hrefLabel="View fitness"
               demo={fitness?.placeholder}
               right={<span className="font-ui tracking-widest text-jarvis-amber">STRAVA</span>}
               className="col-span-12 md:col-span-6 xl:col-span-3">
          <FitnessBlock fitness={fitness} />
        </Panel>

        <Panel title="Analytics" className="col-span-12 xl:col-span-3"
               demo={analytics?.placeholder}>
          <AnalyticsBlock analytics={analytics} />
        </Panel>
      </div>

      {/* Row 2 */}
      <div className="grid grid-cols-12 gap-4">
        <Panel title="Finance" href="/finance" hrefLabel="View finance dashboard"
               right={<span className="font-ui tracking-widest">
                 {new Date().toLocaleString("default", { month: "long", year: "numeric" }).toUpperCase()}
               </span>}
               className="col-span-12 md:col-span-6 xl:col-span-3">
          <FinanceBlock fin={fin} series={analytics?.net_worth_series ?? []} />
        </Panel>

        <Panel title="Projects" href="/projects" hrefLabel="View all projects"
               demo={projects?.placeholder}
               className="col-span-12 md:col-span-6 xl:col-span-3">
          <ProjectsBlock projects={projects} />
        </Panel>

        <Panel title="AI Agents" href="/agents" hrefLabel="Manage agents"
               demo={agents?.placeholder}
               className="col-span-12 md:col-span-6 xl:col-span-3">
          <AgentsBlock agents={agents} />
        </Panel>

        <Panel title="JARVIS Chat" className="col-span-12 md:col-span-6 xl:col-span-3">
          <ChatBlock
            log={chatLog} input={chatInput} setInput={setChatInput}
            busy={chatBusy} onSend={sendChat}
          />
        </Panel>
      </div>
    </div>
  );
}

/* ---------------- subcomponents ---------------- */

function TodayList({ events, tasks }: { events: Event[]; tasks: Task[] }) {
  const items = [
    ...events.map(e => ({
      key: `e${e.id}`,
      time: new Date(e.starts_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
      title: e.title, sub: e.location ?? "", color: "#4ad6ff",
    })),
    ...tasks.slice(0, 6).map(t => ({
      key: `t${t.id}`,
      time: t.due_at ? new Date(t.due_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : `P${t.priority}`,
      title: t.title, sub: t.notes ?? "", color: t.priority <= 2 ? "#ff9c2a" : "#22e8a0",
    })),
  ];
  if (items.length === 0) return <Empty text="No events or tasks for today." />;
  return (
    <ul className="space-y-2.5">
      {items.slice(0, 6).map(i => (
        <li key={i.key} className="flex items-start gap-3 text-sm">
          <span className="numeric text-[11px] text-jarvis-muted w-10 shrink-0 mt-0.5 tabular-nums">{i.time}</span>
          <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: i.color, boxShadow: `0 0 6px ${i.color}` }} />
          <div className="flex-1 min-w-0">
            <div className="truncate text-jarvis-text text-[13px]">{i.title}</div>
            {i.sub && <div className="text-[11px] text-jarvis-muted truncate">{i.sub}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function GoalsList({ goals }: { goals: Goal[] }) {
  if (goals.length === 0) return <Empty text="No goals yet." />;
  return (
    <ul className="space-y-3">
      {goals.slice(0, 5).map(g => (
        <li key={g.id}>
          <div className="flex items-center justify-between text-[12px]">
            <div className="flex items-center gap-2 min-w-0">
              <span className="dot dot-info shrink-0" />
              <span className="text-jarvis-text font-ui tracking-wide truncate">{g.title}</span>
            </div>
            <span className="numeric text-jarvis-muted text-[11px]">{Math.round(g.progress * 100)}%</span>
          </div>
          <div className="h-1.5 mt-1.5 bg-jarvis-bg2 rounded-full overflow-hidden border border-jarvis-border">
            <div className="h-full"
              style={{
                width: `${Math.round(g.progress * 100)}%`,
                background: "linear-gradient(90deg, #4ad6ff, #5be1ff)",
                boxShadow: "0 0 10px rgba(74,214,255,0.7)",
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
    <div className="space-y-4">
      <div className="flex justify-around items-center">
        {fitness.rings.map(r => (
          <Ring key={r.name}
            value={r.value} max={r.goal} color={r.color} size={70} stroke={6}
            label={`${Math.round(r.value)}`} sub={r.name.toUpperCase()}
          />
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-jarvis-border pt-3">
        <div>
          <div className="label">Distance</div>
          <div className="numeric text-2xl text-jarvis-accent drop-shadow-[0_0_8px_rgba(74,214,255,0.4)]">
            {fitness.distance_mi.toFixed(2)}
            <span className="text-[11px] text-jarvis-muted ml-1 font-ui tracking-widest">MI</span>
          </div>
        </div>
        <div className="text-right">
          <div className="label">Wellness</div>
          <div className="numeric text-2xl text-jarvis-good drop-shadow-[0_0_8px_rgba(34,232,160,0.4)]">
            {fitness.wellness_pct}<span className="text-[11px] text-jarvis-muted ml-1 font-ui tracking-widest">%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalyticsBlock({ analytics }: { analytics: Analytics | null }) {
  if (!analytics) return <Empty text="Loading…" />;
  return (
    <div className="space-y-2">
      {analytics.metrics.map(m => (
        <div key={m.name} className="rounded-lg border border-jarvis-border bg-jarvis-panel2/40 px-3 py-2 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="label truncate">{m.name}</div>
            <div className="numeric text-lg leading-tight" style={{ color: m.color, textShadow: `0 0 10px ${m.color}66` }}>
              {m.value}<span className="text-[10px] text-jarvis-muted ml-1 font-ui tracking-widest">{m.unit.toUpperCase()}</span>
            </div>
          </div>
          <Sparkline data={m.series} width={120} height={36} color={m.color} />
        </div>
      ))}
    </div>
  );
}

function FinanceBlock({ fin, series }: { fin: FinanceSummary | null; series: number[] }) {
  const showDemo = !fin || fin.count === 0;
  const headline = showDemo ? (series[series.length - 1] ?? 247850) : fin!.net;
  return (
    <div className="space-y-3">
      <div>
        <div className="label">{showDemo ? "Net Worth (demo)" : "Net"}</div>
        <div className="numeric text-3xl text-jarvis-accent drop-shadow-[0_0_10px_rgba(74,214,255,0.4)] leading-none mt-1">
          ${headline.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
      </div>
      <div className="-mx-1">
        <Sparkline data={series.length ? series : [1,2,3,4,5,6,7]} width={300} height={56} color="#4ad6ff" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center border-t border-jarvis-border pt-3">
        <Stat label="Income"   value={fin ? `$${fin.income.toFixed(0)}` : "$0"} good />
        <Stat label="Expenses" value={fin ? `$${Math.abs(fin.expenses).toFixed(0)}` : "$0"} />
        <Stat label="Saved"    value={fin ? `$${Math.max(0, fin.net).toFixed(0)}` : "$0"} accent />
      </div>
    </div>
  );
}

function ProjectsBlock({ projects }: { projects: Projects | null }) {
  if (!projects) return <Empty text="Loading…" />;
  return (
    <ul className="space-y-2.5">
      {projects.projects.map(p => (
        <li key={p.name} className="flex items-center gap-3 text-[13px]">
          <span className="flex-1 truncate font-ui tracking-wide">{p.name}</span>
          <span className="w-20 h-1 bg-jarvis-bg2 rounded-full overflow-hidden border border-jarvis-border">
            <span className="block h-full" style={{
              width: `${p.progress*100}%`,
              background: "linear-gradient(90deg, #4ad6ff, #5be1ff)",
              boxShadow: "0 0 6px rgba(74,214,255,0.5)",
            }} />
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
    <ul className="grid grid-cols-1 gap-2">
      {agents.agents.map(a => (
        <li key={a.name}
            className="flex items-center justify-between rounded-md bg-jarvis-panel2/40 border border-jarvis-border px-3 py-2">
          <div className="flex flex-col min-w-0">
            <span className="truncate text-[13px] font-ui tracking-wide">{a.name}</span>
            <span className="text-[11px] text-jarvis-muted truncate">{a.role}</span>
          </div>
          <StatusPill status={a.status as Status} />
        </li>
      ))}
    </ul>
  );
}

function ChatBlock({
  log, input, setInput, busy, onSend,
}: {
  log: { role: "user" | "assistant"; content: string }[];
  input: string; setInput: (v: string) => void;
  busy: boolean; onSend: (e: React.FormEvent) => void;
}) {
  return (
    <div className="flex flex-col h-[280px]">
      <div className="flex-1 overflow-y-auto pr-1 space-y-2 text-[13px]">
        {log.length === 0 && (
          <>
            <div className="text-jarvis-text italic font-ui">Good {timeOfDay()}.</div>
            <div className="text-jarvis-muted text-[11px] mt-2 font-ui tracking-wide">
              Plan ahead an optimal day for engineering and recovery,<br />
              or ask about goals, finance, or schedule.
            </div>
          </>
        )}
        {log.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <span className={`inline-block px-2.5 py-1.5 rounded-xl max-w-[90%] whitespace-pre-wrap text-[12.5px]
              ${m.role === "user"
                ? "bg-jarvis-accent text-jarvis-bg shadow-glowSm"
                : "bg-white/[0.04] border border-jarvis-border"}`}>
              {m.content}
            </span>
          </div>
        ))}
      </div>
      <form onSubmit={onSend} className="flex gap-2 mt-2">
        <input className="input text-[13px]" placeholder="Ask Jarvis…"
          value={input} onChange={e => setInput(e.target.value)} />
        <button className="btn text-[12px]" disabled={busy}>{busy ? "…" : "SEND"}</button>
      </form>
    </div>
  );
}

function Stat({ label, value, accent, good }: { label: string; value: string; accent?: boolean; good?: boolean }) {
  const color = accent ? "text-jarvis-accent" : good ? "text-jarvis-good" : "text-jarvis-text";
  return (
    <div>
      <div className="label">{label}</div>
      <div className={`numeric text-sm ${color}`}>{value}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-[12px] text-jarvis-muted italic">{text}</div>;
}

function timeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}
