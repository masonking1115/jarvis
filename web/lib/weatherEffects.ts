import type { FlyoverWeather } from "./api";

export type EffectProfile = {
  precip: "none" | "rain" | "snow";
  precipIntensity: number;   // 0..1
  fogDensity: number;        // 0..1 (maps to scene.fog density scaling)
  lightIntensity: number;    // 0..1 multiplier on sun light
  wet: boolean;              // enable wet-look darkening for rain
};

const CLEAR: EffectProfile = {
  precip: "none", precipIntensity: 0, fogDensity: 0.05, lightIntensity: 1, wet: false,
};

// Pure mapping from normalized OpenWeather conditions to a render profile.
export function weatherToEffects(w: FlyoverWeather | null): EffectProfile {
  if (!w || !w.available || !w.main) return CLEAR;
  const clouds = (w.clouds_pct ?? 0) / 100;
  const main = w.main;
  switch (main) {
    case "Rain":
    case "Drizzle":
      return { precip: "rain", precipIntensity: main === "Drizzle" ? 0.4 : 0.7,
               fogDensity: 0.2, lightIntensity: 0.55, wet: true };
    case "Thunderstorm":
      return { precip: "rain", precipIntensity: 1, fogDensity: 0.3, lightIntensity: 0.4, wet: true };
    case "Snow":
      return { precip: "snow", precipIntensity: 0.8, fogDensity: 0.25, lightIntensity: 0.85, wet: false };
    case "Mist":
    case "Fog":
    case "Haze":
    case "Smoke":
      return { precip: "none", precipIntensity: 0, fogDensity: 0.7, lightIntensity: 0.7, wet: false };
    case "Clouds":
      return { precip: "none", precipIntensity: 0,
               fogDensity: 0.05 + clouds * 0.25, lightIntensity: 1 - clouds * 0.45, wet: false };
    case "Clear":
    default:
      return CLEAR;
  }
}
