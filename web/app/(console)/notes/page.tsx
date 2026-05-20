import { Panel } from "@/components/Panel";

export default function NotesPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Notes</h1>
      <Panel title="Notes" demo>
        <p className="text-sm text-jarvis-muted">
          Knowledge base / scratchpad coming soon. Add a DB-backed notes table when needed;
          the placeholder endpoint is at <code className="text-jarvis-accent">/api/notes</code>.
        </p>
      </Panel>
    </div>
  );
}
