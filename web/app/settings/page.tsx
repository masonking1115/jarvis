import { Panel } from "@/components/Panel";

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Panel title="LLM Provider">
        <p className="text-sm text-jarvis-muted">
          Configure in <code className="text-jarvis-accent">backend/.env</code>:
          set <code>LLM_PROVIDER=anthropic</code> or <code>openai</code>, and the matching
          API key. Restart the backend after changes.
        </p>
      </Panel>
      <Panel title="Database">
        <p className="text-sm text-jarvis-muted">
          SQLite at <code className="text-jarvis-accent">data/jarvis.db</code>. To use Postgres, change
          <code className="text-jarvis-accent"> DATABASE_URL</code> in <code>.env</code>.
        </p>
      </Panel>
    </div>
  );
}
