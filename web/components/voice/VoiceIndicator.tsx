"use client";
import { useVoice } from "./VoiceProvider";

// Caption that floats just above the ambient orb during a conversation.
// The orb itself (AmbientOrb) is the visual; this is just the transcript/status.
export function VoiceIndicator() {
  const { enabled, state, lastHeard, lastSpoken } = useVoice();
  if (!enabled) return null;
  const caption =
    state === "speaking" ? lastSpoken :
    state === "capturing" ? (lastHeard || "Listening…") :
    state === "thinking" ? "Thinking…" : "";
  if (!caption) return null;
  return (
    <div className="pointer-events-none fixed bottom-[268px] left-1/2 -translate-x-1/2 z-[6] w-[90vw] max-w-md px-4">
      <div className="panel !py-2 !px-4 text-[13px] text-jarvis-dim text-center">{caption}</div>
    </div>
  );
}
