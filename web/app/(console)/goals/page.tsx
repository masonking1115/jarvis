"use client";
import { useEffect, useState } from "react";
import { api, Goal } from "@/lib/api";

const CATEGORIES = ["financial", "fitness", "career", "learning", "engineering", "social", "personal"];

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("personal");

  async function refresh() { setGoals(await api.get<Goal[]>("/api/goals")); }
  useEffect(() => { refresh().catch(console.error); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await api.post<Goal>("/api/goals", { title, category });
    setTitle("");
    refresh();
  }
  async function setProgress(g: Goal, progress: number) {
    await api.patch<Goal>(`/api/goals/${g.id}`, { progress });
    refresh();
  }
  async function remove(g: Goal) {
    await api.del(`/api/goals/${g.id}`);
    refresh();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Goals</h1>
      <form onSubmit={add} className="card flex gap-3 flex-wrap">
        <input className="input flex-1 min-w-[200px]" placeholder="Add a goal…"
          value={title} onChange={e => setTitle(e.target.value)} />
        <select className="input w-44" value={category} onChange={e => setCategory(e.target.value)}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="btn">Add</button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {goals.map(g => (
          <div key={g.id} className="card space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="label">{g.category}</div>
                <div className="font-semibold">{g.title}</div>
              </div>
              <button onClick={() => remove(g)} className="text-xs text-jarvis-muted hover:text-red-400">delete</button>
            </div>
            <input
              type="range" min={0} max={100} value={Math.round(g.progress * 100)}
              onChange={e => setProgress(g, Number(e.target.value) / 100)}
              className="w-full"
            />
            <div className="text-xs text-jarvis-muted">{Math.round(g.progress * 100)}%</div>
          </div>
        ))}
        {goals.length === 0 && <div className="text-sm text-jarvis-muted">No goals yet.</div>}
      </div>
    </div>
  );
}
