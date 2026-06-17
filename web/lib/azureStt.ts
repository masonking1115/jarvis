// Azure Speech-to-Text recognizer (browser SDK via CDN, token-authenticated).
// Exposes the same { start, stop } shape as voice.ts's createRecognizer so it's
// a drop-in. Returns null on any failure so the caller can fall back.
import { Recognizer } from "./voice";

const SDK_URL = "https://aka.ms/csspeech/jsbrowserpackageraw";
let sdkPromise: Promise<any> | null = null;

export function loadSpeechSdk(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if ((window as any).SpeechSDK) return Promise.resolve((window as any).SpeechSDK);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onload = () =>
      (window as any).SpeechSDK ? resolve((window as any).SpeechSDK) : reject(new Error("SpeechSDK missing"));
    s.onerror = () => reject(new Error("failed to load SpeechSDK"));
    document.head.appendChild(s);
  });
  return sdkPromise;
}

type AzureOpts = {
  onFinal: (t: string) => void;
  onActivity?: () => void;
  onError: (e: string) => void;
  onEnd: () => void;
  phrases?: string[];
};

export async function createAzureRecognizer(opts: AzureOpts): Promise<Recognizer | null> {
  let SDK: any;
  try { SDK = await loadSpeechSdk(); } catch { return null; }

  let region = "";
  async function fetchToken(): Promise<string | null> {
    try {
      const r = await fetch("/api/voice/stt-token");
      if (!r.ok) return null;
      const j = await r.json();
      if (!j.token) return null;
      region = j.region;
      return j.token;
    } catch { return null; }
  }

  const token = await fetchToken();
  if (!token) return null;

  let refreshed = false;

  function build(tok: string): any {
    const speechConfig = SDK.SpeechConfig.fromAuthorizationToken(tok, region);
    speechConfig.speechRecognitionLanguage = "en-US";
    const audioConfig = SDK.AudioConfig.fromDefaultMicrophoneInput();
    const rec = new SDK.SpeechRecognizer(speechConfig, audioConfig);
    if (opts.phrases?.length) {
      const plg = SDK.PhraseListGrammar.fromRecognizer(rec);
      opts.phrases.forEach((p) => plg.addPhrase(p));
    }
    rec.recognizing = () => opts.onActivity?.();
    rec.recognized = (_s: any, e: any) => {
      if (e?.result?.reason === SDK.ResultReason.RecognizedSpeech) {
        const t = (e.result.text || "").trim();
        if (t) opts.onFinal(t);
      }
    };
    rec.canceled = (_s: any, e: any) => {
      const details = e?.errorDetails || "";
      if (/token|auth|forbidden|401/i.test(details) && !refreshed) {
        refreshed = true;
        void refreshAndRestart();
      } else {
        opts.onError(details || "canceled");
      }
    };
    rec.sessionStopped = () => opts.onEnd();
    return rec;
  }

  let current = build(token);

  async function refreshAndRestart(): Promise<void> {
    const tok = await fetchToken();
    if (!tok) { opts.onError("token refresh failed"); return; }
    try { current.stopContinuousRecognitionAsync(); } catch { /* ignore */ }
    current = build(tok);
    try { current.startContinuousRecognitionAsync(); } catch { /* ignore */ }
  }

  return {
    start: () => { try { current.startContinuousRecognitionAsync(); } catch { /* already started */ } },
    stop: () => { try { current.stopContinuousRecognitionAsync(); } catch { /* already stopped */ } },
  };
}
