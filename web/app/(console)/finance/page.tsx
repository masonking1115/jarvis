"use client";
import { useEffect, useMemo, useState } from "react";
import {
  api, tax, Txn, IncomeSource, Asset, Liability, FinanceOverview,
  RobinhoodStatus, RobinhoodSyncResult, EmailCardStatement, StatementReminder, CardSpending, SpendingSummary, TaxDocument,
} from "@/lib/api";
import { Panel } from "@/components/Panel";
import { PieChart } from "@/components/PieChart";

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

// Distinct slice palette for the allocation pies.
const PIE_PALETTE = [
  "#4ad6ff", "#b794ff", "#22e8a0", "#ffd24a", "#ff9c2a", "#ff5c6c",
  "#5b8dff", "#3ddc97", "#e879f9", "#f4a261", "#60a5fa", "#94a8c9",
];

// We don't store sector data, so classify the known holdings by ticker.
const TICKER_INDUSTRY: Record<string, string> = {
  NVDA: "Semiconductors", AMD: "Semiconductors",
  MSFT: "Technology", PLTR: "Technology", PANW: "Technology",
  AZO: "Consumer", COST: "Consumer", MNST: "Consumer",
  SPY: "Index ETFs", QQQ: "Index ETFs",
  GLD: "Commodities",
};

export default function FinancePage() {
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [income, setIncome] = useState<IncomeSource[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [statements, setStatements] = useState<EmailCardStatement[]>([]);
  const [reminders, setReminders] = useState<StatementReminder[]>([]);
  const [cardSpending, setCardSpending] = useState<CardSpending[]>([]);
  const [spending, setSpending] = useState<SpendingSummary | null>(null);

  async function refresh() {
    const [o, i, a, l, t] = await Promise.all([
      api.get<FinanceOverview>("/api/finance/overview"),
      api.get<IncomeSource[]>("/api/finance/income"),
      api.get<Asset[]>("/api/finance/assets"),
      api.get<Liability[]>("/api/finance/liabilities"),
      api.get<Txn[]>("/api/finance?limit=20"),
    ]);
    setOverview(o); setIncome(i); setAssets(a); setLiabilities(l); setTxns(t);
    // Email-derived debts are best-effort — never block the finance view on Gmail.
    try { setStatements(await api.get<EmailCardStatement[]>("/api/gmail/statements")); }
    catch { setStatements([]); }
    try { setReminders(await api.get<StatementReminder[]>("/api/gmail/statement-reminders")); }
    catch { setReminders([]); }
    try { setCardSpending(await api.get<CardSpending[]>("/api/gmail/card-spending")); }
    catch { setCardSpending([]); }
    try { setSpending(await api.get<SpendingSummary>("/api/gmail/spending?days=365")); }
    catch { setSpending(null); }
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
      <AllocationBlock items={assets} spending={spending} />
      <CardsGrid items={cardSpending} reminders={reminders} onChange={refresh} />
      <TaxBlock />
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
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map(s => (
          <div key={s.id} className="rounded-lg border border-jarvis-border/70 bg-white/[0.02] p-3 flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <input className="input !py-1 !px-2 flex-1 text-sm font-medium" defaultValue={s.name}
                     onBlur={e => e.target.value !== s.name && patch(s, { name: e.target.value })} />
              <button onClick={() => remove(s)} className="text-xs text-jarvis-muted hover:text-jarvis-bad mt-1.5">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] tracking-wider text-jarvis-muted mb-0.5">AMOUNT</div>
                <input className="input !py-1 !px-2 w-full numeric" type="number" step="0.01" defaultValue={s.amount}
                       onBlur={e => Number(e.target.value) !== s.amount && patch(s, { amount: Number(e.target.value) })} />
              </div>
              <div>
                <div className="text-[10px] tracking-wider text-jarvis-muted mb-0.5">FREQUENCY</div>
                <select className="input !py-1 !px-2 w-full" value={s.frequency} onChange={e => patch(s, { frequency: e.target.value })}>
                  {INCOME_FREQS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>
            <div>
              <div className="text-[10px] tracking-wider text-jarvis-muted mb-0.5">NEXT PAY</div>
              <input className="input !py-1 !px-2 w-full" type="date" defaultValue={s.next_pay_date ?? ""}
                     onBlur={e => patch(s, { next_pay_date: e.target.value || null })} />
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-jarvis-muted mt-0.5">
              <input type="checkbox" checked={s.active} onChange={e => patch(s, { active: e.target.checked })} /> active
            </label>
          </div>
        ))}
      </div>
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

  const manual = items.filter(a => a.source !== "robinhood");
  const rh = items.filter(a => a.source === "robinhood").sort((x, y) => (y.value ?? 0) - (x.value ?? 0));
  const rhTotal = rh.reduce((s, a) => s + (a.value ?? 0), 0);

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

      {/* Manual assets — editable cards */}
      {manual.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {manual.map(a => (
            <div key={a.id} className="rounded-lg border border-jarvis-border/70 bg-white/[0.02] p-3 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full shrink-0 mt-2.5" style={{ background: CAT_COLOR[a.category] ?? "#4ad6ff" }} />
                <input className="input !py-1 !px-2 flex-1 text-sm font-medium" defaultValue={a.name}
                       onBlur={e => e.target.value !== a.name && patch(a, { name: e.target.value })} />
                <button onClick={() => remove(a)} className="text-xs text-jarvis-muted hover:text-jarvis-bad mt-1.5">✕</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] tracking-wider text-jarvis-muted mb-0.5">CATEGORY</div>
                  <select className="input !py-1 !px-2 w-full" value={a.category} onChange={e => patch(a, { category: e.target.value })}>
                    {ASSET_CATS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-[10px] tracking-wider text-jarvis-muted mb-0.5">VALUE</div>
                  <input className="input !py-1 !px-2 w-full numeric" type="number" step="0.01" defaultValue={a.value}
                         onBlur={e => Number(e.target.value) !== a.value && patch(a, { value: Number(e.target.value) })} />
                </div>
                <div>
                  <div className="text-[10px] tracking-wider text-jarvis-muted mb-0.5">TICKER</div>
                  <input className="input !py-1 !px-2 w-full" placeholder="—" defaultValue={a.ticker ?? ""}
                         onBlur={e => (e.target.value || null) !== a.ticker && patch(a, { ticker: e.target.value || null })} />
                </div>
                <div>
                  <div className="text-[10px] tracking-wider text-jarvis-muted mb-0.5">SHARES</div>
                  <input className="input !py-1 !px-2 w-full numeric" type="number" step="0.0001" placeholder="—"
                         defaultValue={a.shares ?? ""}
                         onBlur={e => patch(a, { shares: e.target.value ? Number(e.target.value) : null })} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Robinhood holdings — compact, read-only (auto-synced) */}
      {rh.length > 0 && (
        <div className={manual.length > 0 ? "mt-4" : ""}>
          <div className="flex items-baseline justify-between mb-1.5 px-0.5">
            <span className="text-[11px] tracking-wider text-jarvis-muted">ROBINHOOD HOLDINGS · {rh.length}</span>
            <span className="text-[11px] text-jarvis-dim numeric">{$(rhTotal)}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-x-4 gap-y-2 rounded-lg border border-jarvis-border/70 p-3">
            {rh.map(a => (
              <div key={a.id} className="flex items-center gap-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: CAT_COLOR[a.category] ?? "#4ad6ff" }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12px] font-medium shrink-0">{a.ticker || a.name}</span>
                    <span className="text-[12px] font-medium numeric text-jarvis-text shrink-0">{$(a.value)}</span>
                  </div>
                  <div className="text-[10px] text-jarvis-muted leading-tight truncate">
                    {[a.ticker ? a.name : null, a.shares ? a.shares.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " sh" : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ---------------- Allocation (pie charts) ---------------- */

function AllocationBlock({ items, spending }: { items: Asset[]; spending: SpendingSummary | null }) {
  const stocks = items.filter(a => a.category === "stocks" && (a.value ?? 0) > 0);
  const crypto = items.filter(a => a.category === "crypto" && (a.value ?? 0) > 0);

  // Chart 1: stocks grouped by industry, plus a Crypto slice.
  const industryMap: Record<string, number> = {};
  for (const a of stocks) {
    const ind = (a.ticker && TICKER_INDUSTRY[a.ticker]) || "Other";
    industryMap[ind] = (industryMap[ind] ?? 0) + (a.value ?? 0);
  }
  const cryptoTotal = crypto.reduce((s, a) => s + (a.value ?? 0), 0);
  if (cryptoTotal > 0) industryMap["Crypto"] = cryptoTotal;
  const industryData = Object.entries(industryMap)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: PIE_PALETTE[i % PIE_PALETTE.length] }));

  // Chart 2: individual stocks, aggregated by ticker (same ticker across accounts merges).
  const stockMap: Record<string, number> = {};
  for (const a of stocks) {
    const key = a.ticker || a.name;
    stockMap[key] = (stockMap[key] ?? 0) + (a.value ?? 0);
  }
  const stockData = Object.entries(stockMap)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: PIE_PALETTE[i % PIE_PALETTE.length] }));

  if (!industryData.length && !stockData.length) return null;

  const industryTotal = industryData.reduce((s, d) => s + d.value, 0);
  const stocksOnlyTotal = stockData.reduce((s, d) => s + d.value, 0);

  // Chart 3: all expenditures by category (from parsed spending).
  const expenditureData = (spending?.by_category || [])
    .filter(c => c.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .map((c, i) => ({ label: c.category, value: c.amount, color: PIE_PALETTE[i % PIE_PALETTE.length] }));
  const expenditureTotal = expenditureData.reduce((s, d) => s + d.value, 0);
  // Monthly indication: average across months from April onward (earlier data is partial).
  const AVG_FROM = "2026-04";
  const avgMonths = (spending?.monthly || []).filter(m => m.month >= AVG_FROM);
  const perMonth = avgMonths.length
    ? avgMonths.reduce((s, m) => s + m.amount, 0) / avgMonths.length
    : 0;
  const thisMonth = spending?.this_month ?? 0;

  return (
    <Panel title="Allocation">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div>
          <div className="text-[11px] tracking-wider text-jarvis-muted mb-2">BY INDUSTRY + CRYPTO</div>
          <PieChart data={industryData} center={$(industryTotal)} />
        </div>
        <div>
          <div className="text-[11px] tracking-wider text-jarvis-muted mb-2">INDIVIDUAL STOCKS</div>
          <PieChart data={stockData} center={$(stocksOnlyTotal)} />
        </div>
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-[11px] tracking-wider text-jarvis-muted">ALL EXPENDITURES</span>
            {expenditureData.length > 0 && (
              <span className="text-[15px] font-bold numeric text-jarvis-text">{$(perMonth)}<span className="text-[10px] text-jarvis-muted font-normal">/mo</span></span>
            )}
          </div>
          {expenditureData.length ? (
            <>
              <PieChart data={expenditureData} center={`${$(perMonth)}/mo`} />
              <div className="text-[10px] text-jarvis-muted mt-2">
                avg over {avgMonths.length} mo (from Apr) · this month {$(thisMonth)} · {$(expenditureTotal)} total
              </div>
            </>
          ) : <div className="text-xs text-jarvis-muted">No spending parsed yet — import statements or connect Gmail.</div>}
        </div>
      </div>
    </Panel>
  );
}

/* ---------------- Tax vault ---------------- */
const TAX_TYPE_LABEL: Record<string, string> = {
  w2: "W-2", "1099-b": "1099-B", "1099-int": "1099-INT", "1099-div": "1099-DIV",
  return: "Return", other: "Other",
};
const TAX_TYPE_COLOR: Record<string, string> = {
  w2: "#4ad6ff", "1099-b": "#b794ff", "1099-int": "#22e8a0", "1099-div": "#3ddc97",
  return: "#ffd24a", other: "#94a8c9",
};
const fmtBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

function TaxBlock() {
  const [docs, setDocs] = useState<TaxDocument[]>([]);
  const [serverYears, setServerYears] = useState<number[]>([]);
  const [types, setTypes] = useState<string[]>(Object.keys(TAX_TYPE_LABEL));
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    const r = await tax.list();
    setDocs(r.documents); setServerYears(r.years);
    if (r.doc_types?.length) setTypes(r.doc_types);
  }
  useEffect(() => { refresh().catch(() => {}); }, []);

  // Always offer this year + last year, plus any year that has docs.
  const thisYear = new Date().getFullYear();
  const years = Array.from(new Set([thisYear, thisYear - 1, ...serverYears])).sort((a, b) => b - a);
  const shown = docs.filter(d => d.tax_year === year);

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true); setMsg(null);
    try {
      const r = await tax.upload(year, list);
      setMsg(`Added ${r.count} file(s) to ${year}`);
    } catch { setMsg("Upload failed"); }
    setBusy(false);
    refresh();
  }
  async function changeType(id: number, t: string) {
    await tax.setType(id, t); refresh();
  }
  async function remove(d: TaxDocument) {
    if (!window.confirm(`Delete "${d.filename}"? This permanently removes the file.`)) return;
    await tax.remove(d.id); refresh();
  }
  function addYear() {
    const v = window.prompt("Add a tax year (e.g. 2024):", String(thisYear - 1));
    const n = v && parseInt(v, 10);
    if (n && n > 1990 && n < 2100) setYear(n);
  }

  return (
    <Panel title="Tax documents — local vault">
      <div className="text-xs text-jarvis-muted mb-3">
        Upload W-2s, 1099s and prior returns. Files are stored only on this machine (never uploaded anywhere, never sent to the LLM) and organized by tax year.
      </div>

      {/* year tabs */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {years.map(y => (
          <button key={y} onClick={() => setYear(y)}
            className={`px-3 py-1 rounded text-[13px] font-medium transition ${
              y === year ? "bg-jarvis-accent/20 text-jarvis-accent border border-jarvis-accent/60"
                         : "bg-jarvis-border/20 text-jarvis-dim hover:text-jarvis-text border border-transparent"}`}>
            {y}{docs.some(d => d.tax_year === y) ? ` · ${docs.filter(d => d.tax_year === y).length}` : ""}
          </button>
        ))}
        <button onClick={addYear} className="px-2 py-1 rounded text-[13px] text-jarvis-muted hover:text-jarvis-accent">+ year</button>
      </div>

      {/* document list for the selected year */}
      <div className="space-y-1.5">
        {shown.length === 0
          ? <div className="text-[12px] text-jarvis-muted">No documents for {year} yet — drop files below.</div>
          : shown.map(d => (
            <div key={d.id} className="flex items-center gap-3 rounded px-3 py-2 bg-jarvis-border/20">
              <span className="pill shrink-0" style={{ borderColor: TAX_TYPE_COLOR[d.doc_type] || "#94a8c9", color: TAX_TYPE_COLOR[d.doc_type] || "#94a8c9" }}>
                {TAX_TYPE_LABEL[d.doc_type] || d.doc_type}
              </span>
              <a className="text-[13px] text-jarvis-text hover:text-jarvis-accent truncate min-w-0 flex-1"
                href={tax.fileUrl(d.id)} target="_blank" rel="noreferrer" title="open">{d.filename}</a>
              <span className="text-[11px] text-jarvis-muted shrink-0 numeric">{fmtBytes(d.size_bytes)}</span>
              <select className="input !py-0.5 !px-1 text-[11px] shrink-0" value={d.doc_type}
                onChange={e => changeType(d.id, e.target.value)} title="document type">
                {types.map(t => <option key={t} value={t}>{TAX_TYPE_LABEL[t] || t}</option>)}
              </select>
              <a className="text-[11px] text-jarvis-accent shrink-0" href={tax.fileUrl(d.id, true)}>download</a>
              <button className="text-[11px] text-jarvis-bad hover:underline shrink-0" onClick={() => remove(d)}>delete</button>
            </div>
          ))}
      </div>

      {/* drop zone */}
      <label
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files); }}
        className={`mt-3 block text-center text-[14px] font-semibold rounded border border-dashed py-4 cursor-pointer transition ${
          drag ? "border-jarvis-accent bg-jarvis-accent/10 text-jarvis-accent"
               : "border-jarvis-border text-jarvis-text hover:border-jarvis-accent/60"}`}>
        {busy ? "uploading…" : (msg || `⬇ Drop tax files for ${year} — or click to choose`)}
        <input type="file" multiple className="hidden" disabled={busy}
          onChange={e => { if (e.target.files?.length) uploadFiles(e.target.files); e.currentTarget.value = ""; }} />
      </label>
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

/* ---------------- Statement reminders ---------------- */
// Each issuer's site (main domain → prominent "Log In"; avoids brittle deep links).
const BANK_LOGIN: Record<string, string> = {
  "amex": "https://www.americanexpress.com",
  "american express": "https://www.americanexpress.com",
  "apple card": "https://card.apple.com",
  "apple": "https://card.apple.com",
  "chase": "https://www.chase.com",
  "discover": "https://www.discover.com",
  "robinhood": "https://robinhood.com",
  "bilt": "https://www.biltrewards.com",
};
function loginUrl(issuer: string | null): string {
  const k = (issuer || "").toLowerCase().trim();
  for (const key of Object.keys(BANK_LOGIN)) if (k.includes(key)) return BANK_LOGIN[key];
  return `https://www.google.com/search?q=${encodeURIComponent((issuer || "") + " card login")}`;
}

function CardsGrid({ items, reminders, onChange }: { items: CardSpending[]; reminders: StatementReminder[]; onChange: () => void }) {
  const remBy = useMemo(() => {
    const m: Record<number, StatementReminder> = {};
    reminders.forEach(r => { if (r.liability_id != null) m[r.liability_id] = r; });
    return m;
  }, [reminders]);
  if (items.length === 0) return null;
  return (
    <Panel title="Cards & statements">
      <div className="text-xs text-jarvis-muted mb-3">
        Each card: balance (click to edit), recent transactions by month, and a drop zone — drop a statement (CSV / Excel / PDF) to load its transactions &amp; balance.
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map(c => <CardBox key={c.liability_id} card={c} rem={remBy[c.liability_id]} onChange={onChange} />)}
      </div>
    </Panel>
  );
}

function CardBox({ card, rem, onChange }: { card: CardSpending; rem?: StatementReminder; onChange: () => void }) {
  // group this card's transactions into statements (by month)
  const statements = useMemo(() => {
    const m: Record<string, { key: string; count: number; total: number; txns: typeof card.transactions }> = {};
    for (const t of card.transactions) {
      const key = t.date ? t.date.slice(0, 7) : "undated";
      const g = m[key] || (m[key] = { key, count: 0, total: 0, txns: [] });
      g.count++; g.total += t.amount; g.txns.push(t);
    }
    return Object.values(m).sort((a, b) => b.key.localeCompare(a.key));
  }, [card]);

  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [bal, setBal] = useState("");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function saveBal() {
    const v = parseFloat(bal);
    if (!isNaN(v)) await api.patch(`/api/finance/liabilities/${card.liability_id}`, { balance: v });
    setEditing(false); onChange();
  }
  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true); setMsg(null);
    let added = 0, ok = 0; let lastBal: number | null = null;
    for (const file of list) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("liability_id", String(card.liability_id));
        const res = await fetch("/api/gmail/import-spending", { method: "POST", body: fd });
        const r = await res.json();
        if (r.available) { added += r.transactions_added || 0; ok++; if (r.balance_updated) lastBal = r.balance; }
      } catch { /* skip this file, keep going */ }
    }
    setMsg(`+${added} txns from ${ok}/${list.length} file(s)${lastBal != null ? ` · $${lastBal}` : ""}`);
    setBusy(false);
    onChange();
  }
  async function deleteStatement(month: string) {
    if (!window.confirm("Delete this statement's transactions? Your balance won't change.")) return;
    await api.post("/api/gmail/delete-statement", { liability_id: card.liability_id, month });
    setOpen(null); onChange();
  }

  const monthLabel = (k: string) => k === "undated" ? "Undated"
    : new Date(k + "-01T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const dueTxt = rem?.due_date
    ? new Date(rem.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : (card.due_day_of_month ? `day ${card.due_day_of_month}` : null);
  const badge = card.source === "email" ? { t: "auto", c: "#22e8a0" }
    : rem?.needs_update ? { t: "new stmt", c: "#ff9c2a" } : { t: "manual", c: "#94a8c9" };
  const openStmt = statements.find(s => s.key === open);

  return (
    <>
      <div className="panel flex flex-col" style={{ minHeight: 280 }}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files); }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-jarvis-text truncate">{card.name}</div>
            <div className="text-[10px] text-jarvis-muted">{dueTxt ? `due ${dueTxt}` : "no due date"}</div>
          </div>
          <span className="pill shrink-0" style={{ borderColor: badge.c, color: badge.c }}>{badge.t}</span>
        </div>

        <div className="mt-1 mb-2 flex items-center gap-2">
          {editing ? (
            <>
              <input className="input w-24" inputMode="decimal" placeholder={$(card.balance)} value={bal}
                onChange={e => setBal(e.target.value)} onKeyDown={e => e.key === "Enter" && saveBal()} autoFocus />
              <button className="btn" onClick={saveBal}>OK</button>
            </>
          ) : (
            <button className="text-lg font-bold numeric text-jarvis-text hover:text-jarvis-accent"
              title="click to edit balance" onClick={() => { setBal(""); setEditing(true); }}>{$(card.balance)}</button>
          )}
          <a className="ml-auto text-[10px] text-jarvis-accent shrink-0" href={loginUrl(card.name)} target="_blank" rel="noreferrer">log in ↗</a>
        </div>

        <div className="text-[10px] tracking-wider text-jarvis-muted mb-1">STATEMENTS</div>
        <div className="flex-1 overflow-auto space-y-1 min-h-0 pr-1">
          {statements.length === 0
            ? <div className="text-[11px] text-jarvis-muted">None yet — drop one below.</div>
            : statements.map(s => (
              <button key={s.key} onClick={() => setOpen(s.key)}
                className="w-full flex items-center justify-between rounded px-2 py-1.5 bg-jarvis-border/20 hover:bg-jarvis-accent/10 text-left">
                <span className="text-[12px] text-jarvis-text">{monthLabel(s.key)}</span>
                <span className="text-[12px] text-jarvis-text numeric">{s.count} txns · {$(s.total)} ›</span>
              </button>
            ))}
        </div>

        <label className={`mt-2 block text-center text-[13px] font-medium rounded border border-dashed py-2.5 cursor-pointer transition ${drag ? "border-jarvis-accent bg-jarvis-accent/10 text-jarvis-accent" : "border-jarvis-border text-jarvis-text hover:border-jarvis-accent/60"}`}>
          {busy ? "parsing…" : (msg || "⬇ drop statements / click — CSV · Excel · PDF")}
          <input type="file" accept=".csv,.xlsx,.xlsm,.xls,.pdf" multiple className="hidden" disabled={busy}
            onChange={e => { if (e.target.files?.length) uploadFiles(e.target.files); e.currentTarget.value = ""; }} />
        </label>
      </div>

      {openStmt && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setOpen(null)}>
          <div className="panel w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-bold text-jarvis-text">{card.name}</div>
                <div className="text-[11px] text-jarvis-muted">{monthLabel(openStmt.key)} · {openStmt.count} transactions · {$(openStmt.total)}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button className="btn btn-ghost" style={{ color: "#ff5c6c", borderColor: "#ff5c6c55" }}
                  onClick={() => deleteStatement(openStmt.key)}>🗑 delete</button>
                <button className="btn btn-ghost" onClick={() => setOpen(null)}>✕ close</button>
              </div>
            </div>
            <div className="flex-1 overflow-auto text-[12px] min-h-0 pr-1">
              {openStmt.txns.map((t, i) => (
                <div key={i} className="flex items-center gap-2 py-1 border-b border-jarvis-border/30 last:border-0">
                  <span className="text-[10px] text-jarvis-muted w-12 shrink-0">{t.date ? new Date(t.date).toLocaleDateString(undefined, { month: "numeric", day: "numeric" }) : ""}</span>
                  <span className="truncate flex-1 text-jarvis-text">{t.merchant}</span>
                  <span className="text-[10px] text-jarvis-muted shrink-0">{t.category}</span>
                  <span className="numeric text-jarvis-text shrink-0 w-16 text-right">{$(t.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------------- Debts from email ---------------- */
function CardStatementsBlock({ items, onChange }: { items: EmailCardStatement[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.post<{ available: boolean; reason?: string; extracted?: number; liabilities_updated?: number }>(
        "/api/gmail/extract-finances", {});
      if (r.available) { setMsg(`Parsed ${r.extracted} email(s) · ${r.liabilities_updated} liabilit(ies) updated`); onChange(); }
      else setMsg(r.reason ?? "Gmail not connected.");
    } finally { setBusy(false); }
  }

  const KIND_COLOR: Record<string, string> = { statement: "#ff9c2a", payment: "#22e8a0", other: "#6b7c9a" };
  const link = (id: string) => `https://mail.google.com/mail/u/0/#all/${id}`;

  return (
    <Panel title="Debts from email" right={
      <button className="btn btn-ghost" disabled={busy} onClick={sync}>{busy ? "…" : "SYNC FROM EMAIL"}</button>
    }>
      <div className="text-xs text-jarvis-muted mb-2">
        Balances & due dates parsed from your statement emails. Statement balances feed the Liabilities above (source: email).
      </div>
      {msg && <div className="text-xs text-jarvis-dim mb-2">{msg}</div>}
      {items.length === 0
        ? <div className="text-sm text-jarvis-muted">Nothing parsed yet — hit SYNC FROM EMAIL (Gmail must be connected).</div>
        : <div className="space-y-1">
            {items.map(s => (
              <a key={s.id} href={link(s.message_id)} target="_blank" rel="noreferrer"
                className="flex items-center gap-3 py-1.5 border-b border-jarvis-border/40 last:border-0 hover:bg-jarvis-accent/5 rounded px-1">
                <span className="pill shrink-0" style={{ borderColor: KIND_COLOR[s.kind], color: KIND_COLOR[s.kind] }}>{s.kind}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-jarvis-text truncate">
                    {s.issuer || "Unknown"}{s.last4 ? ` ••${s.last4}` : ""}
                  </div>
                  <div className="text-[11px] text-jarvis-muted truncate">{s.subject}</div>
                </div>
                <div className="shrink-0 text-right">
                  {s.balance != null && <div className="text-[13px] numeric text-jarvis-text">{$(s.balance)}</div>}
                  <div className="text-[10px] text-jarvis-muted">
                    {s.minimum_payment != null ? `min ${$(s.minimum_payment)}` : ""}
                    {s.due_date ? ` · due ${new Date(s.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
                  </div>
                </div>
              </a>
            ))}
          </div>}
    </Panel>
  );
}
