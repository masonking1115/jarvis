"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Panel } from "@/components/Panel";
import { StatusPill } from "@/components/StatusPill";

type ImportStatus = {
  inbox_dir: string;
  interval_min: number;
  last_status: string;
  last_sync_at: string | null;
  last_error: string | null;
  items_synced: number;
  activity_count: number;
};
type Activity = {
  id: number; filename: string | null; sport: string | null; start_time: string | null;
  duration_s: number | null; distance_m: number | null;
  avg_hr: number | null; calories: number | null;
};
type ImportResult = { status: string; filename?: string; reason?: string };

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

export default function FitnessPage() {
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [acts, setActs] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => {
    api.get<ImportStatus>("/api/fitness/import/status").then(setStatus).catch(() => setStatus(null));
    api.get<{ activities: Activity[] }>("/api/fitness/activities?limit=25")
      .then((d) => setActs(d.activities)).catch(() => setActs([]));
  };

  useEffect(() => { refresh(); }, []);

  const uploadFiles = async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    setBusy(true); setNote(null);
    try {
      const fd = new FormData();
      list.forEach((f) => fd.append("files", f));
      const res = await fetch("/api/fitness/import", { method: "POST", body: fd, cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data: { results: ImportResult[] } = await res.json();
      const imported = data.results.filter((r) => r.status === "imported").length;
      const dup = data.results.filter((r) => r.status === "duplicate").length;
      const err = data.results.filter((r) => r.status === "error").length;
      setNote(`Imported ${imported}, ${dup} duplicate, ${err} failed.`);
      refresh();
    } catch (e: any) {
      setNote(`Upload failed: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const scanNow = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await api.post<{ status: string; imported: number; duplicate: number; error: number }>(
        "/api/fitness/import/scan", {});
      setNote(`Scan: imported ${r.imported}, ${r.duplicate} duplicate, ${r.error} failed.`);
      refresh();
    } catch (e: any) {
      setNote(`Scan failed: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const linked = (status?.activity_count ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Fitness</h1>
        {status && (
          <StatusPill
            status={linked ? "online" : "warn"}
            label={linked ? `${status.activity_count} ACTIVITIES` : "NO DATA YET"}
          />
        )}
        <div className="ml-auto flex items-center gap-3 text-xs text-jarvis-muted">
          <span>
            scanned {ago(status?.last_sync_at ?? null)}{status ? ` · every ${status.interval_min}m` : ""}
          </span>
          <button
            onClick={scanNow} disabled={busy}
            className="px-3 py-1 rounded border border-jarvis-border bg-jarvis-bg2 text-jarvis-accent disabled:opacity-50">
            {busy ? "Working…" : "Scan now"}
          </button>
        </div>
      </div>

      <Panel title="Import .FIT files">
        <div
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); uploadFiles(e.dataTransfer.files); }}
          className="cursor-pointer rounded-lg border-2 border-dashed border-jarvis-border hover:border-jarvis-accent p-6 text-center text-sm text-jarvis-muted">
          <div className="text-jarvis-text">Drop .FIT or .zip files here, or click to choose</div>
          <div className="mt-1 text-[12px]">Exported from Garmin Connect (“Export Original”) — no login needed</div>
          <input
            ref={fileInput} type="file" multiple accept=".fit,.zip" className="hidden"
            onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />
        </div>
        {note && <div className="mt-3 text-[12px] text-jarvis-dim">{note}</div>}
      </Panel>

      <Panel title="Recent activities" right={<span className="text-xs text-jarvis-muted">{acts.length} shown</span>}>
        {acts.length === 0 ? (
          <div className="text-jarvis-muted text-sm">No activities imported yet.</div>
        ) : (
          <ul className="divide-y divide-jarvis-border">
            {acts.map((a) => (
              <li key={a.id} className="py-2 flex items-center gap-4 text-sm">
                <span className="w-24 text-jarvis-accent capitalize">{a.sport ?? "activity"}</span>
                <span className="w-32 text-jarvis-muted">{a.start_time ? new Date(a.start_time).toLocaleDateString() : "—"}</span>
                <span className="w-24">{a.distance_m != null ? `${(a.distance_m / 1609.344).toFixed(2)} mi` : "—"}</span>
                <span className="w-24">{a.duration_s != null ? `${Math.round(a.duration_s / 60)} min` : "—"}</span>
                <span className="w-20">{a.avg_hr != null ? `${a.avg_hr} bpm` : "—"}</span>
                <span className="w-20 text-jarvis-muted">{a.calories != null ? `${a.calories} cal` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="How automatic import works">
        <ul className="text-sm text-jarvis-muted list-disc pl-5 space-y-1.5">
          <li><span className="text-jarvis-text">Plug in your watch (USB):</span> most Garmin watches mount as a drive; JARVIS auto-imports new activities from its <code className="text-jarvis-accent">GARMIN\ACTIVITY</code> folder on each scan — no login, no cloud.</li>
          <li><span className="text-jarvis-text">Drop into the inbox folder:</span> anything placed in <code className="text-jarvis-accent break-all">{status?.inbox_dir ?? "backend/data/fit_inbox"}</code> is imported automatically (then moved to <code className="text-jarvis-accent">processed/</code>).</li>
          <li><span className="text-jarvis-text">Upload above:</span> drag in files exported from Garmin Connect in your browser.</li>
          <li>Scans run automatically every {status?.interval_min ?? 10} minutes; duplicates are skipped by file content.</li>
        </ul>
        {status?.last_error && (
          <div className="mt-3 text-[12px] text-jarvis-muted">Last error: <span className="text-jarvis-warn">{status.last_error}</span></div>
        )}
      </Panel>
    </div>
  );
}
