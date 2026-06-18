"use client";
import { ChatPanel } from "@/components/chat/ChatPanel";

export default function ChatPage() {
  return (
    <div className="mx-auto w-full max-w-3xl h-[calc(100vh-7rem)] rounded-2xl border border-[#4ad6ff]/20 bg-[#070d1a]/40 backdrop-blur-xl overflow-hidden">
      <ChatPanel />
    </div>
  );
}
