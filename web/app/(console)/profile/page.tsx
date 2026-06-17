"use client";
import { useEffect, useState } from "react";
import { profile, UserFact } from "@/lib/api";

const CATEGORIES = ["preference", "goal", "routine", "relationship", "context", "dislike", "other"];

export default function ProfilePage() {
  const [facts, setFacts] = useState<UserFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCat, setNewCat] = useState("goal");
  const [newContent, setNewContent] = useState("");

  async function load() {
    setLoading(true);
    try { setFacts((await profile.list()).facts); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    const c = newContent.trim();
    if (!c) return;
    await profile.add(newCat, c);
    setNewContent("");
    load();
  }
  async function togglePin(f: UserFact) { await profile.update(f.id, { pinned: !f.pinned }); load(); }
  async function forget(f: UserFact)    { await profile.remove(f.id); load(); }

  const byCategory = CATEGORIES
    .map(cat => ({ cat, items: facts.filter(f => f.category === cat) }))
    .filter(g => g.items.length > 0);

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl tracking-wider text-jarvis-text mb-1">What JARVIS knows about me</h1>
      <p className="text-jarvis-muted text-sm mb-5">
        Everything JARVIS has learned. Edit, pin, or forget anything — he learns silently as you talk.
      </p>

      <div className="flex gap-2 mb-6">
        <select value={newCat} onChange={e => setNewCat(e.target.value)}
          className="bg-[#040813] border border-jarvis-border rounded px-2 py-2 text-jarvis-text text-sm">
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={newContent} onChange={e => setNewContent(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") add(); }}
          placeholder="Add something JARVIS should know…"
          className="flex-1 bg-[#040813] border border-jarvis-border rounded px-3 py-2 text-jarvis-text text-sm" />
        <button onClick={add}
          className="px-4 py-2 rounded bg-jarvis-accent/20 border border-jarvis-accent text-jarvis-accent text-sm hover:bg-jarvis-accent/30">
          Add
        </button>
      </div>

      {loading ? (
        <p className="text-jarvis-muted">Loading…</p>
      ) : facts.length === 0 ? (
        <p className="text-jarvis-muted">Nothing learned yet. Talk to JARVIS and facts will appear here.</p>
      ) : (
        byCategory.map(({ cat, items }) => (
          <div key={cat} className="mb-6">
            <h2 className="font-ui text-xs tracking-[0.22em] uppercase text-jarvis-accent mb-2">{cat}</h2>
            <ul className="space-y-2">
              {items.map(f => (
                <li key={f.id}
                  className="flex items-center gap-3 border border-jarvis-border rounded px-3 py-2 bg-[#040813]/50">
                  <span className="flex-1 text-jarvis-text text-sm">{f.content}</span>
                  <span className="text-[10px] text-jarvis-muted whitespace-nowrap">
                    {f.source === "explicit" ? "you told me" : `inferred ${Math.round(f.confidence * 100)}%`}
                  </span>
                  <button onClick={() => togglePin(f)} title="Pin"
                    className={`text-xs ${f.pinned ? "text-jarvis-accent" : "text-jarvis-muted hover:text-jarvis-text"}`}>
                    {f.pinned ? "★" : "☆"}
                  </button>
                  <button onClick={() => forget(f)} title="Forget"
                    className="text-xs text-jarvis-muted hover:text-red-400">✕</button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
