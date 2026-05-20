"use client";
import { useEffect, useState } from "react";
import { api, Task } from "@/lib/api";

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState(3);
  const [includeDone, setIncludeDone] = useState(false);

  async function refresh() {
    setTasks(await api.get<Task[]>(`/api/tasks?include_done=${includeDone}`));
  }
  useEffect(() => { refresh().catch(console.error); }, [includeDone]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await api.post<Task>("/api/tasks", { title, priority });
    setTitle(""); setPriority(3);
    refresh();
  }
  async function toggle(t: Task) {
    await api.patch<Task>(`/api/tasks/${t.id}`, { done: !t.done });
    refresh();
  }
  async function remove(t: Task) {
    await api.del(`/api/tasks/${t.id}`);
    refresh();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Tasks</h1>
      <form onSubmit={add} className="card flex gap-3 flex-wrap">
        <input className="input flex-1 min-w-[200px]" placeholder="Add a task…"
          value={title} onChange={e => setTitle(e.target.value)} />
        <select className="input w-32" value={priority} onChange={e => setPriority(Number(e.target.value))}>
          {[1,2,3,4,5].map(p => <option key={p} value={p}>P{p}</option>)}
        </select>
        <button className="btn">Add</button>
      </form>

      <label className="flex items-center gap-2 text-sm text-jarvis-muted">
        <input type="checkbox" checked={includeDone} onChange={e => setIncludeDone(e.target.checked)} />
        Show completed
      </label>

      <div className="card">
        {tasks.length === 0 && <div className="text-sm text-jarvis-muted">No tasks.</div>}
        <ul className="divide-y divide-white/5">
          {tasks.map(t => (
            <li key={t.id} className="flex items-center gap-3 py-2">
              <input type="checkbox" checked={t.done} onChange={() => toggle(t)} />
              <span className="text-xs text-jarvis-muted w-8">P{t.priority}</span>
              <span className={`flex-1 ${t.done ? "line-through text-jarvis-muted" : ""}`}>{t.title}</span>
              <button onClick={() => remove(t)} className="text-xs text-jarvis-muted hover:text-red-400">delete</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
