"use client";
import { useEffect, useState } from "react";
import { api, Event } from "@/lib/api";
import { Panel } from "@/components/Panel";
import { CategoryIcon, CATEGORIES, categoryMeta } from "@/components/CategoryIcon";
import { WeekTodos } from "@/components/WeekTodos";

function todayDateISO() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function combineDateTime(dateISO: string, timeHHMM: string): string {
  // Local datetime → ISO. Browser sends Z timestamps; backend stores naive UTC.
  const [h, m] = timeHHMM.split(":").map(Number);
  const d = new Date(dateISO);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

export default function SchedulePage() {
  const [day, setDay] = useState(todayDateISO());
  const [events, setEvents] = useState<Event[]>([]);
  const [title, setTitle] = useState("");
  const [timeHHMM, setTimeHHMM] = useState("07:00");
  const [duration, setDuration] = useState<number>(60);
  const [category, setCategory] = useState("workout");
  const [notes, setNotes] = useState("");

  async function refresh() {
    setEvents(await api.get<Event[]>(`/api/schedule?day=${day}`));
  }
  useEffect(() => { refresh().catch(console.error); }, [day]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await api.post<Event>("/api/schedule", {
      title,
      starts_at: combineDateTime(day, timeHHMM),
      duration_min: duration || null,
      category,
      notes: notes || null,
    });
    setTitle(""); setNotes("");
    refresh();
  }

  async function toggle(ev: Event) {
    await api.patch(`/api/schedule/${ev.id}`, { completed: !ev.completed });
    refresh();
  }

  async function remove(ev: Event) {
    await api.del(`/api/schedule/${ev.id}`);
    refresh();
  }

  async function patch(ev: Event, body: Partial<Event>) {
    await api.patch(`/api/schedule/${ev.id}`, body);
    refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Day Planner</h1>
          <p className="text-sm text-jarvis-muted">Plan a day, then watch it on the dashboard TODAY card.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="label">Day</span>
          <input type="date" className="input w-44 !py-1.5"
                 value={day} onChange={e => setDay(e.target.value)} />
          <button className="btn-ghost text-sm" onClick={() => setDay(todayDateISO())}>Today</button>
        </div>
      </div>

      <Panel title="This Week">
        <WeekTodos />
      </Panel>

      <Panel title="Add to Day">
        <form onSubmit={add} className="grid grid-cols-12 gap-2">
          <input className="input col-span-12 md:col-span-4" placeholder="Title (e.g. Morning Workout)"
                 value={title} onChange={e=>setTitle(e.target.value)} />
          <input className="input col-span-6 md:col-span-2" type="time"
                 value={timeHHMM} onChange={e=>setTimeHHMM(e.target.value)} />
          <input className="input col-span-6 md:col-span-2" type="number" min={0} placeholder="minutes"
                 value={duration} onChange={e=>setDuration(Number(e.target.value))} />
          <select className="input col-span-6 md:col-span-2" value={category} onChange={e=>setCategory(e.target.value)}>
            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <button className="btn col-span-6 md:col-span-2">ADD</button>
          <input className="input col-span-12" placeholder="Notes (optional)"
                 value={notes} onChange={e=>setNotes(e.target.value)} />
        </form>
      </Panel>

      <Panel title={`Plan · ${new Date(day).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}`}>
        {events.length === 0 && (
          <div className="text-sm text-jarvis-muted italic">Nothing scheduled. Add your first block above.</div>
        )}
        <ul className="divide-y divide-jarvis-border/70">
          {events.map(ev => {
            const meta = categoryMeta(ev.category);
            return (
              <li key={ev.id} className="py-3 flex items-center gap-3">
                <span className="numeric text-jarvis-muted w-14 text-sm">
                  {new Date(ev.starts_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
                </span>
                <CategoryIcon category={ev.category} size={36} />
                <div className="flex-1 min-w-0">
                  <input
                    className="input !py-1 !px-2 !bg-transparent !border-transparent hover:!border-jarvis-border focus:!bg-jarvis-bg2 text-jarvis-text font-ui tracking-wide"
                    defaultValue={ev.title}
                    onBlur={e => { if (e.target.value !== ev.title) patch(ev, { title: e.target.value }); }}
                  />
                  <div className="text-[11px] text-jarvis-muted px-2">
                    <span style={{ color: meta.color }}>{meta.label}</span>
                    {ev.duration_min ? ` · ${ev.duration_min} min` : ""}
                    {ev.notes ? ` · ${ev.notes}` : ""}
                  </div>
                </div>
                <select className="input w-32 !py-1 text-xs" value={ev.category}
                        onChange={e => patch(ev, { category: e.target.value })}>
                  {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <button onClick={() => toggle(ev)}
                        className={`w-7 h-7 rounded-full border flex items-center justify-center transition-colors ${
                          ev.completed
                            ? "bg-jarvis-good/20 border-jarvis-good text-jarvis-good"
                            : "border-jarvis-border text-jarvis-muted hover:text-jarvis-text hover:border-jarvis-accent"
                        }`}
                        title={ev.completed ? "Mark incomplete" : "Mark complete"}>
                  {ev.completed ? "✓" : ""}
                </button>
                <button onClick={() => remove(ev)}
                        className="text-xs text-jarvis-muted hover:text-jarvis-bad font-ui tracking-wider">
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="Categories">
        <div className="flex flex-wrap gap-3">
          {CATEGORIES.map(c => (
            <div key={c.id} className="flex items-center gap-2 text-sm">
              <CategoryIcon category={c.id} size={28} />
              <span className="font-ui tracking-wide text-jarvis-text">{c.label}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
