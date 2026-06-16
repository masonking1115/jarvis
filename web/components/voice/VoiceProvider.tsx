"use client";
import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { api, voice as voiceApi } from "@/lib/api";
import { createRecognizer, extractCommand, speechSupported, Recognizer } from "@/lib/voice";

type State = "disabled" | "idle" | "capturing" | "thinking" | "speaking";
type Msg = { role: "user" | "assistant"; content: string };

type Ref0 = { current: number };
const Ctx = createContext<{
  enabled: boolean; setEnabled: (v: boolean) => void;
  state: State; lastHeard: string; lastSpoken: string; supported: boolean;
  levelRef: Ref0;   // live audio level 0..1 (mic while listening, TTS while speaking)
}>({ enabled: false, setEnabled: () => {}, state: "disabled", lastHeard: "", lastSpoken: "", supported: false, levelRef: { current: 0 } });

export const useVoice = () => useContext(Ctx);

export function VoiceProvider({ children }: { children: ReactNode }) {
  // Computed after mount so server and first client render match (no hydration mismatch).
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [state, setState] = useState<State>("disabled");
  const [lastHeard, setLastHeard] = useState("");
  const [lastSpoken, setLastSpoken] = useState("");

  const recRef = useRef<Recognizer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stateRef = useRef<State>("disabled");
  const enabledRef = useRef(false);
  const msgsRef = useRef<Msg[]>([]);
  const idleTimerRef = useRef<number | null>(null);   // returns to idle after silence
  const set = (s: State) => { stateRef.current = s; setState(s); };

  const IDLE_MS = 10000;   // stay listening this long after a reply, then idle
  function clearIdle() { if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; } }
  function armIdle() {
    clearIdle();
    idleTimerRef.current = window.setTimeout(() => {
      if (stateRef.current === "capturing") set("idle");
    }, IDLE_MS);
  }
  function beginCapture() { set("capturing"); armIdle(); }   // conversation mode (no wake word)

  // ---- live audio level meter (drives the orb) ----
  const levelRef = useRef(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const speakAnalyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  function rms(an: AnalyserNode, buf: Uint8Array): number {
    an.getByteTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
    return Math.min(1, Math.sqrt(s / buf.length) * 3);
  }

  async function startMeter() {
    if (ctxRef.current) return;
    try {
      const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new Ctor();
      ctxRef.current = ctx;
      const mic = ctx.createAnalyser(); mic.fftSize = 512; mic.smoothingTimeConstant = 0.8;
      micAnalyserRef.current = mic;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      micStreamRef.current = stream;
      ctx.createMediaStreamSource(stream).connect(mic);   // analyser only — not to destination (no playback)
      const buf = new Uint8Array(mic.frequencyBinCount);
      const loop = () => {
        let lvl = rms(mic, buf);
        if (speakAnalyserRef.current) lvl = Math.max(lvl, rms(speakAnalyserRef.current, buf));
        levelRef.current = levelRef.current * 0.6 + lvl * 0.4;   // smooth
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch { /* meter unavailable — orb still breathes */ }
  }

  function stopMeter() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    speakAnalyserRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null; micAnalyserRef.current = null;
    levelRef.current = 0;
  }

  function stopAudio() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
  }

  function setEnabled(v: boolean) {
    enabledRef.current = v; setEnabledState(v);
    if (typeof window !== "undefined") localStorage.setItem("jarvisVoice", v ? "1" : "0");
    if (v) { set("idle"); recRef.current?.start(); startMeter(); }
    else { set("disabled"); recRef.current?.stop(); stopAudio(); stopMeter(); clearIdle(); }
  }

  async function handle(text: string) {
    if (!text) { set("idle"); return; }
    clearIdle();
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
    // Route playback through the analyser so the orb reacts to JARVIS's voice.
    try {
      const ctx = ctxRef.current;
      if (ctx) {
        const src = ctx.createMediaElementSource(a);
        const an = ctx.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = 0.8;
        src.connect(an); src.connect(ctx.destination);   // analyse + play
        speakAnalyserRef.current = an;
      }
    } catch { /* analysis optional */ }
    // After speaking, stay in conversation mode (listen for a follow-up, no wake
    // word) until IDLE_MS of silence returns us to idle.
    const done = () => { speakAnalyserRef.current = null; stopAudio(); if (enabledRef.current) beginCapture(); else set("idle"); };
    a.onended = done;
    a.onerror = done;
    a.play().catch(done);
  }

  function onFinal(text: string) {
    if (!enabledRef.current || !text) return;
    const s = stateRef.current;
    if (s === "speaking") {                            // barge-in: wake word stops playback
      const cmd = extractCommand(text);
      if (cmd !== null) { speakAnalyserRef.current = null; stopAudio(); if (cmd) handle(cmd); else beginCapture(); }
      return;
    }
    if (s === "capturing") {                           // conversation mode — no wake word needed
      const c = extractCommand(text);
      handle(c && c.length ? c : text);
      return;
    }
    if (s === "idle") {
      const cmd = extractCommand(text);
      if (cmd === null) return;                        // no wake word — ignore ambient speech
      if (cmd) handle(cmd); else beginCapture();
    }
  }

  // Any speech while capturing resets the silence countdown (so it won't time out mid-thought).
  function onActivity() { if (stateRef.current === "capturing") armIdle(); }

  // Detect Web Speech support on the client only (avoids hydration mismatch).
  useEffect(() => { setSupported(speechSupported()); }, []);

  // Build recognizer once; auto-restart on end while enabled.
  useEffect(() => {
    if (!supported) return;
    recRef.current = createRecognizer({
      onFinal,
      onActivity,
      onError: (e) => { if (e === "not-allowed" || e === "service-not-allowed") setEnabled(false); },
      onEnd: () => { if (enabledRef.current) setTimeout(() => recRef.current?.start(), 250); },
    });
    if (typeof window !== "undefined" && localStorage.getItem("jarvisVoice") === "1") setEnabled(true);
    return () => recRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  return (
    <Ctx.Provider value={{ enabled, setEnabled, state, lastHeard, lastSpoken, supported, levelRef }}>
      {children}
    </Ctx.Provider>
  );
}
