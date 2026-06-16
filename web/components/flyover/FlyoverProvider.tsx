"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Flyover } from "./Flyover";

const Ctx = createContext<{ open: boolean; toggle: () => void; setOpen: (v: boolean) => void }>({
  open: false, toggle: () => {}, setOpen: () => {},
});
export const useFlyover = () => useContext(Ctx);

function isTypingTarget(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n) return false;
  const tag = n.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || n.isContentEditable;
}

export function FlyoverProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  // Auto-open when arriving from the intro (router.push("/dashboard?flyover=1")),
  // then strip the flag so it doesn't re-trigger on refresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("flyover") === "1") {
      setOpen(true);
      sp.delete("flyover");
      const qs = sp.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, []);

  // Let the voice agent open the flyover (VoiceProvider wraps this provider, so
  // it can't use the hook directly — a window event bridges them).
  useEffect(() => {
    const open = () => setOpen(true);
    window.addEventListener("jarvis:flyover", open);
    return () => window.removeEventListener("jarvis:flyover", open);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Don't hijack Esc while typing or when a modal is open (modals handle Esc themselves).
      if (!open && isTypingTarget(document.activeElement)) return;
      if (!open && document.querySelector('[data-modal="true"]')) return;
      e.preventDefault();
      setOpen(o => !o);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <Ctx.Provider value={{ open, toggle: () => setOpen(o => !o), setOpen }}>
      {children}
      <Flyover open={open} onExit={() => setOpen(false)} />
    </Ctx.Provider>
  );
}
