import type { EffectProfile } from "@/lib/weatherEffects";

// GLSL adapted from Cesium Sandcastle "Rain"/"Snow" post-process examples.
const RAIN_FS = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform float intensity;
float hash(float x){ return fract(sin(x*12.9898)*43758.5453); }
void main(){
  vec2 uv = v_textureCoordinates;
  vec4 color = texture(colorTexture, uv);
  float t = czm_frameNumber / 60.0;
  vec2 d = uv * vec2(40.0, 6.0);
  d.y += t * 18.0 * (0.5 + intensity);
  float k = hash(floor(d.x));
  float streak = smoothstep(0.96, 1.0, fract(d.y + k));
  color.rgb += streak * 0.25 * intensity;
  out_FragColor = color;
}`;

const SNOW_FS = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform float intensity;
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.0,289.0)))*43758.5453); }
void main(){
  vec2 uv = v_textureCoordinates;
  vec4 color = texture(colorTexture, uv);
  float t = czm_frameNumber / 60.0;
  float flakes = 0.0;
  for (int i=0;i<3;i++){
    float fi = float(i);
    vec2 g = uv * (8.0 + fi*6.0);
    g.y += t * (1.0 + fi*0.6);
    vec2 id = floor(g);
    float h = hash(id);
    vec2 f = fract(g) - 0.5;
    flakes += smoothstep(0.05, 0.0, length(f) - 0.02) * step(0.7, h);
  }
  color.rgb += flakes * 0.6 * intensity;
  out_FragColor = color;
}`;

type Handles = { rain?: any; snow?: any };
const handles: Handles = {};

export function applyEffects(Cesium: any, scene: any, p: EffectProfile) {
  if (!Cesium || !scene) return;
  const stages = scene.postProcessStages;
  function clear(name: "rain" | "snow") {
    if (handles[name]) { stages.remove(handles[name]); handles[name] = undefined; }
  }
  clear("rain"); clear("snow");
  if (p.precip === "rain") {
    handles.rain = stages.add(new Cesium.PostProcessStage({
      fragmentShader: RAIN_FS, uniforms: { intensity: () => p.precipIntensity },
    }));
  } else if (p.precip === "snow") {
    handles.snow = stages.add(new Cesium.PostProcessStage({
      fragmentShader: SNOW_FS, uniforms: { intensity: () => p.precipIntensity },
    }));
  }

  // fog + atmosphere
  scene.fog.enabled = true;
  scene.fog.density = 0.0001 + p.fogDensity * 0.0006;

  // light intensity (dim under cloud/rain). Wet-look reads via the dimming.
  if (!scene.light) scene.light = new Cesium.SunLight();
  scene.light.intensity = 2.0 * p.lightIntensity;
}

export function disposeEffects(scene: any) {
  if (!scene) return;
  if (handles.rain) { scene.postProcessStages.remove(handles.rain); handles.rain = undefined; }
  if (handles.snow) { scene.postProcessStages.remove(handles.snow); handles.snow = undefined; }
}
