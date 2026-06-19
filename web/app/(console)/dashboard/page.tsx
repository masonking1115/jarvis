"use client";
import { useEffect, useState } from "react";
import { api, Goal, Event, ChatReply, Project, FinanceOverview } from "@/lib/api";
import { Panel } from "@/components/Panel";
import { StatusPill, Status } from "@/components/StatusPill";
import { Ring } from "@/components/Ring";
import { Sparkline } from "@/components/Sparkline";
import { CategoryIcon } from "@/components/CategoryIcon";
import { WeekTodos } from "@/components/WeekTodos";

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
type Agents = { placeholder: boolean; agents: { name: string; status: string; role: string }[] };

export default function Dashboard() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [fin, setFin] = useState<FinanceOverview | null>(null);
  const [fitness, setFitness] = useState<Fitness | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agents | null>(null);
  const [chatLog, setChatLog] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  async function refresh() {
    const [g, e, f, fit, an, pr, ag] = await Promise.all([
      api.get<Goal[]>("/api/goals"),
      api.get<Event[]>("/api/schedule/today"),
      api.get<FinanceOverview>("/api/finance/overview"),
      api.get<Fitness>("/api/fitness/today"),
      api.get<Analytics>("/api/analytics/overview"),
      api.get<Project[]>("/api/projects"),
      api.get<Agents>("/api/agents"),
    ]);
    setGoals(g); setEvents(e); setFin(f);
    setFitness(fit); setAnalytics(an); setProjects(pr); setAgents(ag);
  }
  useEffect(() => { refresh().catch(console.error); }, []);

  async function toggleEvent(ev: Event) {
    await api.patch(`/api/schedule/${ev.id}`, { completed: !ev.completed });
    refresh();
  }

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
          <TodayList events={events} onToggle={toggleEvent} />
        </Panel>

        <Panel title="This Week" href="/schedule" hrefLabel="All to-dos"
               className="col-span-12 md:col-span-6 xl:col-span-3">
          <WeekTodos compact />
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

function TodayList({ events, onToggle }: { events: Event[]; onToggle: (e: Event) => void }) {
  if (events.length === 0) {
    return (
      <div className="text-[12px] text-jarvis-muted italic">
        Nothing planned. Open <span className="text-jarvis-accent">Schedule</span> to plan your day.
      </div>
    );
  }
  return (
    <ul className="space-y-2.5">
      {events.slice(0, 6).map(e => {
        const time = new Date(e.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        return (
          <li key={e.id} className="flex items-center gap-3">
            <span className="numeric text-[11px] text-jarvis-muted w-12 shrink-0 tabular-nums">{time}</span>
            <CategoryIcon category={e.category} size={32} />
            <div className="flex-1 min-w-0">
              <div className={`truncate text-[13px] font-ui tracking-wide ${e.completed ? "line-through text-jarvis-muted" : "text-jarvis-text"}`}>
                {e.title}
              </div>
              <div className="text-[10px] text-jarvis-muted tracking-wider">
                {e.duration_min ? `${e.duration_min} MIN` : ""}
                {e.duration_min && e.notes ? " · " : ""}
                {e.notes ?? ""}
              </div>
            </div>
            <button
              onClick={() => onToggle(e)}
              className={`w-5 h-5 rounded-full border flex items-center justify-center text-[11px] transition-colors ${
                e.completed
                  ? "bg-jarvis-good/20 border-jarvis-good text-jarvis-good"
                  : "border-jarvis-border text-jarvis-muted hover:border-jarvis-accent"
              }`}
              title={e.completed ? "Mark incomplete" : "Mark complete"}>
              {e.completed ? "✓" : ""}
            </button>
          </li>
        );
      })}
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

function FinanceBlock({ fin, series }: { fin: FinanceOverview | null; series: number[] }) {
  const hasRealData = !!fin && (fin.assets_total > 0 || fin.liabilities_total > 0);
  const headline = hasRealData ? fin!.net_worth : (series[series.length - 1] ?? 247850);
  const positive = headline >= 0;
  return (
    <div className="space-y-3">
      <div>
        <div className="label">{hasRealData ? "Net Worth" : "Net Worth (demo)"}</div>
        <div className={`numeric text-3xl ${positive ? "text-jarvis-accent" : "text-jarvis-bad"} drop-shadow-[0_0_10px_rgba(74,214,255,0.4)] leading-none mt-1`}>
          ${headline.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
        {fin && (
          <div className="text-[10px] text-jarvis-muted mt-1 tracking-wider uppercase">
            ${fin.assets_total.toFixed(0)} assets · ${fin.liabilities_total.toFixed(0)} debts
          </div>
        )}
      </div>
      <div className="-mx-1">
        <Sparkline data={series.length ? series : [1,2,3,4,5,6,7]} width={300} height={56} color="#4ad6ff" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center border-t border-jarvis-border pt-3">
        <Stat label="Income/mo" value={fin ? `$${fin.income.monthly_net.toFixed(0)}` : "$0"} good />
        <Stat label="Spend/mo"  value={fin ? `$${fin.monthly_expenses.toFixed(0)}` : "$0"} />
        <Stat label="Savings"   value={fin ? `$${Math.max(0, fin.monthly_savings_est).toFixed(0)}` : "$0"} accent />
      </div>
      {fin?.income.next_pay_date && (
        <div className="text-[11px] text-jarvis-muted">
          Next paycheck: <span className="text-jarvis-accent">${fin.income.next_pay_amount?.toFixed(0)}</span>
          {" "}in {fin.income.days_to_next_pay}d
        </div>
      )}
    </div>
  );
}

function ProjectsBlock({ projects }: { projects: Project[] }) {
  if (projects.length === 0) return <Empty text="No projects." />;
  return (
    <ul className="space-y-2.5">
      {projects.map(p => {
        const inner = (
          <>
            <span className="flex-1 truncate font-ui tracking-wide flex items-center gap-1.5">
              {p.name}
              {p.notion_url && <NotionIcon />}
            </span>
            <span className="w-20 h-1 bg-jarvis-bg2 rounded-full overflow-hidden border border-jarvis-border">
              <span className="block h-full" style={{
                width: `${p.progress*100}%`,
                background: "linear-gradient(90deg, #4ad6ff, #5be1ff)",
                boxShadow: "0 0 6px rgba(74,214,255,0.5)",
              }} />
            </span>
            <StatusPill status={p.status === "active" ? "active" : p.status === "paused" ? "warn" : "ready"} />
          </>
        );
        return (
          <li key={p.id} className="text-[13px]">
            {p.notion_url ? (
              <a href={p.notion_url} target="_blank" rel="noreferrer"
                 className="flex items-center gap-3 hover:bg-white/[0.03] rounded-md -mx-1 px-1 py-0.5 transition-colors">
                {inner}
              </a>
            ) : (
              <div className="flex items-center gap-3" title="No Notion page linked yet">
                {inner}
              </div>
            )}
          </li>
        );
      })}
      {projects.find(p => !p.notion_url) && (
        <li className="text-[10px] text-jarvis-muted font-ui tracking-wider pt-1">
          Tip: open /projects to link a Notion page.
        </li>
      )}
    </ul>
  );
}

function NotionIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
         className="text-jarvis-accent shrink-0" aria-label="Notion">
      <path d="M5 4h11l4 3v13H5V4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M16 4v3h4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
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
