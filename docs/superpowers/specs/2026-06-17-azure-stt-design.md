# Azure Speech-to-Text + Fuzzy Wake Word — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorm) — pending implementation plan

## Goal

Replace JARVIS's mediocre browser speech recognition with Azure Speech-to-Text
(reusing the existing Azure key), biased with a phrase list for "JARVIS" + the
app's own vocabulary, and harden wake-word detection — without changing the
voice UX (wake word, conversation mode, barge-in).

## Problem

Listening uses the **browser Web Speech API** (`web/lib/voice.ts`,
`webkitSpeechRecognition`, `lang=en-US`, `maxAlternatives` unset). It is a
free, generic engine with no biasing: "JARVIS" is frequently misheard
("Travis"/"Jervis"), command tails come through garbled, and there's no control
or cross-browser consistency. This is the main source of low listening fidelity.

## Decisions (locked during brainstorming)

- **Engine:** Azure Speech-to-Text via the **in-browser Azure Speech JS SDK**,
  authenticated with a **short-lived token minted by the backend** from the
  existing Azure key (key never reaches the browser). (Approach A.)
- **Biasing:** a **phrase list** built dynamically from `"JARVIS"` + nav route
  names + skill names (`/api/skills`) + a few command verbs.
- **Fallback:** if the token fetch or SDK load fails, automatically fall back to
  the current Web Speech recognizer — voice never hard-breaks.
- **Wake word:** harden `extractCommand` with fuzzy/near-miss matching.
- **No UX change:** the existing VoiceProvider state machine (idle/capturing/
  thinking/speaking, barge-in, 10s idle conversation mode, level meter) is
  unchanged; only the recognizer source swaps.
- **Config:** reuse `azure_speech_key` / `azure_speech_region`; no new env vars.

## Architecture

```
Azure key (server-side) ──► voice/azure.issue_token() ──► GET /api/voice/stt-token
                                                                 │ {token, region}
                                                                 ▼
web/lib/azureStt.ts: loadSpeechSdk() (CDN) + createAzureRecognizer({...,phrases})
                                                                 │ {start, stop, onFinal,...}
                                                                 ▼
VoiceProvider: try Azure recognizer → fallback to Web Speech (voice.ts)
   (state machine, barge-in, conversation mode, meter — unchanged)
extractCommand() — fuzzy wake-word match (voice.ts)
```

## Component 1 — Backend token endpoint

**`backend/modules/voice/azure.py`** — add `issue_token() -> tuple[str, str]`:
- Raise `NotConfigured` if `settings.azure_speech_key` is empty.
- `POST https://{region}.api.cognitive.microsoft.com/sts/v1.0/issueToken` with
  header `Ocp-Apim-Subscription-Key: <key>` and empty body, `timeout=10`.
- Return `(response.text, region)` — the JWT (valid ~10 min) and the region.
- Never include the key in any raised error.

**`backend/modules/voice/router.py`** — add `GET /stt-token`:
- On success: `{"token": <jwt>, "region": <region>}`.
- On `NotConfigured`: `JSONResponse({"available": False, "reason": <msg>})`.
- On any other error: `JSONResponse({"available": False, "reason": "stt token failed"})`.
- Extend `GET /config` to also return `"stt": bool(settings.azure_speech_key)`.

## Component 2 — Frontend Azure recognizer

**`web/lib/azureStt.ts`** (new):

- `loadSpeechSdk(): Promise<any>` — inject the Azure Speech SDK script from CDN
  (`https://aka.ms/csspeech/jsbrowserpackageraw`) once; resolve with
  `window.SpeechSDK`. Mirrors `web/lib/cesium.ts::loadCesium`.
- `createAzureRecognizer(opts): Promise<Recognizer | null>` where
  `opts = { onFinal, onActivity, onError, onEnd, phrases }` and the returned
  shape matches the existing `Recognizer = { start, stop }`:
  - `await loadSpeechSdk()`; if it throws → return `null` (caller falls back).
  - `GET /api/voice/stt-token`; if `available === false` or fetch fails → `null`.
  - Build `SpeechConfig.fromAuthorizationToken(token, region)`,
    `speechRecognitionLanguage = "en-US"`, default mic `AudioConfig`.
  - Create `SpeechRecognizer`; attach a `PhraseListGrammar` and add every phrase.
  - `recognizing` → `opts.onActivity?.()`; `recognized` (reason ===
    `RecognizedSpeech`) → `opts.onFinal(text.trim())`; `canceled` → if the reason
    is an auth/token error, attempt one token refresh + restart, else
    `opts.onError(reason)`; `sessionStopped` → `opts.onEnd()`.
  - `start()` → `startContinuousRecognitionAsync()`; `stop()` →
    `stopContinuousRecognitionAsync()` (guarded in try/catch like today).

The `Recognizer` type and `extractCommand`/`speechSupported` stay in `voice.ts`;
`azureStt.ts` imports the `Recognizer` type from there.

## Component 3 — VoiceProvider integration

**`web/components/voice/VoiceProvider.tsx`** — in the recognizer-build effect:
- Build the phrase list: `["JARVIS", ...ROUTES, ...skillNames, "open", "search",
  "weather", "remember", "navigate"]`, where `skillNames` come from a
  best-effort `GET /api/skills` (empty on failure). De-duplicate.
- `const rec = await createAzureRecognizer({ onFinal, onActivity, onError, onEnd, phrases })`.
- If `rec` is `null`, fall back: `rec = createRecognizer({ onFinal, onActivity, onError, onEnd })`
  (the current Web Speech path).
- Everything else (start/stop on enable, auto-restart on end, state machine,
  meter, barge-in, conversation mode) is unchanged.
- Because recognizer creation becomes async, the effect uses an internal async
  function and an `alive` guard so a stale recognizer isn't started after unmount.

## Component 4 — Fuzzy wake word

**`web/lib/voice.ts::extractCommand`** — replace exact substring matching with a
near-miss match on the leading token(s):
- Tokenize the transcript; if any of the first 2 tokens matches the wake word by
  (a) Levenshtein distance ≤ 2 against `"jarvis"`, or (b) a small explicit
  near-miss set (`travis, jarvis, jarvus, jervis, jarviss, charvis`), treat it as
  the wake word and return the remainder (trimmed of leading punctuation).
- Still returns `""` when the wake word is found with no trailing command, and
  `null` when no wake-word-like token is present (ambient speech ignored).
- A small `_isWakeWord(token: string): boolean` helper holds the matching logic
  (pure, unit-tested).

## Error handling & privacy

- Azure key stays server-side; only short-lived tokens reach the browser.
- Token mint failure, SDK load failure, or `available:false` → silent fallback to
  Web Speech; the user still has working voice.
- Token expiry mid-session → one automatic refresh + recognizer restart; if that
  fails, surface via `onError` (existing mic-permission handling unchanged).
- No secret ever appears in an error string or response body.

## Testing

Backend (mirrors `tests/test_voice.py`, monkeypatched `httpx`):
- `issue_token` returns `(token, region)` on a mocked 200; raises `NotConfigured`
  when the key is empty; never leaks the key.
- `GET /stt-token` returns `{token, region}` when configured; returns
  `{available: false, reason}` when not (monkeypatch `settings.azure_speech_key`).
- `GET /config` includes `stt` boolean.

Frontend (the project has no JS test framework; frontend is verified by `tsc` +
live e2e, as with prior features). For the one piece of pure logic that's easy to
get wrong — the fuzzy wake word — the plan includes a small standalone **`node`
assertion script** (no framework) over the compiled `_isWakeWord`/`extractCommand`
logic:
- `extractCommand`: exact ("jarvis open finance" → "open finance"), near-miss
  ("travis what's the weather" → "what's the weather"), trailing-empty ("hey
  jarvis" → ""), absent ("turn on the lights" → null).
- `tsc --noEmit` passes for `azureStt.ts`, `voice.ts`, `VoiceProvider.tsx`.

Live e2e (manual, in the verification step): speak commands and confirm Azure
transcription is materially more accurate and the wake word triggers reliably;
confirm fallback works when the key is removed.

## File structure

**Create:**
- `web/lib/azureStt.ts` — SDK loader + Azure recognizer
- `tests/test_voice_stt.py` — backend token tests (or extend `tests/test_voice.py`)

**Modify:**
- `backend/modules/voice/azure.py` — `issue_token()`
- `backend/modules/voice/router.py` — `GET /stt-token`, `stt` flag in `/config`
- `web/lib/voice.ts` — fuzzy `extractCommand` + `_isWakeWord`
- `web/components/voice/VoiceProvider.tsx` — async recognizer build (Azure →
  fallback) + dynamic phrase list

## Future / out of scope

- **Custom Speech model** (Azure custom vocabulary training) — phrase list is
  enough for now.
- **Server-side streaming STT** (Approach B) — only if browser SDK proves limiting.
- **Per-skill phrase lists** — could enrich biasing once many skills exist.
