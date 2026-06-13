// Thin fetch wrapper. The Next.js dev server proxies /api/* to FastAPI on :8000.
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get:    <T>(p: string)             => req<T>(p),
  post:   <T>(p: string, body: any)  => req<T>(p, { method: "POST", body: JSON.stringify(body) }),
  patch:  <T>(p: string, body: any)  => req<T>(p, { method: "PATCH", body: JSON.stringify(body) }),
  del:    <T>(p: string)             => req<T>(p, { method: "DELETE" }),
};

export type Task = { id: number; title: string; notes: string|null; priority: number; done: boolean; due_at: string|null; created_at: string };
export type Goal = { id: number; title: string; category: string; notes: string|null; progress: number; target_date: string|null; created_at: string };
export type Event = {
  id: number;
  title: string;
  starts_at: string;
  ends_at: string | null;
  duration_min: number | null;
  category: string;          // workout | deep_work | meal | study | review | meeting | routine | personal | general
  completed: boolean;
  location: string | null;
  notes: string | null;
};
export type Workout = { id: number; kind: string; duration_min: number; distance_mi: number|null; notes: string|null; performed_at: string };
export type Txn = { id: number; amount: number; category: string; description: string|null; occurred_at: string; source: string; external_id: string|null };
export type Project = { id: number; name: string; status: string; progress: number; notion_url: string|null; notes: string|null; created_at: string };

export type IncomeSource = {
  id: number;
  name: string;
  amount: number;
  is_gross: boolean;
  frequency: string;
  next_pay_date: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
};

export type Asset = {
  id: number;
  name: string;
  category: string;
  value: number;
  ticker: string | null;
  shares: number | null;
  cost_basis: number | null;
  notes: string | null;
  last_updated: string;
  created_at: string;
  source: string;
  external_id: string | null;
};

export type Liability = {
  id: number;
  name: string;
  category: string;
  balance: number;
  apr: number | null;
  minimum_payment: number | null;
  due_day_of_month: number | null;
  notes: string | null;
  last_updated: string;
  created_at: string;
};

export type FinanceOverview = {
  net_worth: number;
  assets_total: number;
  liabilities_total: number;
  cash_total: number;
  investments_total: number;
  debt_minimum_payment_total: number;
  asset_breakdown: { category: string; value: number }[];
  liability_breakdown: { category: string; value: number }[];
  income: {
    monthly_gross: number;
    monthly_net: number;
    next_pay_date: string | null;
    next_pay_amount: number | null;
    days_to_next_pay: number | null;
  };
  monthly_expenses: number;
  monthly_savings_est: number;
  transaction_summary: FinanceSummary;
};
export type FinanceSummary = { income: number; expenses: number; net: number; count: number };
export type ChatReply = { reply: string; provider: string };
export type RobinhoodStatus = { configured: boolean; connected: boolean; reason?: string };
export type RobinhoodSyncResult = {
  available: boolean;
  reason?: string;
  assets_synced?: number;
  transactions_synced?: number;
  portfolio_value?: number;
};
