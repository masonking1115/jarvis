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
// The stream only runs while `enabled` is true (privacy); capture() pulls a single
// frame to a canvas and returns a JPEG data URL.
export function CameraProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setError("");
      } catch (e: any) {
        setError(e?.name === "NotAllowedError" ? "Camera permission denied." : "No camera available.");
        setEnabled(false);
      }
    }
    function stop() {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    }
    if (enabled) start(); else stop();
    return () => { cancelled = true; stop(); };
  }, [enabled]);

  function capture(): string | null {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
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
      {/* Hidden capture source + small live preview when enabled. */}
      <video ref={videoRef} muted playsInline className="hidden" />
      {enabled && (
        <div className="fixed bottom-5 left-5 z-[30] rounded-xl overflow-hidden border border-[#4ad6ff]/40 shadow-[0_0_24px_rgba(74,214,255,0.25)] pointer-events-none">
          <PreviewMirror getVideo={() => videoRef.current} />
        </div>
      )}
    </Ctx.Provider>
  );
}

// Mirrors the hidden capture <video> into a small visible preview using the same stream.
function PreviewMirror({ getVideo }: { getVideo: () => HTMLVideoElement | null }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const src = getVideo();
    const el = ref.current;
    if (src && el) { el.srcObject = src.srcObject; el.play().catch(() => {}); }
  });
  return <video ref={ref} muted playsInline className="w-40 h-30 object-cover" style={{ height: 120 }} />;
}
