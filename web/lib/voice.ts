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

// Common mishears of "jarvis" from speech engines.
const WAKE_NEAR = new Set([
  "jarvis", "travis", "jarvus", "jervis", "jarviss", "charvis", "jervais", "jarvix",
]);

function _lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    }
  return d[m][n];
}

// True if a token is (a near-miss of) the wake word.
export function _isWakeWord(token: string): boolean {
  const t = token.toLowerCase().replace(/[^a-z]/g, "");
  if (t.length < 4) return false;        // avoid short false positives
  if (WAKE_NEAR.has(t)) return true;
  return _lev(t, WAKE) <= 2;
}

// Command after the wake word: "" if wake word is trailing-empty, null if absent.
// The wake word may be the first or second token ("hey jarvis ...").
export function extractCommand(transcript: string): string | null {
  const raw = (transcript || "").trim();
  if (!raw) return null;
  const tokens = raw.split(/\s+/);
  for (let i = 0; i < Math.min(2, tokens.length); i++) {
    if (_isWakeWord(tokens[i])) {
      return tokens.slice(i + 1).join(" ").replace(/^[\s,.:;!?-]+/, "").trim();
    }
  }
  return null;
}
