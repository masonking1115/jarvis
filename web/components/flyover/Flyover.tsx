"use client";
import { useEffect, useRef, useState } from "react";
import { loadCesium } from "@/lib/cesium";
import { flyover, FlyoverConfig, FlyoverWeather } from "@/lib/api";
import { weatherToEffects } from "@/lib/weatherEffects";
import { applyEffects } from "./effects";
import { JarvisLogo } from "@/components/JarvisLogo";

const ORBIT_RATE = 0.0006;    // radians/frame — slow cinematic orbit
const ORBIT_RANGE = 250;      // meters from the point — frames the property
const ORBIT_PITCH = -28;      // degrees below horizontal (oblique aerial)

type Loc = { lat: number; lng: number };

// Browser geolocation (Wi-Fi/IP based on a laptop). Resolves null on denial/error/timeout.
function getDevicePosition(): Promise<Loc | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });
}

export function Flyover({ open }: { open: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const coordsRef = useRef<Loc | null>(null);
  const builtRef = useRef(false);
  const [cfg, setCfg] = useState<FlyoverConfig | null>(null);
  const [wx, setWx] = useState<FlyoverWeather | null>(null);
  const [hudAddress, setHudAddress] = useState<string>("Flyover");
  const [status, setStatus] = useState<string>("");
  const [showGear, setShowGear] = useState(false);
  const [addr, setAddr] = useState("");

  async function refreshWeather() {
    const c = coordsRef.current;
    const w = await flyover.weather(c?.lat, c?.lng).catch(() => null);
    setWx(w);
    const v = viewerRef.current;
    if (v) applyEffects((window as any).Cesium, v.scene, weatherToEffects(w));
  }

  function flyToAddress(Cesium: any, viewer: any, lat: number, lng: number) {
    const center = Cesium.Cartesian3.fromDegrees(lng, lat, 0);
    (viewer as any)._orbitCenter = center;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lng, lat, ORBIT_RANGE),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(ORBIT_PITCH), roll: 0 },
      duration: 1.5,
    });
  }

  function startOrbit(Cesium: any, viewer: any) {
    viewer.clock.onTick.addEventListener(() => {
      const center = (viewer as any)._orbitCenter;
      if (!center) return;
      (viewer as any)._heading = (((viewer as any)._heading || 0) + ORBIT_RATE);
      viewer.camera.lookAt(center, new Cesium.HeadingPitchRange(
        (viewer as any)._heading, Cesium.Math.toRadians(ORBIT_PITCH), ORBIT_RANGE));
    });
  }

  // Move the view to a location and refresh its label + weather.
  function goTo(loc: Loc, label: string) {
    coordsRef.current = loc;
    setHudAddress(label);
    const v = viewerRef.current;
    if (v) flyToAddress((window as any).Cesium, v, loc.lat, loc.lng);
    refreshWeather();
  }

  // Build the viewer once, on first open. Prefer device location, else the default.
  useEffect(() => {
    if (!open || builtRef.current) return;
    let cancelled = false;
    (async () => {
      const config = await flyover.config();
      if (cancelled) return;
      setCfg(config);
      if (!config.available) { setStatus(config.reason || "Flyover unavailable"); return; }

      // Default to the configured address (precise). Device geolocation is
      // opt-in via the "my location" button — on a laptop it's IP-based and
      // unreliable (can land in the wrong town).
      let loc: Loc | null = null;
      let label = "Flyover";
      if (config.lat != null && config.lng != null) {
        loc = { lat: config.lat, lng: config.lng };
        label = config.address || "Flyover";
      }
      if (!loc) { setStatus("Set an address to begin"); setShowGear(true); return; }
      if (cancelled) return;

      const Cesium = await loadCesium();
      if (cancelled || !containerRef.current) return;
      Cesium.GoogleMaps.defaultApiKey = config.google_maps_key;
      const viewer = new Cesium.Viewer(containerRef.current, {
        globe: false, baseLayerPicker: false, geocoder: false, homeButton: false,
        sceneModePicker: false, navigationHelpButton: false, animation: false,
        timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
      });
      viewerRef.current = viewer;
      builtRef.current = true;
      viewer.clock.currentTime = Cesium.JulianDate.now();
      viewer.clock.shouldAnimate = true;
      viewer.clock.multiplier = 1;
      viewer.scene.light = new Cesium.SunLight();
      viewer.scene.skyAtmosphere.show = true;
      try {
        const tileset = await Cesium.createGooglePhotorealistic3DTileset();
        viewer.scene.primitives.add(tileset);
      } catch (e) { setStatus("Could not load 3D tiles for this area"); }
      startOrbit(Cesium, viewer);
      goTo(loc, label);
    })();
    return () => { cancelled = true; };
  }, [open]);

  // poll weather every 10 min while open
  useEffect(() => {
    if (!open) return;
    const id = setInterval(refreshWeather, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [open]);

  async function useMyLocation() {
    setStatus("");
    const loc = await getDevicePosition();
    if (!loc) { setStatus("Couldn't get your device location (permission denied?)"); return; }
    const label = (await flyover.reverse(loc.lat, loc.lng).catch(() => null))?.address || "My location";
    goTo(loc, label);
  }

  async function saveAddress() {
    const r = await flyover.setLocation(addr);
    if (!r.ok || r.lat == null || r.lng == null) { setStatus(r.reason || "Address not found"); return; }
    setShowGear(false); setStatus("");
    goTo({ lat: r.lat, lng: r.lng }, r.address || addr);
  }

  return (
    <div
      className={`fixed inset-0 z-[100] bg-jarvis-bg transition-opacity duration-500 ${
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {/* Dashboard-style chrome: cyan panel border + corner cuts framing the view */}
      <div className="pointer-events-none absolute inset-2 rounded-[14px] corner-cuts"
        style={{
          border: "1px solid rgba(74, 214, 255, 0.35)",
          boxShadow: "inset 0 0 60px rgba(74, 214, 255, 0.10), 0 0 30px rgba(74, 214, 255, 0.15)",
        }} />
      {/* JARVIS orb, pulsating, bottom-right */}
      <div className="pointer-events-none absolute bottom-6 right-6 ring-breathe" aria-hidden>
        <JarvisLogo size={76} />
      </div>
      {/* HUD */}
      <div className="absolute top-4 left-4 panel !bg-jarvis-panel/70 backdrop-blur px-4 py-3 max-w-xs">
        <div className="text-[13px] font-medium text-jarvis-text truncate">{hudAddress}</div>
        <LocalClock />
        {wx?.available && (
          <div className="text-[12px] text-jarvis-dim mt-1">
            {Math.round(wx.temp ?? 0)}° · {wx.description || wx.main}
          </div>
        )}
        <div className="flex items-center gap-3 mt-1">
          <button className="text-[11px] text-jarvis-accent" onClick={useMyLocation}>📍 my location</button>
          <button className="text-[11px] text-jarvis-accent" onClick={() => setShowGear(s => !s)}>change</button>
        </div>
      </div>
      {status && <div className="absolute bottom-6 left-1/2 -translate-x-1/2 panel px-4 py-2 text-sm text-jarvis-dim">{status}</div>}
      <div className="absolute bottom-5 left-6 text-[11px] text-jarvis-muted tracking-wider">ESC TO EXIT</div>
      {showGear && (
        <div className="absolute top-4 left-4 mt-28 panel px-4 py-3">
          <input className="input w-64" placeholder="Enter an address or city"
            value={addr} onChange={e => setAddr(e.target.value)}
            onKeyDown={e => e.key === "Enter" && saveAddress()} autoFocus />
          <button className="btn mt-2" onClick={saveAddress}>Go</button>
        </div>
      )}
    </div>
  );
}

function LocalClock() {
  const [now, setNow] = useState("");
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString());
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, []);
  return <div className="text-[11px] text-jarvis-muted numeric">{now}</div>;
}
