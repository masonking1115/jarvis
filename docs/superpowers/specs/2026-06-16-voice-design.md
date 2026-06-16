# JARVIS Voice — Design Spec

**Status:** Approved design (2026-06-16)
**Feature:** Hands-free voice conversation with JARVIS — a "Hey JARVIS" wake word, browser speech-to-text, the existing Claude-CLI brain, and an Azure British-male neural voice (en-GB-RyanNeural) for spoken replies, with wake-word **barge-in** to interrupt mid-sentence.

---

## 1. Goal

From anywhere in the JARVIS console, the user enables voice, says **"Hey JARVIS, …"**, and JARVIS answers **out loud** in a refined British accent (close to the film's voice), grounded in the user's data via the existing `/api/chat` endpoint. The user can **interrupt** a spoken reply at any time by saying "Jarvis" again.

## 2. Decisions (locked)

- **TTS:** Azure Neural TTS, voice **en-GB-RyanNeural**, proxied through the backend (key stays server-side).
- **Wake word:** "Hey JARVIS" / "JARVIS" via the browser `SpeechRecognition` API (continuous).
- **STT:** browser `SpeechRecognition` (Chrome/Edge). Audio is transcribed by the browser (Chrome streams to Google).
- **Brain:** existing `POST /api/chat` (Claude-CLI provider, Max plan) with a concise-for-speech hint.
- **Barge-in:** saying the wake word while JARVIS is speaking stops playback immediately and captures a new command.
- **Privacy/control:** master toggle, **off by default**; the mic only goes live when enabled, with a visible active indicator.

## 3. Architecture

```
HeaderBar toggle: "JARVIS Voice" on/off
  └─ <VoiceProvider> (console layout) — state machine + audio
       states: disabled → idle(listening) → capturing → thinking → speaking → idle
       ├─ SpeechRecognition (continuous, auto-restart)   ← wake word + command + barge-in
       ├─ POST /api/chat {messages, voice:true}          ← reply text (Claude CLI)
       ├─ POST /api/voice/tts {text}  → mp3              ← Azure en-GB-Ryan
       │     HTMLAudioElement plays it; "speaking" state
       └─ <VoiceIndicator> (JarvisOrb) — brightness/caption by state

FastAPI backend
  └─ modules/voice (auto-mounted /api/voice)
       ├─ GET  /config  → { available, voice }
       └─ POST /tts     → audio/mpeg (Azure TTS via SSML)

Azure Cognitive Services Speech (TTS REST)
```

## 4. Backend: `backend/modules/voice/`

### 4.1 Config (`core/config.py`)
- `azure_speech_key: str = ""`
- `azure_speech_region: str = "eastus"`
- `jarvis_voice: str = "en-GB-RyanNeural"`

### 4.2 Azure client (`azure.py`)
- `synthesize(text: str, voice: str) -> bytes` — POST to
  `https://{region}.tts.speech.microsoft.com/cognitiveservices/v1`
  headers: `Ocp-Apim-Subscription-Key`, `Content-Type: application/ssml+xml`,
  `X-Microsoft-OutputFormat: audio-24khz-48kbitrate-mono-mp3`,
  body: SSML `<speak><voice name=...><prosody rate="...">{escaped text}</prosody></voice></speak>`.
- `NotConfigured` exception when no key. Errors never echo the key (catch & sanitize).
- Escape text for XML; cap length (e.g. 1500 chars) so a runaway reply can't blow up.

### 4.3 Endpoints (`router.py`)
- `GET /api/voice/config` → `{available: bool, voice: str, reason?}` (available = key present).
- `POST /api/voice/tts` `{text, voice?}` → `Response(content=mp3, media_type="audio/mpeg")`; degrade with JSON `{available:false, reason}` + HTTP 200 if no key or on Azure error (sanitized).

### 4.4 Chat tweak (`modules/chat/router.py`)
- `ChatRequest` gains `voice: bool = False`. When true, append to the system prompt:
  *"Respond briefly and conversationally, as spoken dialogue — at most 2–3 sentences, no markdown, no lists."*

## 5. Frontend

### 5.1 `web/lib/voice.ts`
- Thin wrapper around `webkitSpeechRecognition`/`SpeechRecognition`: `createRecognizer({onResult, onEnd, onError})` with `continuous = true`, `interimResults = true`, `lang = "en-US"`.
- `extractCommand(transcript)`: lowercase, find "jarvis"; return the text after the wake word (trimmed) or `""` if the wake word is at the end (→ open a capture window).
- `tts(text)`: `fetch("/api/voice/tts", {POST, json})` → `blob()` → object URL.

### 5.2 `web/components/voice/VoiceProvider.tsx`
A client component mounted in the console layout. Owns:
- `enabled` (master toggle, persisted in `localStorage`), `state` machine, a short rolling `messages` history (last ~8) for context.
- **Recognition lifecycle:** when `enabled`, start the recognizer; on `onend`, restart (unless disabled or intentionally stopped) — handles Chrome's auto-stop. On unrecoverable error (`not-allowed`), disable + surface a message.
- **Wake/command logic:**
  - `idle`: scan final transcripts for the wake word. On match → if there's trailing text, treat it as the command; else enter `capturing` (next final transcript = command).
  - `capturing`: first non-empty final transcript → `thinking`.
- **Thinking:** push user msg, `POST /api/chat {messages, voice:true}`; on reply → `speaking`.
- **Speaking:** `tts(reply)` → play `HTMLAudioElement`. **Recognition stays active** for barge-in: if a transcript contains the wake word while speaking → stop audio, clear, go to `capturing`. On audio `ended` → back to `idle`.
- **Self-hearing mitigation:** `getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}})` is requested once to bias the mic; barge-in keys only on the wake word so JARVIS's own speech won't trigger it.
- Exposes `{enabled, setEnabled, state, lastHeard, lastSpoken}` via context for the HeaderBar + indicator.

### 5.3 `web/components/voice/VoiceIndicator.tsx`
- Small fixed indicator (bottom-left) using `JarvisOrb` scaled down; opacity/scale keyed to state (dim idle, bright listening, pulsing thinking, steady speaking) + a one-line caption (what was heard / being said). Hidden when disabled.

### 5.4 HeaderBar toggle
- A "🎙 JARVIS Voice" button reflecting `enabled` + current state colour. Lives in `HeaderBar`, inside `VoiceProvider`.

## 6. State machine
`disabled` ⇄ (toggle) `idle`
`idle` → (wake word) → `capturing` → (utterance) → `thinking` → (reply) → `speaking` → (audio end) → `idle`
`speaking` → (wake word heard) → stop audio → `capturing`  *(barge-in)*

## 7. Error handling & degradation
- **No Azure key:** `/config` → `available:false`; toggle still works for STT but replies are shown as a caption only (no audio) with a "set AZURE_SPEECH_KEY" note. No crash.
- **Mic permission denied / no SpeechRecognition (Firefox):** disable voice, show a one-line explanation; rest of the app unaffected.
- **Azure/network error:** caption the reply text, skip audio; never surface the key.
- **TTS text cap** prevents oversized requests.

## 8. Testing
- **Backend (pytest):** `/config` available/degraded; `azure.synthesize` builds correct SSML and is mocked for the happy path; key never appears in any response/error string; chat `voice:true` appends the concise instruction.
- **Frontend:** pure `extractCommand()` unit-style checks via typecheck + manual; the recognition/audio path is verified manually (checklist).

## 9. Out of scope (v1 — YAGNI)
Voice-activity ("just start talking") barge-in, multi-language, in-app voice picker, offline TTS, speaker diarization. All clean follow-ups.

## 10. Config the user must provide
- `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` — a free Azure "Speech" resource (free tier ≈ 500k chars/month neural).
- Chrome or Edge (Web Speech API); grant microphone permission when prompted.
