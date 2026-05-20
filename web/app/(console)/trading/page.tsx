"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Panel } from "@/components/Panel";

export default function TradingPage() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.get("/api/trading/signals").then(setData).catch(console.error); }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Trading Desk</h1>
      <Panel title="Signals" demo={data?.placeholder}>
        {!data ? <div className="text-jarvis-muted text-sm">Loading…</div> : (
          <table className="w-full text-sm">
            <thead className="text-jarvis-muted text-xs uppercase tracking-wider">
              <tr><th className="text-left py-2">Ticker</th><th className="text-left">Side</th><th className="text-left">Score</th><th className="text-left">Note</th></tr>
            </thead>
            <tbody>
              {data.signals.map((s: any) => (
                <tr key={s.ticker} className="border-t border-jarvis-border">
                  <td className="py-2 font-mono">{s.ticker}</td>
                  <td className="capitalize">{s.side}</td>
                  <td className="font-mono">{s.score.toFixed(2)}</td>
                  <td className="text-jarvis-muted">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="Roadmap">
        <p className="text-sm text-jarvis-muted">
          Strategy backtesting, paper trading, broker integration, and the Trading Agent
          live here. Placeholder signals come from <code className="text-jarvis-accent">/api/trading/signals</code>.
        </p>
      </Panel>
    </div>
  );
}
