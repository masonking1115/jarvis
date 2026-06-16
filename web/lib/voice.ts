// Browser Web Speech wrapper + wake-word helpers. Chrome/Edge only.
export const WAKE = "jarvis";

export function speechSupported(): boolean {
  return typeof window !== "undefined" &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export type Recognizer = { start: () => void; stop: () => void };

export function createRecognizer(opts: {
  onFinal: (text: string) => void;
  onActivity?: () => void;   // fires on any (interim or final) result — "user is making sound"
  onError: (err: string) => void;
  onEnd: () => void;
}): Recognizer | null {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
  rec.onresult = (e: any) => {
    opts.onActivity?.();
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) opts.onFinal((e.results[i][0].transcript || "").trim());
    }
  };
  rec.onerror = (e: any) => opts.onError(e.error || "error");
  rec.onend = () => opts.onEnd();
  return { start: () => { try { rec.start(); } catch { /* already started */ } },
           stop: () => { try { rec.stop(); } catch { /* already stopped */ } } };
}

// Command after the wake word: "" if wake word is trailing-empty, null if absent.
export function extractCommand(transcript: string): string | null {
  const t = transcript.toLowerCase();
  const i = t.indexOf(WAKE);
  if (i === -1) return null;
  return transcript.slice(i + WAKE.length).replace(/^[\s,.:;!?-]+/, "").trim();
}
