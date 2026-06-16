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
      <Flyover open={open} />
    </Ctx.Provider>
  );
}
