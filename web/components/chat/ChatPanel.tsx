"use client";
import { useEffect, useRef, useState } from "react";
import { chat, vision as visionApi, ChatTurn, projectsApi, Project, DiscoveredRepo } from "@/lib/api";
import type { ChatEvent } from "@/lib/sseParse";
import { useCamera } from "@/components/vision/CameraProvider";
import { renderMarkdown } from "@/lib/markdown";

type Todo = { content: string; status: string };
const TIERS = ["fast", "smart", "agent"] as const;
const SLASH = [
  { cmd: "/model", help: "switch brain: /model fast|smart|agent" },
  { cmd: "/compact", help: "summarize the conversation to save context" },
  { cmd: "/brainstorm", help: "guided design Q&A (one question at a time)" },
  { cmd: "/help", help: "show commands" },
];
const todoIcon = (s: string) => (s === "completed" ? "✓" : s === "in_progress" ? "◐" : "○");

// Friendly "what the agent is doing" label from a tool name.
function agentActivity(toolName: string): string {
  const n = (toolName || "").toLowerCase();
  if (n.includes("notion")) return "Reading & updating Notion…";
  if (n.includes("websearch") || n.includes("webfetch")) return "Searching the web…";
  if (n === "bash") return "Running a command…";
  if (n === "read" || n === "grep" || n === "glob") return "Reading the project…";
  if (n === "edit" || n === "write") return "Editing files…";
  if (n === "todowrite") return "Planning the work…";
  return `Using ${toolName}…`;
}

// ---- Add-project drawer ----
function AddProjectDrawer({
  projects,
  onClose,
  onBound,
}: {
  projects: Project[];
  onClose: () => void;
  onBound: (proj: Project) => void;
}) {
  const [repos, setRepos] = useState<DiscoveredRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | "">("");
  const [selectedPath, setSelectedPath] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setLoading(true);
    projectsApi.discover().then(r => { setRepos(r); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  async function bind() {
    const path = customPath.trim() || selectedPath;
    if (!selectedProjectId || !path) { setErr("Pick a project and a repo path."); return; }
    setSaving(true); setErr("");
    try {
      const updated = await projectsApi.setRepoPath(selectedProjectId as number, path);
      onBound(updated);
    } catch (e: any) {
      setErr(e.message || "Failed to set repo path.");
    } finally { setSaving(false); }
  }

  const unbound = projects.filter(p => !p.repo_path);

  return (
    <div className="border-t border-[#4ad6ff]/15 px-4 py-3 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-[#9fe6ff]">Attach repo to project</span>
        <button onClick={onClose} className="text-jarvis-muted hover:text-white text-lg leading-none">×</button>
      </div>

      <div className="space-y-2">
        <label className="block text-xs text-jarvis-muted">Project</label>
        <select
          value={selectedProjectId}
          onChange={e => setSelectedProjectId(e.target.value === "" ? "" : Number(e.target.value))}
          className="w-full rounded-lg bg-white/5 border border-[#4ad6ff]/20 px-3 py-1.5 outline-none focus:border-[#4ad6ff]/50 text-white"
        >
          <option value="">Select project…</option>
          {unbound.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
          {unbound.length === 0 && (
            <option value="" disabled>All projects already have a repo path</option>
          )}
        </select>
      </div>

      <div className="space-y-2">
        <label className="block text-xs text-jarvis-muted">
          {loading ? "Scanning for repos…" : `Discovered repos (${repos.length})`}
        </label>
        {repos.length > 0 && (
          <select
            value={selectedPath}
            onChange={e => { setSelectedPath(e.target.value); setCustomPath(""); }}
            className="w-full rounded-lg bg-white/5 border border-[#4ad6ff]/20 px-3 py-1.5 outline-none focus:border-[#4ad6ff]/50 text-white"
          >
            <option value="">Pick a discovered repo…</option>
            {repos.map(r => (
              <option key={r.path} value={r.path}>{r.name}</option>
            ))}
          </select>
        )}
        <input
          className="w-full rounded-lg bg-white/5 border border-[#4ad6ff]/20 px-3 py-1.5 outline-none focus:border-[#4ad6ff]/50 placeholder:text-jarvis-muted"
          placeholder="Or paste a path…"
          value={customPath}
          onChange={e => { setCustomPath(e.target.value); setSelectedPath(""); }}
        />
      </div>

      {err && <div className="text-xs text-red-400">{err}</div>}

      <button
        onClick={bind}
        disabled={saving || !selectedProjectId || (!selectedPath && !customPath.trim())}
        className="btn w-full disabled:opacity-40"
      >
        {saving ? "Saving…" : "Attach repo"}
      </button>
    </div>
  );
}

export function ChatPanel({ onClose }: { onClose?: () => void }) {
  const camera = useCamera();
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [tier, setTier] = useState("fast");
  const [mode, setMode] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [todos, setTodos] = useState<Todo[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [activity, setActivity] = useState("");   // live "what the agent is doing" status
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Project switcher state
  const [projectId, setProjectId] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showAddProject, setShowAddProject] = useState(false);

  function stop() { abortRef.current?.abort(); }

  // Load the project list on mount
  useEffect(() => {
    projectsApi.list().then(setProjects).catch(() => {});
  }, []);

  // Load the thread for the active project
  useEffect(() => {
    chat.thread(projectId).then(t => {
      setMessages(t.messages);
      setTier(t.tier);
      setMode(t.mode);
      setStreaming("");
      setTodos([]);
      setTools([]);
      setNote("");
    });
  }, [projectId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streaming, todos]);
  // Abort any in-flight stream when the chat unmounts (e.g. click-outside closes it).
  useEffect(() => () => abortRef.current?.abort(), []);
  // Spacebar: stop a streaming response; press again (when idle, not typing) to close the chat.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== " ") return;
      const t = e.target as HTMLElement | null;
      const typing = t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable;
      if (busy) { e.preventDefault(); stop(); return; }
      if (!typing) { e.preventDefault(); onClose?.(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const showSlash = input.startsWith("/") && !input.includes(" ");

  async function runSlash(raw: string): Promise<boolean> {
    const [cmd, arg] = raw.trim().split(/\s+/, 2);
    if (cmd === "/help") { setNote(SLASH.map(s => `${s.cmd} — ${s.help}`).join("\n")); return true; }
    if (cmd === "/model") {
      if (!TIERS.includes(arg as any)) { setNote(`Current brain: ${tier}. Use /model fast|smart|agent.`); return true; }
      await chat.setTier(arg, projectId); setTier(arg); setNote(`Brain set to ${arg}.`); return true;
    }
    if (cmd === "/compact") {
      setNote("Compacting…");
      const { summary } = await chat.compact(projectId);
      setMessages([]); setNote(`Context compacted: ${summary}`);
      return true;
    }
    if (cmd === "/brainstorm") { await chat.setMode("brainstorm", projectId); setMode("brainstorm"); setNote("Brainstorm mode on — I'll ask one question at a time. Type /exit to leave."); return true; }
    if (cmd === "/exit") { await chat.setMode("", projectId); setMode(""); setNote("Brainstorm mode off."); return true; }
    return false;
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    if (text.startsWith("/")) { if (await runSlash(text)) return; }
    setNote("");
    setMessages(m => [...m, { role: "user", content: text, tier: null }]);

    // Camera on → answer over a captured frame via Claude vision.
    if (camera.enabled) {
      setBusy(true);
      let frame: string | null = null;
      for (let i = 0; i < 12 && !frame; i++) { frame = camera.capture(); if (!frame) await new Promise(r => setTimeout(r, 200)); }
      try {
        const ans = frame
          ? (await visionApi.look(frame, text, true)).text   // remember=true → saved to the thread
          : (camera.error || "I can't see anything — the camera isn't ready.");
        setMessages(m => [...m, { role: "assistant", content: ans, tier: "vision" }]);
      } catch (err: any) {
        setMessages(m => [...m, { role: "assistant", content: `Error: ${err.message}`, tier: "vision" }]);
      } finally { setBusy(false); }
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true); setStreaming(""); setTodos([]); setTools([]); setActivity("Thinking…");
    let acc = "";
    const onEvent = (ev: ChatEvent) => {
      if (ev.type === "text") { acc += ev.text; setStreaming(acc); setActivity(""); }
      else if (ev.type === "todos") { setTodos(ev.todos); setActivity("Planning the work…"); }
      else if (ev.type === "tool") { setTools(t => [...t, ev.summary]); setActivity(agentActivity(ev.name)); }
      else if (ev.type === "error") { acc += ev.text; setStreaming(acc); setActivity(""); }
    };
    try {
      await chat.stream(text, tier, onEvent, controller.signal, projectId);
      setMessages(m => [...m, { role: "assistant", content: acc, tier }]);
    } catch (err: any) {
      // Aborted (spacebar / click-outside): keep whatever streamed so far.
      const stopped = err?.name === "AbortError";
      setMessages(m => [...m, { role: "assistant", content: stopped ? (acc || "(stopped)") : `Error: ${err.message}`, tier }]);
    } finally { abortRef.current = null; setBusy(false); setStreaming(""); setTodos([]); setTools([]); setActivity(""); }
  }

  const activeProject = projectId === 0 ? null : projects.find(p => p.id === projectId);
  const activeLabel = projectId === 0 ? "General" : (activeProject?.name ?? "…");

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#4ad6ff]/15">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#4ad6ff] shadow-[0_0_10px_#4ad6ff]" />
          <span className="font-semibold tracking-wide">JARVIS</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {/* Project switcher */}
          <div className="relative flex items-center">
            <select
              value={projectId}
              onChange={e => {
                const val = Number(e.target.value);
                if (val === -1) { setShowAddProject(v => !v); return; }
                setProjectId(val);
                setShowAddProject(false);
              }}
              className="rounded-full bg-[#4ad6ff]/10 border border-[#4ad6ff]/20 text-[#9fe6ff] px-2 py-1 pr-5 outline-none focus:border-[#4ad6ff]/50 appearance-none cursor-pointer"
              title="Switch project"
            >
              <option value={0}>General</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{!p.repo_path ? " (set path)" : ""}
                </option>
              ))}
              <option value={-1}>+ Add project</option>
            </select>
            {/* custom dropdown arrow */}
            <span className="pointer-events-none absolute right-1.5 text-[#4ad6ff]/60 text-[8px]">▾</span>
          </div>
          {mode === "brainstorm" && <span className="px-2 py-1 rounded-full bg-white/10">brainstorm</span>}
          <span className="px-2 py-1 rounded-full bg-[#4ad6ff]/15 text-[#9fe6ff] uppercase tracking-wide">{tier}</span>
          {onClose && <button onClick={onClose} className="ml-1 text-jarvis-muted hover:text-white text-lg leading-none">×</button>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !streaming && (
          <div className="text-sm text-jarvis-muted">
            {projectId === 0
              ? <>How can I help, sir? Type <span className="text-[#4ad6ff]">/</span> for commands, or <span className="text-[#4ad6ff]">/model agent</span> to let me work autonomously.</>
              : <>Working in <span className="text-[#4ad6ff]">{activeLabel}</span>{activeProject?.repo_path ? <> at <span className="text-[#4ad6ff]/70 font-mono text-xs">{activeProject.repo_path}</span></> : <> — <button onClick={() => setShowAddProject(true)} className="text-[#4ad6ff] underline underline-offset-2">set repo path</button></>}.</>
            }
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`text-sm ${m.role === "user" ? "text-right" : ""}`}>
            <div className={`inline-block px-3 py-2 rounded-2xl max-w-[85%] ${m.role === "user" ? "bg-[#4ad6ff]/20 text-white whitespace-pre-wrap" : "bg-white/5"}`}>
              {m.role === "user" ? m.content : renderMarkdown(m.content)}
            </div>
          </div>
        ))}
        {(streaming || todos.length > 0 || tools.length > 0 || (busy && activity)) && (
          <div className="text-sm space-y-2">
            {busy && activity && !streaming && (
              <div className="flex items-center gap-2 text-[12px] text-[#9fe6ff]">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#4ad6ff] animate-pulse" />
                {activity}
              </div>
            )}
            {todos.length > 0 && (
              <div className="rounded-xl border border-[#4ad6ff]/20 bg-white/5 p-3 space-y-1">
                <div className="text-xs uppercase tracking-wide text-jarvis-muted">Working</div>
                {todos.map((t, i) => (
                  <div key={i} className={t.status === "completed" ? "line-through text-jarvis-muted" : ""}>{todoIcon(t.status)} {t.content}</div>
                ))}
              </div>
            )}
            {tools.map((t, i) => (<div key={i} className="text-xs text-jarvis-muted">⛭ {t}</div>))}
            {streaming && (<div className="inline-block px-3 py-2 rounded-2xl max-w-[85%] whitespace-pre-wrap bg-white/5">{streaming}<span className="animate-pulse">▋</span></div>)}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {note && <div className="px-4 pb-2 text-xs text-jarvis-muted whitespace-pre-wrap">{note}</div>}

      {/* Add-project drawer */}
      {showAddProject && (
        <AddProjectDrawer
          projects={projects}
          onClose={() => setShowAddProject(false)}
          onBound={updated => {
            setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
            setShowAddProject(false);
          }}
        />
      )}

      <div className="relative px-3 pb-3">
        {showSlash && (
          <div className="absolute bottom-full mb-1 left-3 right-3 rounded-xl border border-[#4ad6ff]/20 bg-[#070d1a]/95 backdrop-blur-xl p-1 text-sm">
            {SLASH.filter(s => s.cmd.startsWith(input)).map(s => (
              <button key={s.cmd} type="button" onClick={() => setInput(s.cmd + " ")} className="block w-full text-left px-2 py-1 rounded hover:bg-white/10">
                <span className="text-[#4ad6ff]">{s.cmd}</span> <span className="text-jarvis-muted">— {s.help}</span>
              </button>
            ))}
          </div>
        )}
        <form onSubmit={send} className="flex gap-2">
          <button type="button" onClick={() => camera.setEnabled(!camera.enabled)}
            title={camera.error || (camera.enabled ? "Camera on — your message is answered over what Jarvis sees" : "Turn on the camera")}
            className={`px-3 rounded-xl border transition-colors ${camera.enabled
              ? "border-[#4ad6ff]/60 bg-[#4ad6ff]/15 text-[#9fe6ff]"
              : "border-[#4ad6ff]/20 bg-white/5 text-jarvis-muted hover:text-white"}`}>
            📷
          </button>
          <input className="flex-1 rounded-xl bg-white/5 border border-[#4ad6ff]/20 px-3 py-2 outline-none focus:border-[#4ad6ff]/50 placeholder:text-jarvis-muted"
            placeholder={camera.enabled ? "Ask about what Jarvis sees…" : "Ask Jarvis…  (/ for commands)"}
            value={input} onChange={e => setInput(e.target.value)} autoFocus />
          <button className="btn" disabled={busy}>{busy ? "…" : "Send"}</button>
        </form>
      </div>
    </div>
  );
}
