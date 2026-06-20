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
      {enabled && (
        <div className="fixed bottom-5 left-5 z-[30] rounded-xl overflow-hidden border border-[#4ad6ff]/40 shadow-[0_0_24px_rgba(74,214,255,0.25)]">
          {/* Rendered (not display:none) so frames decode and capture() works. */}
          <video ref={videoRef} muted playsInline autoPlay className="block w-44 h-auto" />
          {!ready && (
            <div className="absolute inset-0 grid place-items-center bg-black/50 text-[11px] text-[#9fe6ff]">
              starting camera…
            </div>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}
