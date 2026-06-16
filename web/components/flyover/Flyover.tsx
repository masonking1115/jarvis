"use client";
import { useEffect, useRef, useState } from "react";
import { loadCesium } from "@/lib/cesium";
import { flyover, FlyoverConfig, FlyoverWeather } from "@/lib/api";
import { weatherToEffects } from "@/lib/weatherEffects";
import { applyEffects } from "./effects";

const ORBIT_RATE = 0.0006;   // radians/frame — slow cinematic orbit

export function Flyover({ open }: { open: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const builtRef = useRef(false);
  const [cfg, setCfg] = useState<FlyoverConfig | null>(null);
  const [wx, setWx] = useState<FlyoverWeather | null>(null);
  const [status, setStatus] = useState<string>("");
  const [showGear, setShowGear] = useState(false);
  const [addr, setAddr] = useState("");

  async function refreshWeather() {
    const w = await flyover.weather().catch(() => null);
    setWx(w);
    const v = viewerRef.current;
    if (v) applyEffects((window as any).Cesium, v.scene, weatherToEffects(w));
  }

  function flyToAddress(Cesium: any, viewer: any, lat: number, lng: number) {
    const center = Cesium.Cartesian3.fromDegrees(lng, lat, 0);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lng, lat, 700),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-35), roll: 0 },
      duration: 1.5,
      complete: () => { (viewer as any)._orbitCenter = center; },
    });
  }

  function startOrbit(Cesium: any, viewer: any) {
    viewer.clock.onTick.addEventListener(() => {
      const center = (viewer as any)._orbitCenter;
      if (!center) return;
      (viewer as any)._heading = (((viewer as any)._heading || 0) + ORBIT_RATE);
      viewer.camera.lookAt(center, new Cesium.HeadingPitchRange(
        (viewer as any)._heading, Cesium.Math.toRadians(-35), 900));
    });
  }

  // Build the viewer once, on first open.
  useEffect(() => {
    if (!open || builtRef.current) return;
    let cancelled = false;
    (async () => {
      const config = await flyover.config();
      if (cancelled) return;
      setCfg(config);
      if (!config.available) { setStatus(config.reason || "Flyover unavailable"); return; }
      if (config.lat == null || config.lng == null) { setStatus("Set an address to begin"); setShowGear(true); return; }
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
      // real-time sun
      viewer.clock.currentTime = Cesium.JulianDate.now();
      viewer.clock.shouldAnimate = true;
      viewer.clock.multiplier = 1;
      viewer.scene.light = new Cesium.SunLight();
      viewer.scene.skyAtmosphere.show = true;
      // photoreal tiles
      try {
        const tileset = await Cesium.createGooglePhotorealistic3DTileset();
        viewer.scene.primitives.add(tileset);
      } catch (e) { setStatus("Could not load 3D tiles for this area"); }
      // camera + effects
      flyToAddress(Cesium, viewer, config.lat, config.lng);
      startOrbit(Cesium, viewer);
      refreshWeather();
    })();
    return () => { cancelled = true; };
  }, [open]);

  // poll weather every 10 min while open
  useEffect(() => {
    if (!open) return;
    const id = setInterval(refreshWeather, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [open]);

  async function saveAddress() {
    const r = await flyover.setLocation(addr);
    if (!r.ok) { setStatus(r.reason || "Address not found"); return; }
    setShowGear(false); setStatus("");
    const config = await flyover.config();
    setCfg(config);
    const v = viewerRef.current;
    if (v && config.lat != null && config.lng != null) {
      flyToAddress((window as any).Cesium, v, config.lat, config.lng);
    } else {
      // viewer not built yet (first run had no location) — allow rebuild
      builtRef.current = false;
    }
    refreshWeather();
  }

  return (
    <div
      className={`fixed inset-0 z-[100] bg-jarvis-bg transition-opacity duration-500 ${
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {/* HUD */}
      <div className="absolute top-4 left-4 panel !bg-jarvis-panel/70 backdrop-blur px-4 py-3">
        <div className="text-[13px] font-medium text-jarvis-text">{cfg?.address || "Flyover"}</div>
        <LocalClock />
        {wx?.available && (
          <div className="text-[12px] text-jarvis-dim mt-1">
            {Math.round(wx.temp ?? 0)}° · {wx.description || wx.main}
          </div>
        )}
        <button className="text-[11px] text-jarvis-accent mt-1" onClick={() => setShowGear(s => !s)}>change location</button>
      </div>
      {status && <div className="absolute bottom-6 left-1/2 -translate-x-1/2 panel px-4 py-2 text-sm text-jarvis-dim">{status}</div>}
      <div className="absolute bottom-4 right-4 text-[11px] text-jarvis-muted">Esc to exit</div>
      {showGear && (
        <div className="absolute top-4 left-4 mt-24 panel px-4 py-3">
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
