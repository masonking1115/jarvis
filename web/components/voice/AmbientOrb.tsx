"use client";
import { useEffect, useRef } from "react";
import { JarvisOrb } from "@/components/JarvisOrb";
import { useVoice } from "./VoiceProvider";
import { useChatLauncher } from "@/components/chat/ChatLauncher";

const ORB = 230;                 // px — keep in sync with the w-/h- class below

// The persistent JARVIS sphere on every console tab. It glides to bottom-center
// during a conversation and back to bottom-right when idle, and its size/glow
// pulse with the live audio level (your voice, and JARVIS's while speaking).
export function AmbientOrb() {
  const { state, levelRef } = useVoice();
  const { setOpen } = useChatLauncher();
  const scaleRef = useRef<HTMLDivElement | null>(null);
  const active = state === "capturing" || state === "thinking" || state === "speaking";

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const lvl = levelRef.current || 0;
      const el = scaleRef.current;
      if (el) {
        el.style.transform = `scale(${1 + lvl * 0.35})`;
        el.style.filter = `drop-shadow(0 0 ${8 + lvl * 40}px rgba(74,214,255,${0.25 + lvl * 0.5}))`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levelRef]);

  return (
    // The fixed wrapper IS the click target — one solid circular button the exact
    // size of the orb. Everything inside is purely visual (pointer-events-none), so
    // nothing can shadow the center. rounded-full keeps the corners click-through.
    <button
      type="button"
      aria-label="Open chat with Jarvis"
      onClick={() => setOpen(true)}
      className="fixed bottom-5 z-[30] cursor-pointer rounded-full border-0 bg-transparent p-0 [&_*]:pointer-events-none"
      style={{
        width: ORB, height: ORB,
        left: active ? "50%" : `calc(100% - ${ORB / 2 + 20}px)`,
        transform: "translateX(-50%)",
        opacity: active ? 0.95 : 0.5,
        transition: "left 700ms cubic-bezier(.4,0,.2,1), opacity 500ms ease",
      }}
    >
      <div ref={scaleRef} className="pointer-events-none"
           style={{ transition: "transform 80ms linear", willChange: "transform" }}>
        <JarvisOrb className="block w-[230px] h-[230px]" />
      </div>
    </button>
  );
}
