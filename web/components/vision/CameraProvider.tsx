"use client";
import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";

type CameraCtx = {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  error: string;
  /** Grab one frame as a JPEG data URL, or null if the camera isn't ready. */
  capture: () => string | null;
};

const Ctx = createContext<CameraCtx>({ enabled: false, setEnabled: () => {}, error: "", capture: () => null });
export const useCamera = () => useContext(Ctx);

// Agnostic webcam capture via getUserMedia — any camera, any OS, no drivers.
// The stream only runs while `enabled` is true (privacy). capture() pulls a single
// frame from the live <video> to a canvas and returns a JPEG data URL.
//
// NOTE: the <video> must be actually rendered (not display:none) or browsers won't
// decode frames and videoWidth stays 0. We render a small visible preview when on.
export function CameraProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState(false);   // fullscreen camera view
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      setReady(false);
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Camera needs HTTPS or localhost."); setEnabled(false); return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.onloadedmetadata = () => { v.play().catch(() => {}); setReady(true); };
        }
        setError("");
      } catch (e: any) {
        const n = e?.name;
        const msg = n === "NotAllowedError" ? "Camera permission denied — click the camera icon in the address bar and Allow, then retry."
          : n === "NotFoundError" || n === "DevicesNotFoundError" ? "No camera found — is the C920 plugged in?"
          : n === "NotReadableError" || n === "TrackStartError" ? "Camera is in use by another app (close Zoom/Teams/OBS) and retry."
          : n === "OverconstrainedError" ? "Camera doesn't support the requested mode."
          : `Could not start the camera (${n || e?.message || "unknown"}).`;
        console.error("[camera] getUserMedia failed:", n, e);
        setError(msg);
        setEnabled(false);
      }
    }
    function stop() {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setReady(false);
      if (videoRef.current) videoRef.current.srcObject = null;
    }
    if (enabled) start(); else stop();
    return () => { cancelled = true; };
  }, [enabled]);

  // Collapse the fullscreen view if the camera turns off.
  useEffect(() => { if (!enabled) setExpanded(false); }, [enabled]);

  // The <video> remounts when toggling small <-> fullscreen; re-bind the live
  // stream to whichever element is mounted so it keeps showing (and capture works).
  useEffect(() => {
    const v = videoRef.current;
    if (v && streamRef.current && v.srcObject !== streamRef.current) {
      v.srcObject = streamRef.current;
      v.play().catch(() => {});
    }
  }, [expanded, enabled, ready]);

  // Fullscreen: Esc or Space exits (same as the flyover view).
  useEffect(() => {
    if (!expanded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" && e.key !== " " && e.code !== "Space") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      setExpanded(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  function capture(): string | null {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return null;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.8);
  }

  return (
    <Ctx.Provider value={{ enabled, setEnabled, error, capture }}>
      {children}
      {error && (
        <div className="fixed bottom-5 left-5 z-[60] max-w-xs rounded-xl border border-jarvis-bad/60 bg-[#1a0810]/90 backdrop-blur px-3 py-2 text-[12px] text-jarvis-bad shadow-lg">
          <div className="flex items-start gap-2">
            <span>📷</span>
            <span className="flex-1">{error}</span>
            <button onClick={() => setError("")} className="text-jarvis-muted hover:text-white">✕</button>
          </div>
          <button onClick={() => { setError(""); setEnabled(true); }}
                  className="mt-1 text-[11px] text-jarvis-accent hover:underline">Retry</button>
        </div>
      )}
      {/* Small corner preview — click to expand to fullscreen. Rendered (not
          display:none) so frames decode and capture() works. */}
      {enabled && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          title="Expand camera (Esc or Space to exit)"
          className="fixed bottom-5 left-5 z-[30] block p-0 rounded-xl overflow-hidden border border-[#4ad6ff]/40 shadow-[0_0_24px_rgba(74,214,255,0.25)] cursor-pointer hover:border-[#4ad6ff]/80 transition-colors">
          <video ref={videoRef} muted playsInline autoPlay className="block w-44 h-auto" />
          {!ready && (
            <div className="absolute inset-0 grid place-items-center bg-black/50 text-[11px] text-[#9fe6ff]">
              starting camera…
            </div>
          )}
        </button>
      )}

      {/* Fullscreen camera — same chrome as the flyover view. */}
      {enabled && expanded && (
        <div data-cam-fullscreen="true" className="fixed inset-0 z-[100] bg-[#04080f] grid-bg">
          <div className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(60% 60% at 50% 50%, rgba(74,214,255,0.08), transparent 70%), radial-gradient(40% 40% at 50% 50%, rgba(74,214,255,0.05), transparent 70%)" }} />
          <video ref={videoRef} muted playsInline autoPlay className="absolute inset-0 w-full h-full object-contain" />
          {/* harsh edge taper into the dark grid backdrop */}
          <div className="pointer-events-none absolute inset-0" style={{ boxShadow: "inset 0 0 96px 120px #04080f" }} />
          {/* grid lines on the tapered border */}
          <div className="pointer-events-none absolute top-0 inset-x-0 grid-bg"
            style={{ height: 240, WebkitMaskImage: "linear-gradient(to bottom, #000, #000 45%, transparent)", maskImage: "linear-gradient(to bottom, #000, #000 45%, transparent)" }} />
          <div className="pointer-events-none absolute bottom-0 inset-x-0 grid-bg"
            style={{ height: 240, WebkitMaskImage: "linear-gradient(to top, #000, #000 45%, transparent)", maskImage: "linear-gradient(to top, #000, #000 45%, transparent)" }} />
          <div className="pointer-events-none absolute left-0 inset-y-0 grid-bg"
            style={{ width: 240, WebkitMaskImage: "linear-gradient(to right, #000, #000 45%, transparent)", maskImage: "linear-gradient(to right, #000, #000 45%, transparent)" }} />
          <div className="pointer-events-none absolute right-0 inset-y-0 grid-bg"
            style={{ width: 240, WebkitMaskImage: "linear-gradient(to left, #000, #000 45%, transparent)", maskImage: "linear-gradient(to left, #000, #000 45%, transparent)" }} />
          {/* cyan panel border + corner cuts */}
          <div className="pointer-events-none absolute inset-2 rounded-[14px] corner-cuts"
            style={{ border: "1px solid rgba(74, 214, 255, 0.35)", boxShadow: "inset 0 0 60px rgba(74, 214, 255, 0.10), 0 0 30px rgba(74, 214, 255, 0.15)" }} />
          <div className="absolute bottom-5 left-6 text-[11px] text-jarvis-muted tracking-wider">ESC OR SPACE TO EXIT</div>
        </div>
      )}
    </Ctx.Provider>
  );
}
