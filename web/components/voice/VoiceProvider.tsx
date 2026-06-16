"use client";
import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { api, voice as voiceApi } from "@/lib/api";
import { createRecognizer, extractCommand, speechSupported, Recognizer } from "@/lib/voice";

type State = "disabled" | "idle" | "capturing" | "thinking" | "speaking";
type Msg = { role: "user" | "assistant"; content: string };

const Ctx = createContext<{
  enabled: boolean; setEnabled: (v: boolean) => void;
  state: State; lastHeard: string; lastSpoken: string; supported: boolean;
}>({ enabled: false, setEnabled: () => {}, state: "disabled", lastHeard: "", lastSpoken: "", supported: false });

export const useVoice = () => useContext(Ctx);

export function VoiceProvider({ children }: { children: ReactNode }) {
  const supported = typeof window !== "undefined" && speechSupported();
  const [enabled, setEnabledState] = useState(false);
  const [state, setState] = useState<State>("disabled");
  const [lastHeard, setLastHeard] = useState("");
  const [lastSpoken, setLastSpoken] = useState("");

  const recRef = useRef<Recognizer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stateRef = useRef<State>("disabled");
  const enabledRef = useRef(false);
  const msgsRef = useRef<Msg[]>([]);
  const set = (s: State) => { stateRef.current = s; setState(s); };

  function stopAudio() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
  }

  function setEnabled(v: boolean) {
    enabledRef.current = v; setEnabledState(v);
    if (typeof window !== "undefined") localStorage.setItem("jarvisVoice", v ? "1" : "0");
    if (v) { set("idle"); recRef.current?.start(); }
    else { set("disabled"); recRef.current?.stop(); stopAudio(); }
  }

  async function handle(text: string) {
    if (!text) { set("idle"); return; }
    setLastHeard(text);
    set("thinking");
    msgsRef.current = [...msgsRef.current, { role: "user" as const, content: text }].slice(-8);
    let reply = "";
    try {
      const r = await api.post<{ reply: string }>("/api/chat", { messages: msgsRef.current, voice: true });
      reply = r.reply;
    } catch { reply = "Sorry, I couldn't reach the server."; }
    msgsRef.current = [...msgsRef.current, { role: "assistant" as const, content: reply }].slice(-8);
    setLastSpoken(reply);
    await speak(reply);
  }

  async function speak(text: string) {
    set("speaking");
    const url = await voiceApi.tts(text).catch(() => null);
    if (!url) { set("idle"); return; }                 // no Azure key → caption only
    const a = new Audio(url); audioRef.current = a;
    a.onended = () => { stopAudio(); set("idle"); };
    a.onerror = () => { stopAudio(); set("idle"); };
    a.play().catch(() => { stopAudio(); set("idle"); });
  }

  function onFinal(text: string) {
    if (!enabledRef.current) return;
    const s = stateRef.current;
    if (s === "speaking") {                            // barge-in: wake word stops playback
      const cmd = extractCommand(text);
      if (cmd !== null) { stopAudio(); if (cmd) handle(cmd); else set("capturing"); }
      return;
    }
    if (s === "capturing") { handle(text); return; }
    if (s === "idle") {
      const cmd = extractCommand(text);
      if (cmd === null) return;                        // no wake word — ignore ambient speech
      if (cmd) handle(cmd); else set("capturing");
    }
  }

  // Build recognizer once; auto-restart on end while enabled.
  useEffect(() => {
    if (!supported) return;
    recRef.current = createRecognizer({
      onFinal,
      onError: (e) => { if (e === "not-allowed" || e === "service-not-allowed") setEnabled(false); },
      onEnd: () => { if (enabledRef.current) setTimeout(() => recRef.current?.start(), 250); },
    });
    if (typeof window !== "undefined" && localStorage.getItem("jarvisVoice") === "1") setEnabled(true);
    return () => recRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  return (
    <Ctx.Provider value={{ enabled, setEnabled, state, lastHeard, lastSpoken, supported }}>
      {children}
    </Ctx.Provider>
  );
}
