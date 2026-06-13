"use client";
import { useEffect, useState } from "react";
import {
  api, Txn, IncomeSource, Asset, Liability, FinanceOverview,
  RobinhoodStatus, RobinhoodSyncResult,
} from "@/lib/api";
import { Panel } from "@/components/Panel";

const INCOME_FREQS = ["weekly", "biweekly", "semimonthly", "monthly", "annual", "irregular"];
const ASSET_CATS = ["cash", "stocks", "crypto", "retirement", "real_estate", "vehicle", "other"];
const LIAB_CATS  = ["credit_card", "student", "auto", "mortgage", "personal", "other"];

const CAT_COLOR: Record<string, string> = {
  cash: "#22e8a0", stocks: "#4ad6ff", crypto: "#b794ff", retirement: "#ffd24a",
  real_estate: "#ff9c2a", vehicle: "#94a8c9", other: "#6b7c9a",
  credit_card: "#ff5c6c", student: "#b794ff", auto: "#ff9c2a", mortgage: "#5b8dff", personal: "#94a8c9",
};

const $ = (n: number, opts: Intl.NumberFormatOptions = {}) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0, ...opts });

export default function FinancePage() {
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [income, setIncome] = useState<IncomeSource[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);

  async function refresh() {
    const [o, i, a, l, t] = await Promise.all([
      api.get<FinanceOverview>("/api/finance/overview"),
      api.get<IncomeSource[]>("/api/finance/income"),
      api.get<Asset[]>("/api/finance/assets"),
      api.get<Liability[]>("/api/finance/liabilities"),
      api.get<Txn[]>("/api/finance?limit=20"),
    ]);
    setOverview(o); setIncome(i); setAssets(a); setLiabilities(l); setTxns(t);
  }
  useEffect(() => { refresh().catch(console.error); }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Finance — Personal CFO</h1>

      <OverviewBlock overview={overview} />

      <RobinhoodBlock onSynced={refresh} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <IncomeBlock items={income} onChange={refresh} />
        <CashflowBlock overview={overview} />
      </div>

      <AssetsBlock items={assets} onChange={refresh} />
      <LiabilitiesBlock items={liabilities} onChange={refresh} />
      <TransactionsBlock items={txns} onChange={refresh} />
    </div>
  );
}

/* ---------------- Overview ---------------- */

function OverviewBlock({ overview }: { overview: FinanceOverview | null }) {
  if (!overview) return <Panel title="Net Worth"><div className="text-jarvis-muted text-sm">Loading…</div></Panel>;
  const positive = overview.net_worth >= 0;
  return (
    <Panel title="Net Worth">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
        <div className="md:col-span-2">
          <div className="label">Total</div>
          <div className={`numeric text-4xl mt-1 ${positive ? "text-jarvis-accent" : "text-jarvis-bad"} drop-shadow-[0_0_12px_rgba(74,214,255,0.4)]`}>
            {$(overview.net_worth)}
          </div>
          <div className="text-xs text-jarvis-muted mt-1">
            {$(overview.assets_total)} assets · {$(overview.liabilities_total)} debts
          </div>
        </div>
        <Stat label="Cash"        value={$(overview.cash_total)} color="#22e8a0" />
        <Stat label="Investments" value={$(overview.investments_total)} color="#4ad6ff" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
        <Breakdown title="Assets" rows={overview.asset_breakdown} total={overview.assets_total} />
        <Breakdown title="Debts"  rows={overview.liability_breakdown} total={overview.liabilities_total} />
      </div>
    </Panel>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="numeric text-xl mt-1" style={{ color: color ?? "#cfe2ff", textShadow: color ? `0 0 8px ${color}55` : undefined }}>
        {value}
      </div>
    </div>
  );
}

function Breakdown({ title, rows, total }: { title: string; rows: { category: string; value: number }[]; total: number }) {
  if (rows.length === 0) {
    return (
      <div>
        <div className="label mb-2">{title} breakdown</div>
        <div className="text-xs text-jarvis-muted italic">No {title.toLowerCase()} logged yet.</div>
      </div>
    );
  }
  return (
    <div>
      <div className="label mb-2">{title} breakdown</div>
      <div className="space-y-2">
        {rows.map(r => {
          const pct = total ? (r.value / total) * 100 : 0;
          return (
            <div key={r.category} className="flex items-center gap-3 text-xs">
              <span className="w-28 capitalize text-jarvis-dim">{r.category.replace("_", " ")}</span>
              <div className="flex-1 h-1.5 bg-jarvis-bg2 border border-jarvis-border rounded-full overflow-hidden">
                <div className="h-full"
                     style={{ width: `${pct}%`, background: CAT_COLOR[r.category] ?? "#4ad6ff",
                              boxShadow: `0 0 6px ${CAT_COLOR[r.category] ?? "#4ad6ff"}80` }} />
              </div>
              <span className="numeric w-20 text-right text-jarvis-text">{$(r.value)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Income ---------------- */

function IncomeBlock({ items, onChange }: { items: IncomeSource[]; onChange: () => void }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("biweekly");
  const [nextPay, setNextPay] = useState("");
  const [isGross, setIsGross] = useState(true);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !amount) return;
    await api.post<IncomeSource>("/api/finance/income", {
      name, amount: Number(amount), frequency, is_gross: isGross,
      next_pay_date: nextPay || null,
    });
    setName(""); setAmount(""); setNextPay("");
    onChange();
  }
  async function patch(s: IncomeSource, body: Partial<IncomeSource>) {
    await api.patch(`/api/finance/income/${s.id}`, body);
    onChange();
  }
  async function remove(s: IncomeSource) {
    await api.del(`/api/finance/income/${s.id}`);
    onChange();
  }

  return (
    <Panel title="Income Sources">
      <form onSubmit={add} className="grid grid-cols-12 gap-2 mb-3">
        <input className="input col-span-12 md:col-span-4 !py-1.5" placeholder="Name (e.g. Engineering Salary)" value={name} onChange={e=>setName(e.target.value)} />
        <input className="input col-span-6 md:col-span-2 !py-1.5" type="number" step="0.01" placeholder="amount" value={amount} onChange={e=>setAmount(e.target.value)} />
        <select className="input col-span-6 md:col-span-2 !py-1.5" value={frequency} onChange={e=>setFrequency(e.target.value)}>
          {INCOME_FREQS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <input className="input col-span-6 md:col-span-2 !py-1.5" type="date" value={nextPay} onChange={e=>setNextPay(e.target.value)} />
        <label className="col-span-6 md:col-span-1 flex items-center gap-1 text-[11px] text-jarvis-muted">
          <input type="checkbox" checked={isGross} onChange={e=>setIsGross(e.target.checked)} /> gross
        </label>
        <button className="btn col-span-12 md:col-span-1">ADD</button>
      </form>

      {items.length === 0 && <div className="text-sm text-jarvis-muted italic">No income sources yet.</div>}
      <ul className="divide-y divide-jarvis-border/70">
        {items.map(s => (
          <li key={s.id} className="py-2.5 flex flex-wrap items-center gap-2 text-sm">
            <input className="input !py-1 !px-2 flex-1 min-w-[180px]" defaultValue={s.name}
                   onBlur={e => e.target.value !== s.name && patch(s, { name: e.target.value })} />
            <input className="input !py-1 !px-2 w-24 numeric" type="number" step="0.01" defaultValue={s.amount}
                   onBlur={e => Number(e.target.value) !== s.amount && patch(s, { amount: Number(e.target.value) })} />
            <select className="input !py-1 !px-2 w-32" value={s.frequency} onChange={e => patch(s, { frequency: e.target.value })}>
              {INCOME_FREQS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <input className="input !py-1 !px-2 w-40" type="date" defaultValue={s.next_pay_date ?? ""}
                   onBlur={e => patch(s, { next_pay_date: e.target.value || null })} />
            <label className="flex items-center gap-1 text-[10px] text-jarvis-muted">
              <input type="checkbox" checked={s.active} onChange={e => patch(s, { active: e.target.checked })} /> active
            </label>
            <button onClick={() => remove(s)} className="text-xs text-jarvis-muted hover:text-jarvis-bad">✕</button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ---------------- Cash flow ---------------- */

function CashflowBlock({ overview }: { overview: FinanceOverview | null }) {
  if (!overview) return <Panel title="Monthly Cash Flow"><div className="text-jarvis-muted text-sm">Loading…</div></Panel>;
  const inc = overview.income;
  const savings = overview.monthly_savings_est;
  return (
    <Panel title="Monthly Cash Flow">
      <div className="grid grid-cols-3 gap-4 text-center">
        <Stat label="Income (net)"     value={$(inc.monthly_net)} color="#22e8a0" />
        <Stat label="Expenses (30d)"   value={$(overview.monthly_expenses)} color="#ff5c6c" />
        <Stat label="Est. Savings"     value={$(savings)} color={savings >= 0 ? "#4ad6ff" : "#ff5c6c"} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg border border-jarvis-border bg-jarvis-panel2/40 p-3">
          <div className="label">Gross / month</div>
          <div className="numeric text-lg mt-1">{$(inc.monthly_gross)}</div>
          <div className="text-jarvis-muted mt-1">Min debt payments: {$(overview.debt_minimum_payment_total)}</div>
        </div>
        <div className="rounded-lg border border-jarvis-border bg-jarvis-panel2/40 p-3">
          <div className="label">Next paycheck</div>
          {inc.next_pay_date ? (
            <>
              <div className="numeric text-lg mt-1">{inc.next_pay_amount ? $(inc.next_pay_amount) : "—"}</div>
              <div className="text-jarvis-muted mt-1">
                {inc.next_pay_date} · in {inc.days_to_next_pay} day{inc.days_to_next_pay === 1 ? "" : "s"}
              </div>
            </>
          ) : (
            <div className="text-jarvis-muted italic mt-1">Set a next-pay date on an income source.</div>
          )}
        </div>
      </div>
    </Panel>
  );
}

/* ---------------- Assets ---------------- */

function AssetsBlock({ items, onChange }: { items: Asset[]; onChange: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("cash");
  const [value, setValue] = useState("");
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !value) return;
    await api.post<Asset>("/api/finance/assets", {
      name, category, value: Number(value),
      ticker: ticker || null,
      shares: shares ? Number(shares) : null,
    });
    setName(""); setValue(""); setTicker(""); setShares("");
    onChange();
  }
  async function patch(a: Asset, body: Partial<Asset>) { await api.patch(`/api/finance/assets/${a.id}`, body); onChange(); }
  async function remove(a: Asset) { await api.del(`/api/finance/assets/${a.id}`); onChange(); }

  return (
    <Panel title="Assets">
      <form onSubmit={add} className="grid grid-cols-12 gap-2 mb-3">
        <input className="input col-span-12 md:col-span-3 !py-1.5" placeholder="Name (e.g. Schwab Brokerage / VTI)" value={name} onChange={e=>setName(e.target.value)} />
        <select className="input col-span-6 md:col-span-2 !py-1.5" value={category} onChange={e=>setCategory(e.target.value)}>
          {ASSET_CATS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="input col-span-6 md:col-span-2 !py-1.5" type="number" step="0.01" placeholder="$ value" value={value} onChange={e=>setValue(e.target.value)} />
        <input className="input col-span-6 md:col-span-2 !py-1.5" placeholder="ticker (opt.)" value={ticker} onChange={e=>setTicker(e.target.value)} />
        <input className="input col-span-6 md:col-span-2 !py-1.5" type="number" step="0.0001" placeholder="shares (opt.)" value={shares} onChange={e=>setShares(e.target.value)} />
        <button className="btn col-span-12 md:col-span-1">ADD</button>
      </form>

      {items.length === 0 && <div className="text-sm text-jarvis-muted italic">No assets logged yet.</div>}
      <ul className="divide-y divide-jarvis-border/70">
        {items.map(a => (
          <li key={a.id} className="py-2.5 flex flex-wrap items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CAT_COLOR[a.category] ?? "#4ad6ff" }} />
            <input className="input !py-1 !px-2 flex-1 min-w-[180px]" defaultValue={a.name}
                   onBlur={e => e.target.value !== a.name && patch(a, { name: e.target.value })} />
            <select className="input !py-1 !px-2 w-32" value={a.category} onChange={e => patch(a, { category: e.target.value })}>
              {ASSET_CATS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="input !py-1 !px-2 w-28 numeric" type="number" step="0.01" defaultValue={a.value}
                   onBlur={e => Number(e.target.value) !== a.value && patch(a, { value: Number(e.target.value) })} />
            <input className="input !py-1 !px-2 w-20" placeholder="ticker" defaultValue={a.ticker ?? ""}
                   onBlur={e => (e.target.value || null) !== a.ticker && patch(a, { ticker: e.target.value || null })} />
            <input className="input !py-1 !px-2 w-24 numeric" type="number" step="0.0001" placeholder="shares"
                   defaultValue={a.shares ?? ""}
                   onBlur={e => patch(a, { shares: e.target.value ? Number(e.target.value) : null })} />
            <button onClick={() => remove(a)} className="text-xs text-jarvis-muted hover:text-jarvis-bad">✕</button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ---------------- Liabilities ---------------- */

function LiabilitiesBlock({ items, onChange }: { items: Liability[]; onChange: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("credit_card");
  const [balance, setBalance] = useState("");
  const [apr, setApr] = useState("");
  const [minPay, setMinPay] = useState("");
  const [dueDay, setDueDay] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.post<Liability>("/api/finance/liabilities", {
      name, category,
      balance: balance ? Number(balance) : 0,
      apr: apr ? Number(apr) : null,
      minimum_payment: minPay ? Number(minPay) : null,
      due_day_of_month: dueDay ? Number(dueDay) : null,
    });
    setName(""); setBalance(""); setApr(""); setMinPay(""); setDueDay("");
    onChange();
  }
  async function patch(l: Liability, body: Partial<Liability>) { await api.patch(`/api/finance/liabilities/${l.id}`, body); onChange(); }
  async function remove(l: Liability) { await api.del(`/api/finance/liabilities/${l.id}`); onChange(); }

  return (
    <Panel title="Debts & Liabilities">
      <form onSubmit={add} className="grid grid-cols-12 gap-2 mb-3">
        <input className="input col-span-12 md:col-span-3 !py-1.5" placeholder="Name (e.g. Chase Sapphire)" value={name} onChange={e=>setName(e.target.value)} />
        <select className="input col-span-6 md:col-span-2 !py-1.5" value={category} onChange={e=>setCategory(e.target.value)}>
          {LIAB_CATS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="input col-span-6 md:col-span-2 !py-1.5" type="number" step="0.01" placeholder="balance" value={balance} onChange={e=>setBalance(e.target.value)} />
        <input className="input col-span-4 md:col-span-1 !py-1.5" type="number" step="0.01" placeholder="APR %" value={apr} onChange={e=>setApr(e.target.value)} />
        <input className="input col-span-4 md:col-span-2 !py-1.5" type="number" step="0.01" placeholder="min payment" value={minPay} onChange={e=>setMinPay(e.target.value)} />
        <input className="input col-span-4 md:col-span-1 !py-1.5" type="number" min={1} max={31} placeholder="due" value={dueDay} onChange={e=>setDueDay(e.target.value)} />
        <button className="btn col-span-12 md:col-span-1">ADD</button>
      </form>

      {items.length === 0 && <div className="text-sm text-jarvis-muted italic">No debts logged. (Hopefully it stays that way.)</div>}
      <ul className="divide-y divide-jarvis-border/70">
        {items.map(l => (
          <li key={l.id} className="py-2.5 flex flex-wrap items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CAT_COLOR[l.category] ?? "#ff5c6c" }} />
            <input className="input !py-1 !px-2 flex-1 min-w-[180px]" defaultValue={l.name}
                   onBlur={e => e.target.value !== l.name && patch(l, { name: e.target.value })} />
            <select className="input !py-1 !px-2 w-32" value={l.category} onChange={e => patch(l, { category: e.target.value })}>
              {LIAB_CATS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="input !py-1 !px-2 w-28 numeric" type="number" step="0.01" defaultValue={l.balance}
                   onBlur={e => Number(e.target.value) !== l.balance && patch(l, { balance: Number(e.target.value) })} />
            <input className="input !py-1 !px-2 w-20 numeric" type="number" step="0.01" placeholder="APR" defaultValue={l.apr ?? ""}
                   onBlur={e => patch(l, { apr: e.target.value ? Number(e.target.value) : null })} />
            <input className="input !py-1 !px-2 w-24 numeric" type="number" step="0.01" placeholder="min" defaultValue={l.minimum_payment ?? ""}
                   onBlur={e => patch(l, { minimum_payment: e.target.value ? Number(e.target.value) : null })} />
            <input className="input !py-1 !px-2 w-14 numeric" type="number" min={1} max={31} placeholder="due" defaultValue={l.due_day_of_month ?? ""}
                   onBlur={e => patch(l, { due_day_of_month: e.target.value ? Number(e.target.value) : null })} />
            <button onClick={() => remove(l)} className="text-xs text-jarvis-muted hover:text-jarvis-bad">✕</button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ---------------- Transactions ---------------- */

function TransactionsBlock({ items, onChange }: { items: Txn[]; onChange: () => void }) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("misc");
  const [description, setDescription] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!amount) return;
    await api.post<Txn>("/api/finance", {
      amount: Number(amount), category, description: description || null,
    });
    setAmount(""); setDescription("");
    onChange();
  }
  async function remove(t: Txn) { await api.del(`/api/finance/${t.id}`); onChange(); }

  return (
    <Panel title="Recent Transactions">
      <form onSubmit={add} className="flex gap-2 flex-wrap mb-3">
        <input className="input w-32 !py-1.5" type="number" step="0.01" placeholder="amount (- expense)" value={amount} onChange={e=>setAmount(e.target.value)} />
        <input className="input w-32 !py-1.5" value={category} onChange={e=>setCategory(e.target.value)} placeholder="category" />
        <input className="input flex-1 min-w-[200px] !py-1.5" value={description} onChange={e=>setDescription(e.target.value)} placeholder="description" />
        <button className="btn">ADD</button>
      </form>
      <ul className="divide-y divide-jarvis-border/70">
        {items.map(t => (
          <li key={t.id} className="py-2 flex items-center gap-3 text-sm">
            <span className="text-jarvis-muted w-28 shrink-0">{new Date(t.occurred_at).toLocaleDateString()}</span>
            <span className={`w-24 numeric ${t.amount < 0 ? "text-jarvis-bad" : "text-jarvis-good"}`}>
              {t.amount < 0 ? "-" : "+"}${Math.abs(t.amount).toFixed(2)}
            </span>
            <span className="w-24 text-jarvis-muted text-xs">{t.category}</span>
            <span className="flex-1 truncate">{t.description}</span>
            <button onClick={()=>remove(t)} className="text-xs text-jarvis-muted hover:text-jarvis-bad">✕</button>
          </li>
        ))}
        {items.length === 0 && <li className="text-sm text-jarvis-muted italic py-2">No transactions yet.</li>}
      </ul>
    </Panel>
  );
}

/* ---------------- Robinhood ---------------- */

function RobinhoodBlock({ onSynced }: { onSynced: () => void }) {
  const [status, setStatus] = useState<RobinhoodStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadStatus() {
    try { setStatus(await api.get<RobinhoodStatus>("/api/robinhood/status")); }
    catch { setStatus(null); }
  }
  useEffect(() => { loadStatus(); }, []);

  async function connect() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.post<{ available: boolean; redirect_url?: string; reason?: string }>("/api/robinhood/connect", {});
      if (r.available && r.redirect_url) {
        window.open(r.redirect_url, "_blank");
        setMsg("Finish the SnapTrade sign-in in the new tab — this panel will update automatically.");
        pollUntilConnected();
      } else {
        setMsg(r.reason ?? "Could not start connection.");
      }
    } finally { setBusy(false); }
  }

  // After the browser sign-in, the backend loopback stores tokens out-of-band;
  // poll status so the panel flips to CONNECTED, then pull data immediately.
  function pollUntilConnected() {
    let tries = 0;
    const iv = setInterval(async () => {
      tries += 1;
      try {
        const s = await api.get<RobinhoodStatus>("/api/robinhood/status");
        setStatus(s);
        if (s.connected) { clearInterval(iv); setMsg("Connected — syncing…"); syncNow(); return; }
      } catch { /* keep polling */ }
      if (tries >= 60) { clearInterval(iv); }  // give up after ~3 min
    }, 3000);
  }

  async function syncNow() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.post<RobinhoodSyncResult>("/api/robinhood/sync", {});
      if (r.available) {
        setMsg(`Synced ${r.assets_synced} holdings · ${r.transactions_synced} transactions · ${$(r.portfolio_value ?? 0)} portfolio`);
        onSynced();
      } else {
        setMsg(r.reason ?? "Sync unavailable.");
      }
    } finally { setBusy(false); loadStatus(); }
  }

  const connected = status?.connected;
  const pill = !status?.configured
    ? { t: "NOT CONFIGURED", c: "#6b7c9a" }
    : connected
      ? { t: "CONNECTED", c: "#22e8a0" }
      : { t: "NOT CONNECTED", c: "#ff9c2a" };

  return (
    <Panel title="Robinhood">
      <div className="flex flex-wrap items-center gap-3">
        <span className="pill" style={{ borderColor: pill.c, color: pill.c }}>
          <span className="dot" style={{ background: pill.c, width: 7, height: 7 }} /> {pill.t}
        </span>
        {!connected && (
          <button className="btn" disabled={busy || !status?.configured} onClick={connect}>
            CONNECT ROBINHOOD
          </button>
        )}
        <button className="btn" disabled={busy || !connected} onClick={syncNow}>SYNC NOW</button>
        {msg && <span className="text-xs text-jarvis-muted">{msg}</span>}
      </div>
      {!status?.configured && (
        <div className="text-xs text-jarvis-muted mt-2">
          Add SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY to backend/.env, then restart the backend.
        </div>
      )}
    </Panel>
  );
}
