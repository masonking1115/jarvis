"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { ChatPanel } from "./ChatPanel";

const Ctx = createContext<{ open: boolean; setOpen: (v: boolean) => void }>({ open: false, setOpen: () => {} });
export const useChatLauncher = () => useContext(Ctx);

export function ChatLauncherProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
}

export function ChatOverlay() {
  const { open, setOpen } = useChatLauncher();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!open) { setShown(false); return; }
    const id = requestAnimationFrame(() => setShown(true));
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(id); window.removeEventListener("keydown", onKey); };
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[40] flex items-center justify-center p-4" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-[#040810]/50 backdrop-blur-md"
           style={{ opacity: shown ? 1 : 0, transition: "opacity 200ms ease" }} />
      <div
        onClick={e => e.stopPropagation()}
        className="relative w-[min(94vw,760px)] h-[min(82vh,720px)] rounded-2xl border border-[#4ad6ff]/30 bg-[#070d1a]/70 backdrop-blur-2xl shadow-[0_0_80px_rgba(74,214,255,0.18)] overflow-hidden"
        style={{ transform: shown ? "scale(1)" : "scale(0.92)", opacity: shown ? 1 : 0, transformOrigin: "bottom right", transition: "transform 220ms cubic-bezier(.2,.8,.2,1), opacity 200ms ease" }}
      >
        <ChatPanel onClose={() => setOpen(false)} />
      </div>
    </div>
  );
}
