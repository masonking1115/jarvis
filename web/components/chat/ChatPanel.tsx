"use client";
import { useEffect, useRef, useState } from "react";
import { chat, ChatTurn } from "@/lib/api";
import type { ChatEvent } from "@/lib/sseParse";

type Todo = { content: string; status: string };
const TIERS = ["fast", "smart", "agent"] as const;
const SLASH = [
  { cmd: "/model", help: "switch brain: /model fast|smart|agent" },
  { cmd: "/compact", help: "summarize the conversation to save context" },
  { cmd: "/brainstorm", help: "guided design Q&A (one question at a time)" },
  { cmd: "/help", help: "show commands" },
];
const todoIcon = (s: string) => (s === "completed" ? "✓" : s === "in_progress" ? "◐" : "○");

export function ChatPanel({ onClose }: { onClose?: () => void }) {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [tier, setTier] = useState("fast");
  const [mode, setMode] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [todos, setTodos] = useState<Todo[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chat.thread().then(t => { setMessages(t.messages); setTier(t.tier); setMode(t.mode); }); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streaming, todos]);

  const showSlash = input.startsWith("/") && !input.includes(" ");

  async function runSlash(raw: string): Promise<boolean> {
    const [cmd, arg] = raw.trim().split(/\s+/, 2);
    if (cmd === "/help") { setNote(SLASH.map(s => `${s.cmd} — ${s.help}`).join("\n")); return true; }
    if (cmd === "/model") {
      if (!TIERS.includes(arg as any)) { setNote(`Current brain: ${tier}. Use /model fast|smart|agent.`); return true; }
      await chat.setTier(arg); setTier(arg); setNote(`Brain set to ${arg}.`); return true;
    }
    if (cmd === "/compact") { setNote("Compacting…"); const { summary } = await chat.compact(); setMessages([]); setNote(`Context compacted: ${summary}`); return true; }
    if (cmd === "/brainstorm") { await chat.setMode("brainstorm"); setMode("brainstorm"); setNote("Brainstorm mode on — I'll ask one question at a time. Type /exit to leave."); return true; }
    if (cmd === "/exit") { await chat.setMode(""); setMode(""); setNote("Brainstorm mode off."); return true; }
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
    setBusy(true); setStreaming(""); setTodos([]); setTools([]);
    let acc = "";
    const onEvent = (ev: ChatEvent) => {
      if (ev.type === "text") { acc += ev.text; setStreaming(acc); }
      else if (ev.type === "todos") setTodos(ev.todos);
      else if (ev.type === "tool") setTools(t => [...t, ev.summary]);
      else if (ev.type === "error") { acc += ev.text; setStreaming(acc); }
    };
    try {
      await chat.stream(text, tier, onEvent);
      setMessages(m => [...m, { role: "assistant", content: acc, tier }]);
    } catch (err: any) {
      setMessages(m => [...m, { role: "assistant", content: `Error: ${err.message}`, tier }]);
    } finally { setBusy(false); setStreaming(""); setTodos([]); setTools([]); }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#4ad6ff]/15">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#4ad6ff] shadow-[0_0_10px_#4ad6ff]" />
          <span className="font-semibold tracking-wide">JARVIS</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {mode === "brainstorm" && <span className="px-2 py-1 rounded-full bg-white/10">brainstorm</span>}
          <span className="px-2 py-1 rounded-full bg-[#4ad6ff]/15 text-[#9fe6ff] uppercase tracking-wide">{tier}</span>
          {onClose && <button onClick={onClose} className="ml-1 text-jarvis-muted hover:text-white text-lg leading-none">×</button>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !streaming && (
          <div className="text-sm text-jarvis-muted">
            How can I help, sir? Type <span className="text-[#4ad6ff]">/</span> for commands, or <span className="text-[#4ad6ff]">/model agent</span> to let me work autonomously.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`text-sm ${m.role === "user" ? "text-right" : ""}`}>
            <div className={`inline-block px-3 py-2 rounded-2xl max-w-[85%] whitespace-pre-wrap ${m.role === "user" ? "bg-[#4ad6ff]/20 text-white" : "bg-white/5"}`}>{m.content}</div>
          </div>
        ))}
        {(streaming || todos.length > 0 || tools.length > 0) && (
          <div className="text-sm space-y-2">
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
          <input className="flex-1 rounded-xl bg-white/5 border border-[#4ad6ff]/20 px-3 py-2 outline-none focus:border-[#4ad6ff]/50 placeholder:text-jarvis-muted" placeholder="Ask Jarvis…  (/ for commands)" value={input} onChange={e => setInput(e.target.value)} autoFocus />
          <button className="btn" disabled={busy}>{busy ? "…" : "Send"}</button>
        </form>
      </div>
    </div>
  );
}
