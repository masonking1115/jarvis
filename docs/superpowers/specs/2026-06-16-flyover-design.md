# Flyover — Design Spec

**Status:** Approved design (2026-06-16)
**Feature:** A full-screen, photoreal aerial flyover of the user's actual address inside JARVIS, lit by the real sun position for the current moment and overlaid with live weather effects. Toggled with **Esc** (clean cross-fade in/out).

> Working name "Flyover" — renameable. The user has also called it "the weather view."

---

## 1. Goal

From anywhere in the JARVIS console, pressing **Esc** cross-fades the dashboard into a live aerial view of the user's address — real Google photoreal 3D buildings/terrain, the real sun angle for *right now*, and current weather rendered as effects (rain streaks, snow, fog/haze, cloud dimming). Esc again fades back. Works for **any geocodable address**, not a hardcoded location. Costs effectively **$0/month** for single-user use.

## 2. Constraints & decisions (locked)

- **Lives inside JARVIS** (existing FastAPI + Next.js repo). No Electron/Tauri.
- **CesiumJS** renders **Google Photorealistic 3D Tiles** directly with a Google Maps API key (no Cesium Ion account).
- **Esc** is the single toggle, with a cross-fade both directions.
- **OpenWeather** provides geocoding + current conditions.
- **Configurable address**, geocoded; works anywhere (photoreal *building* detail depends on Google coverage — rural areas fall back to terrain + aerial imagery; the scene always renders something).
- Visual chrome matches JARVIS (navy `#040813`/panel `#0a1424`, cyan accent `#4ad6ff`).
- One key (`google_maps_api_key`) is exposed to the browser (unavoidable — Cesium fetches tiles directly from Google); locked by HTTP-referrer restriction. `openweather_api_key` stays server-side (proxied).

## 3. Architecture

```
JARVIS console (Next.js)
  └─ <FlyoverProvider> (console layout)        ← Esc key listener + open/closed state
       └─ <Flyover> overlay (fixed inset-0)     ← fades opacity 0↔1; stays MOUNTED when closed
            ├─ Cesium <div> container           ← viewer kept alive between toggles (cost optimization)
            └─ JARVIS-styled HUD                ← address · local time · temp · conditions · settings gear

FastAPI backend
  └─ modules/flyover (auto-mounted /api/flyover)
       ├─ GET  /config       → { address, lat, lng, units, google_maps_key, has_weather }
       ├─ GET  /weather      → proxied OpenWeather current conditions (key stays server-side)
       ├─ POST /location     → geocode an address (OpenWeather geocoder), persist
       └─ model: FlyoverSettings (single row: address, lat, lng, units, updated_at)

External
  ├─ Google Photorealistic 3D Tiles  (client → Google, with maps key)
  └─ OpenWeather  /geo/1.0/direct  +  /data/2.5/weather   (server → OpenWeather)
```

## 4. Backend module: `backend/modules/flyover/`

Follows the existing auto-mount pattern (`__init__.py` exposes `router`; model registered in `db.py` `init_db`).

### 4.1 Model — `models.py`
`FlyoverSettings` (single-row settings table):
- `id` PK
- `address: str | None`
- `lat: float | None`
- `lng: float | None`
- `units: str = "imperial"`  (imperial | metric)
- `updated_at: datetime`

Helper `get_or_create(db)` returns the single row (id=1), creating it if absent.

### 4.2 Config — add to `core/config.py`
- `google_maps_api_key: str = ""`
- `openweather_api_key: str = ""`
- `flyover_default_units: str = "imperial"`

(Values live in `backend/.env`; never printed.)

### 4.3 Endpoints — `router.py`

**`GET /api/flyover/config`**
Returns `{ "address", "lat", "lng", "units", "google_maps_key", "has_weather" }`.
- `google_maps_key` is the raw maps key (must reach the client for Cesium). `has_weather` = bool(openweather key set) so the UI can decide whether to attempt weather.
- If no maps key configured: return `{ "available": false, "reason": "Set GOOGLE_MAPS_API_KEY in backend/.env" }` (HTTP 200, degrade gracefully — never 500).
- If no location set yet: `lat/lng` null → UI prompts for an address.

**`GET /api/flyover/weather`**
Proxies OpenWeather current conditions for the stored lat/lng (or `?lat=&lng=` override).
Returns normalized `{ "main", "description", "temp", "clouds_pct", "wind_mps", "is_day", "raw_id" }` where `main ∈ {Clear, Clouds, Rain, Drizzle, Snow, Thunderstorm, Mist, Fog, Haze, ...}`.
- No weather key → `{ "available": false }` (UI renders sun-only, no effects).
- OpenWeather error/timeout → `{ "available": false, "reason": ... }`.

**`POST /api/flyover/location`**  body `{ "address": "<freeform>" }`
- Geocodes via OpenWeather `geo/1.0/direct?q=<address>&limit=1`.
- On hit: persist `address/lat/lng`, return `{ "ok": true, "address", "lat", "lng" }`.
- No match → `{ "ok": false, "reason": "Address not found" }`.
- No weather key → `{ "ok": false, "reason": "Geocoding needs OPENWEATHER_API_KEY" }`.

### 4.4 Key handling
- Only the Google **tiles** key is sent to the browser (via `/config`). Document that the user should restrict it to localhost referrers in Google Cloud Console.
- OpenWeather key is read server-side only; never returned in any response (only the boolean `has_weather`).

## 5. Frontend

### 5.1 Loading Cesium
- Load CesiumJS from its **CDN** (script + `widgets.css`) lazily on first open — avoids Next/webpack asset/`CESIUM_BASE_URL` complications. Pin a specific stable version in the plan.
- A `loadCesium()` helper injects the `<script>`/`<link>` once and resolves when `window.Cesium` is ready.

### 5.2 Overlay & toggle
- `<FlyoverProvider>` mounted in the `(console)` layout: holds `open` state, registers a `keydown` listener for **Esc** that flips `open` (and calls `preventDefault` only while flyover handling applies; must not break existing Esc-to-close behaviors in modals — see §8).
- `<Flyover>` renders `fixed inset-0 z-[100]` with `opacity` + `pointer-events` transitioned over ~500–600ms (`transition-opacity`). **Stays mounted when closed** (opacity 0, `pointer-events-none`) so the Cesium viewer and its Google tile session survive toggles.
- On very first open: show a JARVIS-styled loading shimmer while Cesium loads + the tileset streams.

### 5.3 Cesium viewer setup
- `new Cesium.Viewer(container, { globe: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false })`.
- Add Google P3DT: set `Cesium.GoogleMaps.defaultApiKey = key` then `viewer.scene.primitives.add(await Cesium.createGooglePhotorealistic3DTileset())`.
- **Sun/time:** `viewer.clock.currentTime = Cesium.JulianDate.now()`, `shouldAnimate = true`, multiplier 1 → real-time sun. `viewer.scene.light = new Cesium.SunLight()`; enable `scene.skyAtmosphere` and `scene.fog`. Sun position derives from clock + lat/lng automatically.
- **Camera:** fly to an oblique aerial view over `lat/lng` (altitude ~400–800 m, pitch ~ -35°), then a slow continuous **orbit** (increment heading each tick via `scene.preUpdate`/`clock.onTick`). Orbit speed configurable constant.

### 5.4 Weather → effects mapping (pure function, unit-tested)
`weatherToEffects(w)` maps normalized conditions to a render profile:

| Condition | Effects |
|---|---|
| Clear | full sun; no particles; minimal fog |
| Clouds (by `clouds_pct`) | reduce light intensity & raise fog density proportional to cloud % |
| Rain / Drizzle / Thunderstorm | rain post-process (streaks) + darkening + light wet-look; heavier for Thunderstorm |
| Snow | snow post-process (flakes); cool, brightened diffuse |
| Mist / Fog / Haze | raise `scene.fog.density` + atmosphere haze; soften light |

- Rain/snow/fog implemented as Cesium `PostProcessStage`s (based on Cesium's published rain/snow/fog GLSL examples). Lighting/fog adjustments applied to `scene.light`, `scene.fog`, `scene.skyAtmosphere`.
- Weather polled on open and every ~10 min while open. Effects update without recreating the viewer.

### 5.5 HUD (JARVIS-styled)
Corner panel using existing classes (`panel`, accent cyan): address, **local time at the location** (ticking), temperature + condition text, a small **settings gear** to set/change the address (calls `POST /location`, then re-flies the camera). A faint "Esc to exit" hint.

### 5.6 Discoverability
Esc is the primary toggle. Also add a subtle **sidebar entry** ("Flyover") so it's discoverable and clickable, sharing the same open state.

## 6. Data flow (open sequence)
1. Esc → `open = true` → overlay fades in.
2. First open only: `loadCesium()` → build viewer → set clock to now → add Google tileset → fly camera to stored `lat/lng`.
3. `GET /config` (address/lat/lng/key) — fetched once and cached.
4. `GET /weather` → `weatherToEffects()` → apply effects.
5. Orbit + real-time sun run continuously while open.
6. Esc → `open = false` → fade out, viewer hidden but alive (no new tile session within 3 h).

## 7. Cost
- Billable = one Google **root-tileset request** per viewer session (reused ≤3 h). Free tier 1,000/month; $6/1,000 above.
- Single-user realistic usage → **$0/month** (would need ~100 opens/day to reach ~$12/mo).
- OpenWeather (geocode + current) and the orbit/tile streaming are free at this volume.

## 8. Error handling & degradation
- **No Google key:** overlay shows a styled "Add GOOGLE_MAPS_API_KEY to backend/.env" card; Esc still closes. No crash.
- **No OpenWeather key:** flyover runs with real sun/time; weather effects disabled (treated as Clear); settings gear explains geocoding needs the key.
- **No location set:** prompt for an address in the HUD before building the scene.
- **Geocode miss:** keep prior location; show inline "Address not found."
- **Tiles/network failure:** Cesium renders what it can; HUD shows an error chip; no crash.
- **Esc conflict:** the Esc listener must not hijack Esc when a modal/input is focused (e.g., the statement-detail modal, edit fields). Only toggle when no JARVIS modal/overlay is open and focus isn't in a text input.

## 9. Testing
- **Backend (pytest, existing patterns):**
  - `/config` returns key + flags; degrades when key absent (no 500).
  - `/weather` normalizes a mocked OpenWeather payload; degrades when key absent.
  - `/location` geocodes a mocked response, persists, and handles no-match.
  - `OPENWEATHER_API_KEY` never appears in any response body.
- **Frontend:**
  - `weatherToEffects()` pure-function unit tests across all condition branches.
  - Toggle/fade state machine: Esc opens/closes; Esc ignored while a modal/input is focused; viewer mounts once and is reused.
  - (Cesium scene rendering is validated manually — not unit-tested.)

## 10. Out of scope (v1 — YAGNI)
Multiple saved locations; forecast/time-scrubbing playback; street-level/indoor view; VR; sharing/export; mobile gestures. All are clean follow-ups.

## 11. Config the user must provide
- `GOOGLE_MAPS_API_KEY` — Google Cloud project with **Map Tiles API** enabled + billing on; restrict key to localhost referrers.
- `OPENWEATHER_API_KEY` — free OpenWeather account.
- An initial address (set in-app via the HUD gear, or seeded in `.env`).
