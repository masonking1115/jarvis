"use client";
import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { agent, voice as voiceApi } from "@/lib/api";
import { createRecognizer, extractCommand, speechSupported, Recognizer } from "@/lib/voice";
import { createAzureRecognizer } from "@/lib/azureStt";

const ROUTES = ["dashboard", "finance", "spending", "email", "fitness", "workouts",
  "projects", "trading", "agents", "notes", "settings", "goals", "schedule", "tax"];

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
  const router = useRouter();
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

  function pushMsg(role: "user" | "assistant", content: string) {
    msgsRef.current = [...msgsRef.current, { role, content }].slice(-8);
  }

  // Execute a browser-side action; returns true if handled here.
  function runFrontend(tool: string, args: any): boolean {
    if (tool === "navigate" && ROUTES.includes(args?.target)) { router.push("/" + args.target); return true; }
    if (tool === "open_flyover") { window.dispatchEvent(new CustomEvent("jarvis:flyover")); return true; }
    return false;
  }

  async function handle(text: string) {
    if (!text) { set("idle"); return; }
    clearIdle();
    setLastHeard(text);
    set("thinking");
    pushMsg("user", text);

    let plan: any;
    try { plan = await agent.plan(msgsRef.current); }
    catch { plan = { kind: "reply", text: "Sorry, I couldn't reach the server." }; }

    if (plan?.kind === "action") {
      const ack = plan.ack || "On it, sir.";
      pushMsg("assistant", ack);
      setLastSpoken(ack);
      if (runFrontend(plan.tool, plan.args)) { await speak(ack); return; }      // navigation: ack is the whole reply
      // backend tool: run it while the ack plays, then speak the result
      const runP = agent.run(plan.tool, plan.args).then(r => r.text).catch(() => "I ran into a problem, sir.");
      await speak(ack, { final: false });
      const result = await runP;
      setLastSpoken(result);
      await speak(result);
      return;
    }

    const reply = plan?.text || "…";
    pushMsg("assistant", reply);
    setLastSpoken(reply);
    await speak(reply);
  }

  // Speak text via Azure TTS. Resolves when playback ends. Only the FINAL
  // utterance of a turn re-enters conversation mode (so an ack doesn't).
  function speak(text: string, opts?: { final?: boolean }): Promise<void> {
    const final = opts?.final !== false;
    return new Promise<void>((resolve) => {
      (async () => {
        set("speaking");
        const url = await voiceApi.tts(text).catch(() => null);
        const finish = () => {
          speakAnalyserRef.current = null; stopAudio();
          if (final) { if (enabledRef.current) beginCapture(); else set("idle"); }
          resolve();
        };
        if (!url) { finish(); return; }                 // no Azure key → caption only
        const a = new Audio(url); audioRef.current = a;
        try {
          const ctx = ctxRef.current;
          if (ctx) {
            const src = ctx.createMediaElementSource(a);
            const an = ctx.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = 0.8;
            src.connect(an); src.connect(ctx.destination);   // analyse + play
            speakAnalyserRef.current = an;
          }
        } catch { /* analysis optional */ }
        const done = () => { a.onended = null; a.onerror = null; finish(); };
        a.onended = done;
        a.onerror = done;
        a.play().catch(done);
      })();
    });
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

  // Build recognizer once: prefer Azure STT (accurate, phrase-biased), fall back
  // to browser Web Speech. Auto-restart on end while enabled.
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    const handlers = {
      onFinal,
      onActivity,
      onError: (e: string) => { if (e === "not-allowed" || e === "service-not-allowed") setEnabled(false); },
      onEnd: () => { if (enabledRef.current) setTimeout(() => recRef.current?.start(), 250); },
    };
    (async () => {
      // Build the phrase list: wake word + nav routes + skill names + command verbs.
      let skillNames: string[] = [];
      try {
        const r = await fetch("/api/skills");
        if (r.ok) skillNames = ((await r.json()).skills || []).map((s: any) => s.name);
      } catch { /* best-effort biasing */ }
      const phrases = Array.from(new Set(
        ["JARVIS", ...ROUTES, ...skillNames, "open", "search", "weather", "remember", "navigate"]
      ));

      let rec = await createAzureRecognizer({ ...handlers, phrases });
      if (!rec) rec = createRecognizer(handlers);     // fall back to Web Speech
      if (!alive) { rec?.stop(); return; }
      recRef.current = rec;
      if (typeof window !== "undefined" && localStorage.getItem("jarvisVoice") === "1") setEnabled(true);
    })();
    return () => { alive = false; recRef.current?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  return (
    <Ctx.Provider value={{ enabled, setEnabled, state, lastHeard, lastSpoken, supported, levelRef }}>
      {children}
    </Ctx.Provider>
  );
}
