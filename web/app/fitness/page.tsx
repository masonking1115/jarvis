"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Panel } from "@/components/Panel";
import { Ring } from "@/components/Ring";

export default function FitnessPage() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.get("/api/fitness/today").then(setData).catch(console.error); }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Fitness</h1>
      <Panel title="Today" demo={data?.placeholder}>
        {!data ? <div className="text-jarvis-muted text-sm">Loading…</div> : (
          <div className="flex justify-around">
            {data.rings.map((r: any) => (
              <Ring key={r.name} value={r.value} max={r.goal} color={r.color} size={120} stroke={10}
                label={`${r.value}`} sub={`${r.name} · ${r.unit}`} />
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Integration Roadmap">
        <ul className="text-sm text-jarvis-muted list-disc pl-5 space-y-1">
          <li>Garmin Connect API — auto-import workouts, HR, VO2, sleep</li>
          <li>Strava — runs, rides, segments</li>
          <li>Peloton — class history</li>
          <li>Apple Health bridge — wellness rings</li>
        </ul>
      </Panel>
    </div>
  );
}
