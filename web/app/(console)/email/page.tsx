"use client";
import { useEffect, useState } from "react";
import { api, GmailStatus, GmailSyncResult, EmailScreening, PriorityRule, EmailSource, SuppressedSender, EmailBrief } from "@/lib/api";
import { Panel } from "@/components/Panel";

const CAT_ORDER = ["Needs reply", "Important", "Financial", "Newsletter", "Other"];
const CAT_COLOR: Record<string, string> = {
  "Needs reply": "#ff5c6c",
  Important: "#ffd24a",
  Financial: "#22e8a0",
  Newsletter: "#b794ff",
  Other: "#6b7c9a",
};

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

export default function EmailPage() {
  const [digest, setDigest] = useState<EmailScreening[]>([]);
  const [sources, setSources] = useState<EmailSource[]>([]);
  const [suppressed, setSuppressed] = useState<SuppressedSender[]>([]);

  async function refresh() {
    try { setDigest(await api.get<EmailScreening[]>("/api/gmail/digest?limit=100")); }
    catch { setDigest([]); }
    try { setSources(await api.get<EmailSource[]>("/api/gmail/sources")); }
    catch { setSources([]); }
    try { setSuppressed(await api.get<SuppressedSender[]>("/api/gmail/suppressed")); }
    catch { setSuppressed([]); }
  }
  useEffect(() => { refresh().catch(console.error); }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Email — Inbox Screening</h1>
      <GmailBlock onSynced={refresh} />
      <DailyBriefBlock />
      <SourcesBlock items={sources} onChange={refresh} />
      <SuppressedBlock items={suppressed} onChange={refresh} />
      <PriorityRulesBlock />
      <DigestBlock items={digest} />
    </div>
  );
}

/* ---------------- daily brief ---------------- */
function DailyBriefBlock() {
  const [brief, setBrief] = useState<EmailBrief | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setBrief(await api.get<EmailBrief>("/api/gmail/brief")); }
    catch { setBrief(null); }
  }
  useEffect(() => { load(); }, []);

  async function regen() {
    setBusy(true);
    try { setBrief(await api.post<EmailBrief>("/api/gmail/brief/refresh", {})); }
    finally { setBusy(false); }
  }

  const st = brief?.stats || {};
  return (
    <Panel title="Daily brief" right={
      <button className="btn btn-ghost" disabled={busy} onClick={regen}>{busy ? "…" : "REFRESH"}</button>
    }>
      {!brief ? <div className="text-sm text-jarvis-muted">No brief yet — connect Gmail and screen some mail.</div>
        : <>
            <div className="flex flex-wrap gap-2 mb-3 text-[11px]">
              <span className="pill" style={{ borderColor: "#4ad6ff", color: "#4ad6ff" }}>{st.total ?? 0} total</span>
              <span className="pill" style={{ borderColor: "#ff5c6c", color: "#ff5c6c" }}>{st.needs_reply ?? 0} need reply</span>
              <span className="pill" style={{ borderColor: "#22e8a0", color: "#22e8a0" }}>{st.financial ?? 0} financial</span>
            </div>
            <div className="text-[13px] text-jarvis-text whitespace-pre-line leading-relaxed">{brief.summary}</div>
            {brief.created_at && (
              <div className="text-[10px] text-jarvis-muted mt-2">
                generated {new Date(brief.created_at).toLocaleString()}
              </div>
            )}
          </>}
    </Panel>
  );
}

/* ---------------- suppressed (undo) ---------------- */
function SuppressedBlock({ items, onChange }: { items: SuppressedSender[]; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (items.length === 0) return null;

  async function restore(email: string) {
    setBusy(email);
    try { await api.post("/api/gmail/unsuppress", { sender: email }); onChange(); }
    finally { setBusy(null); }
  }

  return (
    <Panel title={`Unsubscribed / blocked · ${items.length}`}>
      <div className="text-xs text-jarvis-muted mb-2">
        Hidden from screening. <b>Restore</b> brings them back (and removes the Gmail block filter for blocked senders).
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map(s => (
          <span key={s.email} className="pill" style={{ borderColor: s.reason === "blocked" ? "#ff5c6c" : "#b794ff", color: "#cfe0ff" }}>
            <span className="dot shrink-0" style={{ background: s.reason === "blocked" ? "#ff5c6c" : "#b794ff", width: 6, height: 6 }} />
            {s.email} · {s.reason}
            <button className="ml-2 text-jarvis-muted hover:text-jarvis-text" disabled={busy === s.email}
              onClick={() => restore(s.email)}>{busy === s.email ? "…" : "↶ restore"}</button>
          </span>
        ))}
      </div>
    </Panel>
  );
}

/* ---------------- sources (unsubscribe / block) ---------------- */
function SourcesBlock({ items, onChange }: { items: EmailSource[]; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  async function unsubscribe(email: string) {
    setBusy(email + ":unsub");
    try {
      const r = await api.post<any>("/api/gmail/unsubscribe", { sender: email });
      if (!r.available) setMsg(m => ({ ...m, [email]: r.reason ?? "unavailable" }));
      else if (r.status === "manual" && r.url) { window.open(r.url, "_blank"); setMsg(m => ({ ...m, [email]: "opened link — removed" })); onChange(); }
      else if (r.status === "done" || r.status === "sent") { setMsg(m => ({ ...m, [email]: "unsubscribed ✓" })); onChange(); }
      else setMsg(m => ({ ...m, [email]: r.reason ?? r.status ?? "no unsubscribe — try Block" }));
    } finally { setBusy(null); }
  }

  async function block(email: string) {
    setBusy(email + ":block");
    try {
      const r = await api.post<any>("/api/gmail/block", { sender: email });
      if (!r.available) setMsg(m => ({ ...m, [email]: r.reason ?? "failed" }));
      else { setMsg(m => ({ ...m, [email]: `blocked ✓ — trashed ${r.trashed_existing}` })); onChange(); }
    } finally { setBusy(null); }
  }

  return (
    <Panel title={`Sources · ${items.length}`}>
      <div className="text-xs text-jarvis-muted mb-2">
        Per-sender cleanup. <b>Unsubscribe</b> uses the sender&apos;s opt-out; <b>Block</b> filters future mail to trash and clears existing. Block is safer for spam.
      </div>
      {items.length === 0
        ? <div className="text-xs text-jarvis-muted">No sources yet — screen some mail first.</div>
        : <div className="space-y-1">
            {items.map(s => (
              <div key={s.email} className="flex items-center gap-3 py-1.5 border-b border-jarvis-border/40 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-jarvis-text truncate">{s.name || s.email}</div>
                  <div className="text-[11px] text-jarvis-muted truncate">{s.email} · {s.count} msg · {s.category}</div>
                </div>
                {msg[s.email] && <span className="text-[11px] text-jarvis-dim shrink-0">{msg[s.email]}</span>}
                <button className="btn btn-ghost shrink-0" disabled={busy?.startsWith(s.email)} onClick={() => unsubscribe(s.email)}>
                  {busy === s.email + ":unsub" ? "…" : "UNSUB"}
                </button>
                <button className="btn shrink-0" disabled={busy?.startsWith(s.email)} onClick={() => block(s.email)}>
                  {busy === s.email + ":block" ? "…" : "BLOCK"}
                </button>
              </div>
            ))}
          </div>}
    </Panel>
  );
}

/* ---------------- connection ---------------- */
function GmailBlock({ onSynced }: { onSynced: () => void }) {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadStatus() {
    try { setStatus(await api.get<GmailStatus>("/api/gmail/status")); }
    catch { setStatus(null); }
  }
  useEffect(() => { loadStatus(); }, []);

  async function connect() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.post<{ available: boolean; redirect_url?: string; reason?: string }>("/api/gmail/connect", {});
      if (r.available && r.redirect_url) {
        window.open(r.redirect_url, "_blank");
        setMsg("Finish the Google sign-in in the new tab — this panel will update automatically.");
        pollUntilConnected();
      } else {
        setMsg(r.reason ?? "Could not start connection.");
      }
    } finally { setBusy(false); }
  }

  function pollUntilConnected() {
    let tries = 0;
    const iv = setInterval(async () => {
      tries += 1;
      try {
        const s = await api.get<GmailStatus>("/api/gmail/status");
        setStatus(s);
        if (s.connected) { clearInterval(iv); setMsg("Connected — screening…"); syncNow(); return; }
      } catch { /* keep polling */ }
      if (tries >= 80) { clearInterval(iv); }  // ~4 min
    }, 3000);
  }

  async function syncNow() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.post<GmailSyncResult>("/api/gmail/sync", {});
      if (r.available) {
        setMsg(`Screened ${r.screened_new} new · ${r.inbox_seen} scanned`);
        onSynced();
      } else {
        setMsg(r.reason ?? "Screening unavailable.");
      }
    } finally { setBusy(false); loadStatus(); }
  }

  async function disconnect() {
    setBusy(true); setMsg(null);
    try { await api.post("/api/gmail/disconnect", {}); setMsg("Disconnected."); }
    finally { setBusy(false); loadStatus(); }
  }

  const connected = status?.connected;
  const pill = !status?.configured
    ? { t: "NOT CONFIGURED", c: "#6b7c9a" }
    : connected
      ? { t: "CONNECTED", c: "#22e8a0" }
      : { t: "NOT CONNECTED", c: "#ff9c2a" };

  return (
    <Panel title="Gmail">
      <div className="flex flex-wrap items-center gap-3">
        <span className="pill" style={{ borderColor: pill.c, color: pill.c }}>
          <span className="dot" style={{ background: pill.c, width: 7, height: 7 }} /> {pill.t}
        </span>
        {connected && status?.email && (
          <span className="text-xs text-jarvis-muted">{status.email}
            {status.messages_total != null && ` · ${status.messages_total.toLocaleString()} msgs`}
          </span>
        )}
        {!connected && (
          <button className="btn" disabled={busy || !status?.configured} onClick={connect}>
            CONNECT GMAIL
          </button>
        )}
        <button className="btn" disabled={busy || !connected} onClick={syncNow}>SCREEN NOW</button>
        {connected && <button className="btn" disabled={busy} onClick={disconnect}>DISCONNECT</button>}
        {msg && <span className="text-xs text-jarvis-muted">{msg}</span>}
      </div>
      {!status?.configured && (
        <div className="text-xs text-jarvis-muted mt-2">
          Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to backend/.env, then restart the backend.
        </div>
      )}
      {connected && (
        <div className="text-xs text-jarvis-muted mt-2">
          Screening runs automatically in the background. Use SCREEN NOW to triage immediately.
        </div>
      )}
    </Panel>
  );
}

/* ---------------- priority rules ---------------- */
function PriorityRulesBlock() {
  const [rules, setRules] = useState<PriorityRule[]>([]);
  const [kind, setKind] = useState("sender");
  const [value, setValue] = useState("");
  const [weight, setWeight] = useState(25);

  async function load() {
    try { setRules(await api.get<PriorityRule[]>("/api/gmail/rules")); }
    catch { setRules([]); }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!value.trim()) return;
    await api.post("/api/gmail/rules", { kind, value: value.trim(), weight });
    setValue(""); load();
  }
  async function remove(id: number) { await api.del(`/api/gmail/rules/${id}`); load(); }

  return (
    <Panel title="Priority rules">
      <div className="text-xs text-jarvis-muted mb-2">
        Bump importance when a VIP sender or keyword matches. Applied to every screening cycle.
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select className="input" value={kind} onChange={e => setKind(e.target.value)}>
          <option value="sender">sender contains</option>
          <option value="keyword">keyword</option>
        </select>
        <input className="input flex-1 min-w-[160px]" placeholder={kind === "sender" ? "boss@company.com" : "invoice"}
          value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} />
        <input className="input w-20" type="number" min={0} max={100} value={weight}
          onChange={e => setWeight(Number(e.target.value))} title="importance bump" />
        <button className="btn" onClick={add}>ADD</button>
      </div>
      {rules.length === 0
        ? <div className="text-xs text-jarvis-muted">No rules yet.</div>
        : <div className="flex flex-wrap gap-2">
            {rules.map(r => (
              <span key={r.id} className="pill" style={{ borderColor: "#2a3a55", color: "#cfe0ff" }}>
                {r.kind}:{r.value} +{r.weight}
                <button className="ml-2 text-jarvis-muted hover:text-jarvis-text" onClick={() => remove(r.id)}>✕</button>
              </span>
            ))}
          </div>}
    </Panel>
  );
}

/* ---------------- digest ---------------- */
function DigestBlock({ items }: { items: EmailScreening[] }) {
  if (items.length === 0) {
    return <Panel title="Screened mail"><div className="text-sm text-jarvis-muted">
      Nothing screened yet. Connect Gmail and hit SCREEN NOW.</div></Panel>;
  }
  const groups = CAT_ORDER
    .map(cat => ({ cat, rows: items.filter(i => i.category === cat).sort((a, b) => b.importance - a.importance) }))
    .filter(g => g.rows.length > 0);

  return (
    <div className="space-y-4">
      {groups.map(g => (
        <Panel key={g.cat} title={`${g.cat} · ${g.rows.length}`}>
          <div className="space-y-1.5">
            {g.rows.map(r => (
              <div key={r.id} className="flex items-start gap-3 py-1.5 border-b border-jarvis-border/40 last:border-0">
                <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: CAT_COLOR[g.cat] }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-medium text-jarvis-text truncate">{r.subject || "(no subject)"}</span>
                    <span className="text-[11px] text-jarvis-muted shrink-0 ml-auto">{when(r.received_at)}</span>
                  </div>
                  <div className="text-[11px] text-jarvis-muted truncate">{cleanSender(r.sender)}</div>
                  {r.summary && r.summary !== r.subject && (
                    <div className="text-[11px] text-jarvis-dim truncate mt-0.5">{r.summary}</div>
                  )}
                </div>
                <div className="shrink-0 w-16 text-right">
                  <div className="text-[11px] numeric" style={{ color: CAT_COLOR[g.cat] }}>{r.importance}</div>
                  <div className="h-1 rounded mt-0.5 bg-jarvis-border/50 overflow-hidden">
                    <div className="h-full rounded" style={{ width: `${r.importance}%`, background: CAT_COLOR[g.cat] }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}

function cleanSender(s: string | null): string {
  if (!s) return "";
  const m = s.match(/^\s*"?([^"<]+?)"?\s*<.*>\s*$/);
  return (m ? m[1] : s).trim();
}
