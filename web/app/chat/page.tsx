"use client";
import { useEffect, useRef, useState } from "react";
import { api, ChatReply } from "@/lib/api";

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<"anthropic" | "openai" | "">("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: input }];
    setMessages(next); setInput(""); setBusy(true);
    try {
      const reply = await api.post<ChatReply>("/api/chat", {
        messages: next,
        provider: provider || undefined,
      });
      setMessages([...next, { role: "assistant", content: reply.reply }]);
    } catch (err: any) {
      setMessages([...next, { role: "assistant", content: `Error: ${err.message}` }]);
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Chat with Jarvis</h1>
        <select className="input w-44" value={provider} onChange={e => setProvider(e.target.value as any)}>
          <option value="">Default provider</option>
          <option value="anthropic">Anthropic Claude</option>
          <option value="openai">OpenAI</option>
        </select>
      </div>

      <div className="card min-h-[400px] max-h-[60vh] overflow-y-auto space-y-3">
        {messages.length === 0 && (
          <div className="text-sm text-jarvis-muted">
            Try: “Plan my next 2 hours.” or “What should I focus on this week?”
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`text-sm ${m.role === "user" ? "text-right" : ""}`}>
            <div className={`inline-block px-3 py-2 rounded-2xl max-w-[80%] whitespace-pre-wrap
              ${m.role === "user" ? "bg-jarvis-accent text-jarvis-bg" : "bg-white/5"}`}>
              {m.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="flex gap-2">
        <input className="input flex-1" placeholder="Ask Jarvis…" value={input} onChange={e=>setInput(e.target.value)} />
        <button className="btn" disabled={busy}>{busy ? "…" : "Send"}</button>
      </form>
    </div>
  );
}
