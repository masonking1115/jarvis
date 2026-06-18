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
  source?: string;
  external_id?: string | null;
};

export type EmailCardStatement = {
  id: number;
  message_id: string;
  issuer: string | null;
  last4: string | null;
  account_type: string;
  kind: string;            // statement | payment | other
  balance: number | null;
  minimum_payment: number | null;
  due_date: string | null;
  apr: number | null;
  subject: string | null;
  received_at: string | null;
};

export type StatementReminder = {
  issuer: string | null;
  last4: string | null;
  due_date: string | null;
  statement_received_at: string | null;
  balance_in_email: number | null;
  emails_balance: boolean;
  message_id: string;
  liability_id: number | null;
  liability_name: string | null;
  current_balance: number | null;
  needs_update: boolean;
};

export type CardTxn = { date: string | null; merchant: string | null; amount: number; category: string };
export type CardSpending = {
  liability_id: number;
  name: string;
  balance: number;
  source: string;
  due_day_of_month: number | null;
  transactions: CardTxn[];
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

export type GmailStatus = {
  configured: boolean;
  connected: boolean;
  reason?: string;
  email?: string;
  messages_total?: number;
  threads_total?: number;
};
export type GmailSyncResult = {
  available: boolean;
  reason?: string;
  screened_new?: number;
  skipped_existing?: number;
  inbox_seen?: number;
};
export type EmailScreening = {
  id: number;
  message_id: string;
  thread_id: string | null;
  sender: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string | null;
  category: string;       // Needs reply | Important | Financial | Newsletter | Other
  importance: number;     // 0-100
  summary: string | null;
  action: string | null;
};
export type PriorityRule = { id: number; kind: string; value: string; weight: number };
export type SpendingSummary = {
  days: number;
  total: number;
  this_month: number;
  subscriptions_monthly: number;
  count: number;
  by_category: { category: string; amount: number; count: number }[];
  top_merchants: { merchant: string; amount: number; count: number }[];
  monthly: { month: string; amount: number }[];
  subscriptions: { merchant: string; amount: number }[];
  recent: { merchant: string | null; amount: number; category: string; is_subscription: boolean; occurred_at: string; message_id: string; subject: string | null }[];
};
export type EmailSource = {
  email: string;
  name: string;
  count: number;
  category: string;
  importance: number;
  latest_message_id: string;
  latest_at: string | null;
};
export type SuppressedSender = { email: string; reason: string; has_filter: boolean; created_at: string | null };
export type EmailBrief = {
  day: string;
  summary: string;
  stats: { total?: number; needs_reply?: number; financial?: number; by_category?: Record<string, number> };
  created_at: string | null;
};
export type RobinhoodSyncResult = {
  available: boolean;
  reason?: string;
  assets_synced?: number;
  transactions_synced?: number;
  portfolio_value?: number;
};

// ---- Tax vault (local-only document storage) ----
export type TaxDocument = {
  id: number;
  tax_year: number;
  filename: string;
  doc_type: string;        // w2 | 1099-b | 1099-int | 1099-div | return | other
  size_bytes: number;
  content_type: string | null;
  uploaded_at: string | null;
};
export type TaxList = { documents: TaxDocument[]; years: number[]; doc_types: string[] };

export const tax = {
  list:   ()                              => api.get<TaxList>("/api/tax"),
  setType:(id: number, doc_type: string)  => api.patch<TaxDocument>(`/api/tax/${id}`, { doc_type }),
  remove: (id: number)                    => api.del<{ ok: boolean }>(`/api/tax/${id}`),
  expand: (id: number)                    => api.post<{ ok: boolean; expanded: TaxDocument[]; count: number }>(`/api/tax/${id}/expand`, {}),
  fileUrl:(id: number, download = false)  => `/api/tax/file/${id}${download ? "?download=true" : ""}`,
  async upload(year: number, files: File[]): Promise<{ ok: boolean; saved: TaxDocument[]; count: number }> {
    const fd = new FormData();
    fd.append("year", String(year));
    for (const f of files) fd.append("files", f);
    const res = await fetch("/api/tax/upload", { method: "POST", body: fd });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  },
};

// ---- Profile (what JARVIS knows about me) ----
export type UserFact = {
  id: number;
  category: string;        // preference | goal | routine | relationship | context | dislike | other
  content: string;
  source: string;          // explicit | inferred
  confidence: number;
  status: string;          // active | archived
  pinned: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export const profile = {
  list:   ()                                  => api.get<{ facts: UserFact[]; count: number }>("/api/profile"),
  add:    (category: string, content: string) => api.post<UserFact>("/api/profile", { category, content }),
  update: (id: number, patch: Partial<Pick<UserFact, "category" | "content" | "confidence" | "pinned" | "status">>) =>
            api.patch<UserFact>(`/api/profile/${id}`, patch),
  remove: (id: number)                        => api.del<{ ok: boolean }>(`/api/profile/${id}`),
};

// ---- Skills (extensible capability registry) ----
export type Skill = {
  name: string;
  kind: string;            // instruction | action
  when_to_use: string;
  actions: string[];
  enabled: boolean;
};

export const skills = {
  list:   ()                              => api.get<{ skills: Skill[]; count: number }>("/api/skills"),
  toggle: (name: string, enabled: boolean) =>
            api.patch<{ name: string; enabled: boolean }>(`/api/skills/${name}`, { enabled }),
};

// ---- Flyover (photoreal address view) ----
export type FlyoverConfig = {
  available: boolean;
  reason?: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  units: string;
  google_maps_key: string;
  has_weather: boolean;
};
export type FlyoverWeather = {
  available: boolean;
  reason?: string;
  main?: string;          // Clear | Clouds | Rain | Drizzle | Snow | Thunderstorm | Mist | Fog | Haze
  description?: string;
  temp?: number | null;
  clouds_pct?: number;
  wind_mps?: number;
  raw_id?: number | null;
  is_day?: boolean;
  dt?: number | null;        // current unix time at the location (UTC)
  sunrise?: number | null;   // unix (UTC)
  sunset?: number | null;    // unix (UTC)
};

// ---- Agent (action layer) ----
export type AgentPlan =
  | { kind: "reply"; text: string }
  | { kind: "action"; tool: string; args: Record<string, any>; ack: string }
  | { kind: "escalate"; reason: string }
  | { kind: "skill"; name: string };
export const agent = {
  plan: (messages: { role: string; content: string }[], tier?: string) =>
    api.post<AgentPlan>("/api/agent/plan", { messages, tier }),
  run: (tool: string, args: Record<string, any>) =>
    api.post<{ text: string }>("/api/agent/run", { tool, args }),
  deep: (messages: { role: string; content: string }[]) =>
    api.post<{ job_id: string }>("/api/agent/deep", { messages }),
  deepStatus: (jobId: string) =>
    api.get<{ status: "running" | "done" | "error"; text: string }>(`/api/agent/deep/${jobId}`),
};

// ---- Voice ----
export type VoiceConfig = { available: boolean; voice: string; reason?: string };
export const voice = {
  config: () => api.get<VoiceConfig>("/api/voice/config"),
  // returns an object URL for the mp3, or null if TTS is unavailable
  async tts(text: string): Promise<string | null> {
    const res = await fetch("/api/voice/tts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    if ((res.headers.get("content-type") || "").includes("application/json")) return null; // degraded
    return URL.createObjectURL(await res.blob());
  },
};

export const flyover = {
  config:  ()                 => api.get<FlyoverConfig>("/api/flyover/config"),
  weather: (lat?: number, lng?: number) =>
    api.get<FlyoverWeather>(
      lat != null && lng != null ? `/api/flyover/weather?lat=${lat}&lng=${lng}` : "/api/flyover/weather"),
  reverse: (lat: number, lng: number) =>
    api.get<{ address: string | null }>(`/api/flyover/reverse?lat=${lat}&lng=${lng}`),
  setLocation: (address: string) =>
    api.post<{ ok: boolean; reason?: string; address?: string; lat?: number; lng?: number }>(
      "/api/flyover/location", { address }),
};
