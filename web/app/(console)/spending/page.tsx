"use client";
import { useEffect, useState } from "react";
import { api, SpendingSummary, Liability } from "@/lib/api";
import { Panel } from "@/components/Panel";
import { PieChart } from "@/components/PieChart";

const $ = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const CAT_COLOR: Record<string, string> = {
  groceries: "#22e8a0", dining: "#ff9c2a", shopping: "#4ad6ff", subscriptions: "#b794ff",
  travel: "#5b8dff", transport: "#3ddc97", entertainment: "#e879f9", bills: "#ffd24a",
  health: "#ff5c6c", other: "#6b7c9a",
};

export default function SpendingPage() {
  const [data, setData] = useState<SpendingSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    try { setData(await api.get<SpendingSummary>("/api/gmail/spending?days=90")); }
    catch { setData(null); }
  }
  useEffect(() => { load(); }, []);

  async function sync() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.post<{ available: boolean; reason?: string; scanned?: number; purchases_added?: number }>(
        "/api/gmail/extract-spending", {});
      if (r.available) { setMsg(`Scanned ${r.scanned} · added ${r.purchases_added} purchases`); load(); }
      else setMsg(r.reason ?? "Gmail not connected.");
    } finally { setBusy(false); }
  }

  const maxMonth = Math.max(1, ...(data?.monthly.map(m => m.amount) || [1]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Spending — from receipts</h1>
        <button className="btn" disabled={busy} onClick={sync}>{busy ? "…" : "SYNC FROM EMAIL"}</button>
      </div>
      {msg && <div className="text-xs text-jarvis-muted">{msg}</div>}

      <ImportBlock onDone={load} />

      {!data || data.count === 0 ? (
        <Panel title="Spending">
          <div className="text-sm text-jarvis-muted">
            No purchases parsed yet. Connect Gmail (Email tab) and hit SYNC FROM EMAIL.
            <div className="mt-1 text-xs">Captures spending that emails a receipt (online orders, subscriptions, delivery, travel) — not in-person card swipes or cash.</div>
          </div>
        </Panel>
      ) : (
        <>
          {/* stat row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label={`Last ${data.days}d`} value={$(data.total)} />
            <Stat label="This month" value={$(data.this_month)} />
            <Stat label="Subscriptions / mo" value={$(data.subscriptions_monthly)} accent="#b794ff" />
            <Stat label="Purchases" value={String(data.count)} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Panel title="By category">
              <PieChart center={$(data.total)} data={data.by_category.map(c => ({
                label: c.category, value: c.amount, color: CAT_COLOR[c.category] || "#6b7c9a",
              }))} />
            </Panel>

            <Panel title="Top merchants">
              <div className="space-y-1.5">
                {data.top_merchants.map(m => (
                  <div key={m.merchant} className="flex items-center gap-2 text-[13px]">
                    <span className="truncate flex-1 text-jarvis-text">{m.merchant}</span>
                    <span className="text-[11px] text-jarvis-muted">{m.count}×</span>
                    <span className="numeric text-jarvis-text w-20 text-right">{$(m.amount)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* monthly trend */}
          <Panel title="Monthly trend">
            <div className="flex items-end gap-2 h-32">
              {data.monthly.map(m => (
                <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-1">
                  <div className="w-full rounded-t bg-jarvis-accent/70" style={{ height: `${(m.amount / maxMonth) * 100}%` }}
                    title={$(m.amount)} />
                  <span className="text-[9px] text-jarvis-muted">{m.month.slice(5)}</span>
                </div>
              ))}
            </div>
          </Panel>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Panel title={`Subscriptions · ${$(data.subscriptions_monthly)}/mo`}>
              {data.subscriptions.length === 0
                ? <div className="text-xs text-jarvis-muted">None detected.</div>
                : <div className="space-y-1">
                    {data.subscriptions.map(s => (
                      <div key={s.merchant} className="flex items-center justify-between text-[13px]">
                        <span className="truncate text-jarvis-text">{s.merchant}</span>
                        <span className="numeric" style={{ color: "#b794ff" }}>{$(s.amount)}</span>
                      </div>
                    ))}
                  </div>}
            </Panel>

            <Panel title="Recent purchases">
              <div className="space-y-1">
                {data.recent.map((r, i) => (
                  <a key={r.message_id + i} href={`https://mail.google.com/mail/u/0/#all/${r.message_id}`}
                    target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 py-1 text-[12px] hover:bg-jarvis-accent/5 rounded px-1">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: CAT_COLOR[r.category] || "#6b7c9a" }} />
                    <span className="truncate flex-1 text-jarvis-text">{r.merchant || r.subject}</span>
                    <span className="text-[10px] text-jarvis-muted">{new Date(r.occurred_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    <span className="numeric text-jarvis-text w-16 text-right">{$(r.amount)}</span>
                  </a>
                ))}
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- import (CSV / Excel / PDF) ---------------- */
function ImportBlock({ onDone }: { onDone: () => void }) {
  const [cards, setCards] = useState<Liability[]>([]);
  const [cardId, setCardId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { api.get<Liability[]>("/api/finance/liabilities").then(setCards).catch(() => {}); }, []);

  async function upload(file: File) {
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (cardId) fd.append("liability_id", cardId);
      const res = await fetch("/api/gmail/import-spending", { method: "POST", body: fd });
      const r = await res.json();
      if (r.available) {
        setMsg(`Parsed ${r.parsed} txns · added ${r.transactions_added} new`
          + (r.balance_updated ? ` · balance set to $${r.balance}` : ""));
        onDone();
      } else setMsg(r.reason || "Import failed.");
    } catch (e: any) { setMsg(String(e?.message || e)); }
    finally { setBusy(false); }
  }

  return (
    <Panel title="Import statement — CSV / Excel / PDF">
      <div className="text-xs text-jarvis-muted mb-2">
        Upload a bank export. Transactions feed this dashboard; pick a card to also set its balance from the statement. Nothing leaves your machine except the LLM categorization.
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className="input" value={cardId} onChange={e => setCardId(e.target.value)}>
          <option value="">(don&apos;t update a balance)</option>
          {cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="btn cursor-pointer">
          {busy ? "PARSING…" : "CHOOSE FILE"}
          <input type="file" accept=".csv,.xlsx,.xlsm,.xls,.pdf" className="hidden" disabled={busy}
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ""; }} />
        </label>
        {msg && <span className="text-xs text-jarvis-muted">{msg}</span>}
      </div>
    </Panel>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="panel py-3">
      <div className="text-[11px] text-jarvis-muted">{label}</div>
      <div className="text-xl font-bold numeric" style={accent ? { color: accent } : {}}>{value}</div>
    </div>
  );
}
