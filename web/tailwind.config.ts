import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        jarvis: {
          bg:     "#04101f",   // page background — deep navy
          panel:  "#0a1b33",   // card background
          panel2: "#0e2240",   // hover / inner card
          border: "#163255",   // card border
          accent: "#22d3ee",   // cyan (primary)
          accent2:"#38bdf8",   // sky blue
          gold:   "#fbbf24",
          good:   "#34d399",
          warn:   "#f97316",
          bad:    "#f87171",
          text:   "#dbeafe",
          muted:  "#6b7c9a",
          dim:    "#3a4a6b",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 24px rgba(34, 211, 238, 0.18)",
      },
    },
  },
  plugins: [],
};
export default config;
