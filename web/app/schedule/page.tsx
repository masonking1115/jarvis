"use client";
import { useEffect, useState } from "react";
import { api, Event } from "@/lib/api";

export default function SchedulePage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [location, setLocation] = useState("");

  async function refresh() { setEvents(await api.get<Event[]>("/api/schedule")); }
  useEffect(() => { refresh().catch(console.error); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !startsAt) return;
    await api.post<Event>("/api/schedule", { title, starts_at: new Date(startsAt).toISOString(), location: location || null });
    setTitle(""); setStartsAt(""); setLocation("");
    refresh();
  }
  async function remove(ev: Event) { await api.del(`/api/schedule/${ev.id}`); refresh(); }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Schedule</h1>
      <form onSubmit={add} className="card flex gap-3 flex-wrap">
        <input className="input flex-1 min-w-[200px]" placeholder="Event…" value={title} onChange={e=>setTitle(e.target.value)} />
        <input className="input w-56" type="datetime-local" value={startsAt} onChange={e=>setStartsAt(e.target.value)} />
        <input className="input w-40" placeholder="Location" value={location} onChange={e=>setLocation(e.target.value)} />
        <button className="btn">Add</button>
      </form>
      <div className="card">
        {events.length === 0 && <div className="text-sm text-jarvis-muted">No events.</div>}
        <ul className="divide-y divide-white/5">
          {events.map(e => (
            <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="text-jarvis-muted w-40 shrink-0">{new Date(e.starts_at).toLocaleString()}</span>
              <span className="flex-1">{e.title}</span>
              <span className="text-jarvis-muted text-xs">{e.location}</span>
              <button onClick={()=>remove(e)} className="text-xs text-jarvis-muted hover:text-red-400">delete</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
