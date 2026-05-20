"use client";
import { useEffect, useState } from "react";
import { api, Txn, FinanceSummary } from "@/lib/api";

export default function FinancePage() {
  const [items, setItems] = useState<Txn[]>([]);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("misc");
  const [description, setDescription] = useState("");

  async function refresh() {
    const [list, s] = await Promise.all([
      api.get<Txn[]>("/api/finance"),
      api.get<FinanceSummary>("/api/finance/summary"),
    ]);
    setItems(list); setSummary(s);
  }
  useEffect(() => { refresh().catch(console.error); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!amount) return;
    await api.post<Txn>("/api/finance", {
      amount: Number(amount), category, description: description || null,
    });
    setAmount(""); setDescription("");
    refresh();
  }
  async function remove(t: Txn) { await api.del(`/api/finance/${t.id}`); refresh(); }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Finance</h1>

      {summary && (
        <div className="card grid grid-cols-3 gap-4 text-center">
          <Stat label="Income"   value={`$${summary.income.toFixed(2)}`} />
          <Stat label="Expenses" value={`$${summary.expenses.toFixed(2)}`} />
          <Stat label="Net"      value={`$${summary.net.toFixed(2)}`} />
        </div>
      )}

      <form onSubmit={add} className="card flex gap-3 flex-wrap">
        <input className="input w-32" type="number" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Amount (- = expense)" />
        <input className="input w-32" value={category} onChange={e=>setCategory(e.target.value)} placeholder="category" />
        <input className="input flex-1 min-w-[200px]" value={description} onChange={e=>setDescription(e.target.value)} placeholder="description" />
        <button className="btn">Add</button>
      </form>

      <div className="card">
        {items.length === 0 && <div className="text-sm text-jarvis-muted">No transactions yet.</div>}
        <ul className="divide-y divide-white/5">
          {items.map(t => (
            <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="text-jarvis-muted w-32 shrink-0">{new Date(t.occurred_at).toLocaleDateString()}</span>
              <span className={`w-24 font-mono ${t.amount < 0 ? "text-red-400" : "text-emerald-400"}`}>
                {t.amount < 0 ? "-" : "+"}${Math.abs(t.amount).toFixed(2)}
              </span>
              <span className="w-24 text-jarvis-muted">{t.category}</span>
              <span className="flex-1 truncate">{t.description}</span>
              <button onClick={()=>remove(t)} className="text-xs text-jarvis-muted hover:text-red-400">delete</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
