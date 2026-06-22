"use client";
import { useEffect, useState } from "react";
import { api, projectsApi, Project } from "@/lib/api";
import { Panel } from "@/components/Panel";
import { StatusPill } from "@/components/StatusPill";
import { useChatLauncher } from "@/components/chat/ChatLauncher";

const STATUSES = ["active", "paused", "done"];

export default function ProjectsPage() {
  const [items, setItems] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [notionUrl, setNotionUrl] = useState("");
  const [msg, setMsg] = useState("");
  const { openProject } = useChatLauncher();

  async function refresh() {
    setItems(await api.get<Project[]>("/api/projects"));
  }
  useEffect(() => { refresh().catch(console.error); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.post<Project>("/api/projects", { name, notion_url: notionUrl || null });
    setName(""); setNotionUrl("");
    refresh();
  }

  async function patch(id: number, body: Partial<Project>) {
    await api.patch<Project>(`/api/projects/${id}`, body);
    refresh();
  }

  async function remove(p: Project) {
    if (!confirm(`Delete "${p.name}"?`)) return;
    await api.del(`/api/projects/${p.id}`);
    refresh();
  }

  async function attachRepo(id: number, repo_path: string) {
    try {
      await projectsApi.setRepoPath(id, repo_path);
      setMsg(""); refresh();
    } catch {
      setMsg("That path isn't an existing folder on this machine.");
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Projects</h1>

      <Panel title="New Project">
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <input className="input flex-1 min-w-[200px]" placeholder="Project name…"
                 value={name} onChange={e=>setName(e.target.value)} />
          <input className="input flex-1 min-w-[260px]" placeholder="https://www.notion.so/… (optional)"
                 value={notionUrl} onChange={e=>setNotionUrl(e.target.value)} />
          <button className="btn">ADD</button>
        </form>
      </Panel>

      <Panel title="All Projects">
        {items.length === 0 && <div className="text-sm text-jarvis-muted">No projects.</div>}
        {msg && <div className="text-sm text-jarvis-bad mb-2">{msg}</div>}
        <ul className="divide-y divide-jarvis-border/70">
          {items.map(p => (
            <li key={p.id} className="py-3 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  className="input flex-1 min-w-[180px] !py-1.5"
                  value={p.name}
                  onChange={e => patch(p.id, { name: e.target.value })}
                />

                <select
                  className="input w-28 !py-1.5"
                  value={p.status}
                  onChange={e => patch(p.id, { status: e.target.value })}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>

                <div className="flex items-center gap-2 w-44">
                  <input
                    type="range" min={0} max={100}
                    value={Math.round(p.progress * 100)}
                    onChange={e => patch(p.id, { progress: Number(e.target.value) / 100 })}
                    className="flex-1"
                  />
                  <span className="numeric text-xs text-jarvis-muted w-8 text-right">
                    {Math.round(p.progress * 100)}%
                  </span>
                </div>

                <input
                  className="input flex-1 min-w-[260px] !py-1.5"
                  placeholder="Notion URL…"
                  defaultValue={p.notion_url ?? ""}
                  onBlur={e => {
                    const v = e.target.value.trim();
                    if ((p.notion_url ?? "") !== v) patch(p.id, { notion_url: v || null });
                  }}
                />

                {p.notion_url ? (
                  <a href={p.notion_url} target="_blank" rel="noreferrer" className="cta-link">
                    OPEN →
                  </a>
                ) : (
                  <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-jarvis-muted">unlinked</span>
                )}

                <StatusPill status={p.status === "active" ? "active" : p.status === "paused" ? "warn" : "ready"} />

                <button onClick={() => remove(p)}
                        className="text-xs text-jarvis-muted hover:text-jarvis-bad font-ui tracking-wider">
                  DELETE
                </button>
              </div>

              {/* repo path + build-in-chat */}
              <div className="flex flex-wrap items-center gap-3">
                <input
                  className="input flex-1 min-w-[260px] !py-1.5 font-mono text-xs"
                  placeholder="Repo path (e.g. C:\Users\…\my-project) — attach to build here"
                  defaultValue={p.repo_path ?? ""}
                  onBlur={e => {
                    const v = e.target.value.trim();
                    if ((p.repo_path ?? "") !== v) attachRepo(p.id, v);
                  }}
                />
                <button onClick={() => openProject(p.id)}
                        className="btn-ghost !py-1.5 text-xs whitespace-nowrap"
                        title="Open the chat scoped to this project">
                  BUILD IN CHAT →
                </button>
              </div>

              {/* manager status rollup (from auto-compaction / builds) */}
              {(p.status_summary || p.last_active_at) && (
                <div className="text-[12px] text-jarvis-dim leading-snug">
                  {p.last_active_at && (
                    <span className="text-jarvis-muted">
                      last active {new Date(p.last_active_at).toLocaleDateString()}
                      {p.status_summary ? " · " : ""}
                    </span>
                  )}
                  {p.status_summary
                    ? p.status_summary
                    : <span className="italic text-jarvis-muted">no status yet — build in chat to generate one</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="How projects build">
        <p className="text-sm text-jarvis-dim">
          Attach a <span className="text-jarvis-accent">repo path</span> to a project, then hit{" "}
          <span className="text-jarvis-accent">Build in chat</span> (or open the chat and pick the
          project). JARVIS works in that folder with the full agent toolset and keeps a running
          Notion doc log — it creates the page on first run and appends a dated progress entry each
          turn. Ask the main JARVIS “what’s happening across my projects?” for a rollup; long build
          threads auto-summarize as they grow.
        </p>
      </Panel>
    </div>
  );
}
