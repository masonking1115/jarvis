"use client";
import { useEffect, useState } from "react";
import { api, Workout } from "@/lib/api";

const KINDS = ["run", "lift", "peloton", "yoga", "other"];

export default function WorkoutsPage() {
  const [items, setItems] = useState<Workout[]>([]);
  const [kind, setKind] = useState("run");
  const [duration, setDuration] = useState(30);
  const [distance, setDistance] = useState<string>("");
  const [notes, setNotes] = useState("");

  async function refresh() { setItems(await api.get<Workout[]>("/api/workouts")); }
  useEffect(() => { refresh().catch(console.error); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    await api.post<Workout>("/api/workouts", {
      kind, duration_min: duration,
      distance_mi: distance ? Number(distance) : null,
      notes: notes || null,
    });
    setDistance(""); setNotes("");
    refresh();
  }
  async function remove(w: Workout) { await api.del(`/api/workouts/${w.id}`); refresh(); }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Workouts</h1>
      <form onSubmit={add} className="card flex gap-3 flex-wrap">
        <select className="input w-32" value={kind} onChange={e=>setKind(e.target.value)}>
          {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <input className="input w-32" type="number" value={duration} onChange={e=>setDuration(Number(e.target.value))} placeholder="min" />
        <input className="input w-32" type="number" step="0.01" value={distance} onChange={e=>setDistance(e.target.value)} placeholder="miles" />
        <input className="input flex-1 min-w-[200px]" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Notes" />
        <button className="btn">Log</button>
      </form>
      <div className="card">
        {items.length === 0 && <div className="text-sm text-jarvis-muted">No workouts yet.</div>}
        <ul className="divide-y divide-white/5">
          {items.map(w => (
            <li key={w.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="text-jarvis-muted w-32 shrink-0">{new Date(w.performed_at).toLocaleString()}</span>
              <span className="w-20">{w.kind}</span>
              <span className="w-20">{w.duration_min} min</span>
              <span className="w-20">{w.distance_mi != null ? `${w.distance_mi} mi` : ""}</span>
              <span className="flex-1 truncate text-jarvis-muted">{w.notes}</span>
              <button onClick={()=>remove(w)} className="text-xs text-jarvis-muted hover:text-red-400">delete</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
