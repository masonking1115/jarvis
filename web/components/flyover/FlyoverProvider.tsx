"use client";
import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Flyover } from "./Flyover";
import { useChatLauncher } from "@/components/chat/ChatLauncher";
import { useVoice } from "@/components/voice/VoiceProvider";

const IDLE_FLYOVER_MS = 10 * 60 * 1000;   // 10 min of no activity -> open the flyover

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

  // --- Idle auto-flyover (screensaver-style): after IDLE_FLYOVER_MS with no
  // user activity, open the flyover. Suppressed while the flyover is already up,
  // a chat is open (the agent streams inside that overlay), a voice exchange is
  // active, or the tab is hidden. Any activity resets the timer.
  const { open: chatOpen } = useChatLauncher();
  const { state: voiceState } = useVoice();
  const openRef = useRef(open);
  const chatOpenRef = useRef(chatOpen);
  const voiceBusyRef = useRef(false);
  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);
  useEffect(() => {
    voiceBusyRef.current =
      voiceState === "capturing" || voiceState === "thinking" || voiceState === "speaking";
  }, [voiceState]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = () => {
      const busy = openRef.current || chatOpenRef.current || voiceBusyRef.current ||
        (typeof document !== "undefined" && document.hidden);
      if (busy) { arm(); return; }     // still engaged — re-check after another interval
      setOpen(true);
    };
    const arm = () => { if (timer) clearTimeout(timer); timer = setTimeout(fire, IDLE_FLYOVER_MS); };
    const onActivity = () => { if (!openRef.current) arm(); };   // don't reset once it's up
    const events: (keyof WindowEventMap)[] =
      ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "scroll"];
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onActivity);
    arm();
    return () => {
      if (timer) clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", onActivity);
    };
  }, [setOpen]);

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
      // Space exits the map view (only while open); Escape toggles it.
      if (e.key === " " && open && !isTypingTarget(document.activeElement)) {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Escape") return;
      // Don't hijack Esc while typing or when a modal is open (modals handle Esc themselves).
      if (!open && isTypingTarget(document.activeElement)) return;
      if (!open && document.querySelector('[data-modal="true"]')) return;
      // The fullscreen camera handles its own Esc — don't let it also open the flyover.
      if (!open && document.querySelector('[data-cam-fullscreen="true"]')) return;
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
