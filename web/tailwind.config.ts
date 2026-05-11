import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        jarvis: {
          // Base — very deep blue-black with subtle navy lift on panels
          bg:     "#040813",
          bg2:    "#060d1c",
          panel:  "#0a1424",
          panel2: "#0d1a2e",
          border: "#142845",
          borderHi: "#1f3d68",
          // Brand accents
          accent: "#4ad6ff",  // primary cyan (slightly softer than electric)
          accent2:"#00b8e6",  // deeper cyan
          glow:   "#5be1ff",
          // Status palette
          gold:   "#ffb547",
          amber:  "#ff9c2a",
          good:   "#22e8a0",
          warn:   "#ff9c2a",
          bad:    "#ff5c6c",
          // Text scale
          text:   "#cfe2ff",
          dim:    "#94a8c9",
          muted:  "#5e7194",
          mute2:  "#3a4a6b",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Orbitron", "ui-sans-serif", "system-ui"],
        ui:      ["var(--font-ui)", "Rajdhani", "ui-sans-serif", "system-ui"],
        sans:    ["var(--font-body)", "Inter", "ui-sans-serif", "system-ui"],
        mono:    ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow:   "0 0 24px rgba(74, 214, 255, 0.22)",
        glowSm: "0 0 12px rgba(74, 214, 255, 0.35)",
        glowGreen: "0 0 12px rgba(34, 232, 160, 0.5)",
      },
    },
  },
  plugins: [],
};
export default config;
