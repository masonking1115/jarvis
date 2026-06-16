"use client";
import { JarvisOrb } from "@/components/JarvisOrb";
import { useVoice } from "./VoiceProvider";

const CAPTION: Record<string, string> = {
  idle: "Listening for “Hey JARVIS”", capturing: "Listening…",
  thinking: "Thinking…", speaking: "", disabled: "",
};

export function VoiceIndicator() {
  const { enabled, state, lastHeard, lastSpoken } = useVoice();
  if (!enabled) return null;
  const caption =
    state === "speaking" ? lastSpoken :
    state === "capturing" && lastHeard ? lastHeard :
    CAPTION[state];
  const op = state === "idle" ? 0.5 : 1;
  return (
    <div className="fixed bottom-4 left-4 z-[80] flex items-center gap-3 pointer-events-none">
      <div className={state === "thinking" ? "ring-breathe" : ""} style={{ opacity: op }}>
        <JarvisOrb className="w-16 h-16" />
      </div>
      {caption && (
        <div className="panel !py-1.5 !px-3 max-w-xs text-[12px] text-jarvis-dim">{caption}</div>
      )}
    </div>
  );
}
