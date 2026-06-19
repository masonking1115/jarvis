"use client";
import { useEffect, useState } from "react";
import { api, Task } from "@/lib/api";

function endOfWeek(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  d.setDate(d.getDate() + 7);
  return d.getTime();
}

// This week = open tasks that are undated, overdue, or due within the next 7 days.
function thisWeek(tasks: Task[]): Task[] {
  const end = endOfWeek();
  return tasks
    .filter(t => !t.done)
    .filter(t => !t.due_at || new Date(t.due_at).getTime() <= end)
    .sort((a, b) => {
      const ad = a.due_at ? new Date(a.due_at).getTime() : Infinity;
      const bd = b.due_at ? new Date(b.due_at).getTime() : Infinity;
      return ad - bd || a.priority - b.priority;
    });
}

export function WeekTodos({ compact = false }: { compact?: boolean }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");

  async function refresh() { setTasks(await api.get<Task[]>("/api/tasks")); }
  useEffect(() => { refresh().catch(console.error); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await api.post<Task>("/api/tasks", { title });
    setTitle("");
    refresh();
  }
  async function toggle(t: Task) { await api.patch(`/api/tasks/${t.id}`, { done: !t.done }); refresh(); }
  async function remove(t: Task) { await api.del(`/api/tasks/${t.id}`); refresh(); }

  const week = thisWeek(tasks);
  const list = compact ? week.slice(0, 6) : week;

  return (
    <div className="space-y-2">
      {!compact && (
        <form onSubmit={add} className="flex gap-2">
          <input className="input flex-1" placeholder="Add a to-do… (or ask Jarvis)"
                 value={title} onChange={e => setTitle(e.target.value)} />
          <button className="btn">Add</button>
        </form>
      )}
      {list.length === 0 && (
        <div className="text-[12px] text-jarvis-muted italic">Nothing due this week.</div>
      )}
      <ul className={compact ? "space-y-2" : "divide-y divide-jarvis-border/70"}>
        {list.map(t => {
          const due = t.due_at ? new Date(t.due_at) : null;
          const overdue = due ? due.getTime() < Date.now() : false;
          return (
            <li key={t.id} className={`flex items-center gap-3 ${compact ? "" : "py-2"}`}>
              <button onClick={() => toggle(t)}
                className={`w-5 h-5 rounded-full border flex items-center justify-center text-[11px] shrink-0 transition-colors ${
                  t.done
                    ? "bg-jarvis-good/20 border-jarvis-good text-jarvis-good"
                    : "border-jarvis-border text-jarvis-muted hover:border-jarvis-accent"
                }`}
                title={t.done ? "Mark incomplete" : "Mark complete"}>
                {t.done ? "✓" : ""}
              </button>
              <span className={`flex-1 min-w-0 truncate text-[13px] font-ui tracking-wide ${
                t.done ? "line-through text-jarvis-muted" : "text-jarvis-text"}`}>
                {t.title}
              </span>
              {due && (
                <span className={`text-[11px] shrink-0 ${overdue ? "text-jarvis-bad" : "text-jarvis-muted"}`}>
                  {overdue ? "overdue" : due.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
              )}
              {!compact && (
                <button onClick={() => remove(t)} className="text-xs text-jarvis-muted hover:text-jarvis-bad">✕</button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
