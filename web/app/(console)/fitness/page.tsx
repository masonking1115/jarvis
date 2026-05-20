"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Panel } from "@/components/Panel";
import { Ring } from "@/components/Ring";
import { StatusPill } from "@/components/StatusPill";

type GarminStatus = { configured: boolean; authenticated: boolean; reason?: string };

export default function FitnessPage() {
  const [data, setData] = useState<any>(null);
  const [garmin, setGarmin] = useState<GarminStatus | null>(null);

  useEffect(() => {
    api.get("/api/fitness/today").then(setData).catch(console.error);
    api.get<GarminStatus>("/api/garmin/status").then(setGarmin).catch(() => setGarmin({ configured: false, authenticated: false }));
  }, []);

  const live = data && data.placeholder === false;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Fitness</h1>
        {garmin && (
          <StatusPill
            status={garmin.authenticated ? "online" : garmin.configured ? "warn" : "offline"}
            label={garmin.authenticated ? "GARMIN LINKED" : garmin.configured ? "GARMIN AUTH" : "GARMIN OFFLINE"}
          />
        )}
      </div>

      <Panel title="Today" demo={!live} right={<span className="font-ui tracking-widest text-jarvis-amber">{live ? "GARMIN" : "DEMO"}</span>}>
        {!data ? <div className="text-jarvis-muted text-sm">Loading…</div> : (
          <div className="flex justify-around">
            {data.rings.map((r: any) => (
              <Ring key={r.name} value={r.value} max={r.goal} color={r.color} size={120} stroke={10}
                label={`${r.value}`} sub={`${r.name.toUpperCase()} · ${r.unit}`} />
            ))}
          </div>
        )}
      </Panel>

      {!garmin?.authenticated && (
        <Panel title="Connect Garmin">
          <ol className="text-sm text-jarvis-dim space-y-2 list-decimal pl-5">
            <li>Open <code className="text-jarvis-accent">backend/.env</code> and set <code className="text-jarvis-accent">GARMIN_EMAIL</code> and <code className="text-jarvis-accent">GARMIN_PASSWORD</code>.</li>
            <li>From the project root, run once:<br />
              <code className="block mt-1 p-2 rounded bg-jarvis-bg2 border border-jarvis-border text-jarvis-accent">.\.venv\Scripts\python.exe -m backend.scripts.garmin_login</code>
            </li>
            <li>If your account has 2FA, you'll be prompted in the terminal for the code. Token cache is saved to <code className="text-jarvis-accent">data/garmin_token/</code> — your password is not needed again.</li>
            <li>Restart the backend. This page will switch from DEMO to GARMIN automatically.</li>
          </ol>
          {garmin?.reason && (
            <div className="mt-3 text-[12px] text-jarvis-muted">
              Reason: <span className="text-jarvis-warn">{garmin.reason}</span>
            </div>
          )}
        </Panel>
      )}

      <Panel title="What gets pulled from Garmin">
        <ul className="text-sm text-jarvis-muted list-disc pl-5 space-y-1">
          <li><span className="text-jarvis-text">/api/garmin/today</span> — steps, active minutes, floors, distance, HR</li>
          <li><span className="text-jarvis-text">/api/garmin/sleep</span> — sleep stages, duration, score</li>
          <li><span className="text-jarvis-text">/api/garmin/readiness</span> — training readiness</li>
          <li><span className="text-jarvis-text">/api/garmin/vo2</span> — VO2 max</li>
          <li><span className="text-jarvis-text">/api/garmin/body_battery</span> — Body Battery time-series</li>
          <li><span className="text-jarvis-text">/api/garmin/activities</span> — recent activities</li>
        </ul>
      </Panel>
    </div>
  );
}
