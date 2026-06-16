// Loads CesiumJS from its CDN once, on demand. Avoids bundling Cesium's static
// assets through Next/webpack. Pinned version — bump deliberately.
const CESIUM_VERSION = "1.119";
const BASE = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium`;

let promise: Promise<any> | null = null;

export function loadCesium(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("client only"));
  if ((window as any).Cesium) return Promise.resolve((window as any).Cesium);
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${BASE}/Widgets/widgets.css`;
    document.head.appendChild(css);
    // CESIUM_BASE_URL must be set before Cesium.js executes so it resolves
    // workers/assets from the CDN.
    (window as any).CESIUM_BASE_URL = BASE;
    const script = document.createElement("script");
    script.src = `${BASE}/Cesium.js`;
    script.onload = () => resolve((window as any).Cesium);
    script.onerror = () => reject(new Error("Failed to load CesiumJS"));
    document.head.appendChild(script);
  });
  return promise;
}
